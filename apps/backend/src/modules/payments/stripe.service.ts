import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../database/prisma.service';
import { captureServer, type CaptureOptions } from '../../common/analytics/posthog';
import {
  getStripeConfig,
  getPriceId,
  resolvePlanForPriceId,
  monthlyTicksForPriceId,
  allowanceWindowStart,
  PlanType,
  BillingCycle,
  Currency,
  stripeKeyMode,
} from '../../config/stripe.config';

type AttributionRecord = Record<string, unknown>;

type CheckoutResult = { sessionId: string; url: string; reused: boolean };

/**
 * Status em que o cliente JA TEM assinatura viva. Abrir outro checkout nesse
 * estado cria uma segunda assinatura cobrada em paralelo: `past_due`/`unpaid`
 * entram de proposito, porque o caminho certo ali e atualizar o cartao no
 * portal, nao assinar de novo. `incomplete` fica de fora: o Checkout so cria a
 * assinatura quando o pagamento passa, entao ela nao vem deste fluxo.
 */
const BLOCKING_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

/** Sessao aberta so e reaproveitada se ainda tiver pelo menos isto de vida. */
const REUSE_MIN_REMAINING_SECONDS = 10 * 60;

/** Validacao do price vale por 1h; mudar o price no painel reflete em ate 1h. */
const PRICE_CHECK_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe | null;

  /**
   * Checkout em andamento por usuario. Clique duplo, o useEffect que retoma o
   * upgrade depois do login e o retry do frontend no cold start chegavam aqui
   * ao mesmo tempo e cada um criava uma sessao (visto na Stripe: pares de
   * sessoes no mesmo segundo). O segundo pedido agora recebe a MESMA promessa.
   * Um processo so no Render, entao um Map em memoria basta.
   */
  private readonly checkoutInFlight = new Map<string, Promise<CheckoutResult>>();
  private readonly priceCheckedAt = new Map<string, number>();

  constructor(private prisma: PrismaService) {
    const stripeConfig = getStripeConfig();
    if (!stripeConfig.secretKey) {
      this.stripe = null;
      this.logger.warn('Stripe is not configured (missing STRIPE_SECRET_KEY)');
      return;
    }

    this.stripe = new Stripe(stripeConfig.secretKey, {
      apiVersion: '2023-10-16',
    });
    this.logger.log(`Stripe configured in ${stripeKeyMode(stripeConfig.secretKey).toUpperCase()} mode`);
  }

  /**
   * Garante a tabela de idempotencia dos webhooks. Em producao as migracoes
   * nao rodam no boot (RUN_MIGRATIONS_ON_START=false), mesmo padrao dos
   * `ADD COLUMN IF NOT EXISTS` do AiService. Falhar aqui nao derruba o app:
   * sem a tabela o webhook processa sem o registro (ver claimWebhookEvent).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "tickrify"."StripeWebhookEvent" (
          "id" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "attempts" INTEGER NOT NULL DEFAULT 1,
          "error" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "processedAt" TIMESTAMP(3),
          CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
        )`);
      await this.prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_status_updatedAt_idx" ON "tickrify"."StripeWebhookEvent"("status", "updatedAt")',
      );
      // Periodo de cobranca (janela mensal de ticks). Mesma logica: aditivo,
      // idempotente, e a migracao nao roda no boot em producao.
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMP(3)',
      );
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3)',
      );
      this.logger.log('[webhook] Registro de eventos pronto.');
    } catch (error) {
      this.logger.error('[webhook] Nao consegui garantir a tabela StripeWebhookEvent.', error);
    }
  }

  private getStripeClient(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Stripe is not configured');
    }
    return this.stripe;
  }

  /**
   * Producao so vende com chave live. Chave de teste em producao abriria um
   * checkout que aceita o cartao 4242 e nao cobra ninguem, sem erro nenhum.
   */
  private assertLiveModeInProduction(): void {
    const mode = stripeKeyMode(getStripeConfig().secretKey);
    if (process.env.NODE_ENV === 'production' && mode !== 'live') {
      this.logger.error(`[stripe] STRIPE_SECRET_KEY em modo ${mode} com NODE_ENV=production. Checkout bloqueado.`);
      throw new ServiceUnavailableException({
        code: 'stripe_not_live',
        message: 'Payments are temporarily unavailable. Please try again later.',
      });
    }
  }

  /**
   * Confere que o price existe, esta ativo, e recorrente, na moeda pedida e no
   * MESMO modo da chave (price de teste com chave live, ou o contrario, e o
   * erro classico de trocar as chaves no painel). Falha alto em vez de deixar a
   * Stripe devolver um erro generico no meio do checkout.
   */
  private async assertPriceUsable(priceId: string, currency: Currency): Promise<void> {
    const checkedAt = this.priceCheckedAt.get(priceId);
    if (checkedAt && Date.now() - checkedAt < PRICE_CHECK_TTL_MS) return;

    const stripe = this.getStripeClient();
    let price: Stripe.Price;
    try {
      price = await stripe.prices.retrieve(priceId);
    } catch (error) {
      const stripeError = error as { code?: string };
      if (stripeError?.code === 'resource_missing') {
        this.logger.error(`[stripe] Price ${priceId} nao existe nesta conta/modo.`);
        throw new ServiceUnavailableException({
          code: 'price_not_found',
          message: 'This plan is temporarily unavailable. Please contact support.',
        });
      }
      throw error;
    }

    const expectedLive = stripeKeyMode(getStripeConfig().secretKey) === 'live';
    const problems: string[] = [];
    if (!price.active) problems.push('inativo');
    if (price.type !== 'recurring') problems.push(`tipo ${price.type}`);
    if (price.currency !== currency) problems.push(`moeda ${price.currency} != ${currency}`);
    if (price.livemode !== expectedLive) problems.push(`livemode=${price.livemode} com chave ${expectedLive ? 'live' : 'test'}`);

    if (problems.length > 0) {
      this.logger.error(`[stripe] Price ${priceId} inutilizavel: ${problems.join(', ')}.`);
      throw new ServiceUnavailableException({
        code: 'price_invalid',
        message: 'This plan is temporarily unavailable. Please contact support.',
      });
    }

    this.priceCheckedAt.set(priceId, Date.now());
  }

  private alreadySubscribed(userId: string, status: string, source: 'db' | 'stripe'): ConflictException {
    this.logger.warn(`[stripe] Checkout recusado: usuario ${userId} ja tem assinatura ${status} (${source}).`);
    return new ConflictException({
      code: 'already_subscribed',
      message: 'You already have an active Tickrify subscription. Manage it from your dashboard.',
    });
  }

  /**
   * Criar sessão de checkout.
   *
   * Pedidos simultaneos do mesmo usuario sao fundidos num so (ver
   * `checkoutInFlight`): o segundo recebe a mesma sessao, e nao cria outra
   * sessao nem outro customer.
   */
  async createCheckoutSession(
    clerkUserId: string,
    planType: PlanType,
    billingCycle: BillingCycle,
    currency: Currency = 'usd',
    couponId?: string,
    source?: 'pricing' | 'locked_value' | 'last_free_result',
  ): Promise<CheckoutResult> {
    const inFlight = this.checkoutInFlight.get(clerkUserId);
    if (inFlight) {
      this.logger.log(`[stripe] Checkout de ${clerkUserId} ja em andamento; reaproveitando o mesmo pedido.`);
      return inFlight;
    }

    const run = this.createCheckoutSessionUnlocked(clerkUserId, planType, billingCycle, currency, couponId, source)
      .finally(() => this.checkoutInFlight.delete(clerkUserId));
    this.checkoutInFlight.set(clerkUserId, run);
    return run;
  }

  private async createCheckoutSessionUnlocked(
    clerkUserId: string,
    planType: PlanType,
    billingCycle: BillingCycle,
    currency: Currency,
    couponId?: string,
    source?: 'pricing' | 'locked_value' | 'last_free_result',
  ): Promise<CheckoutResult> {
    try {
      if (!['starter', 'pro', 'elite'].includes(planType)) {
        throw new BadRequestException({ code: 'invalid_plan', message: `Invalid plan type: ${planType}` });
      }

      this.assertLiveModeInProduction();

      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
      });

      if (!user) {
        throw new BadRequestException({
          code: 'user_not_found',
          message: 'Account not found. Please sign out and sign in again.',
        });
      }

      // Trava 1, banco: barata e cobre tambem o acesso manual do dono
      // (`manual_owner_1`), que nao existe na Stripe.
      const dbSubscription = await this.prisma.subscription.findFirst({
        where: { userId: user.id, status: { in: BLOCKING_SUBSCRIPTION_STATUSES } },
        select: { status: true },
      });
      if (dbSubscription) {
        throw this.alreadySubscribed(user.id, dbSubscription.status, 'db');
      }

      const priceId = getPriceId(planType, billingCycle, currency);
      if (!priceId) {
        this.logger.error(`[stripe] Price ID ausente para ${planType}/${billingCycle}/${currency}.`);
        throw new ServiceUnavailableException({
          code: 'price_not_configured',
          message: 'This plan is temporarily unavailable. Please contact support.',
        });
      }
      await this.assertPriceUsable(priceId, currency);

      const customerId = await this.resolveOrCreateCustomerId(user);
      const stripe = this.getStripeClient();

      // Trava 2, Stripe: cobre o intervalo entre o pagamento e o webhook, em
      // que o banco ainda nao sabe da assinatura. Se esta consulta falhar, o
      // checkout falha junto: seguir sem saber arriscaria cobrar em dobro.
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 20,
      });
      const liveSubscription = subscriptions.data.find((sub) =>
        BLOCKING_SUBSCRIPTION_STATUSES.includes(sub.status),
      );
      if (liveSubscription) {
        throw this.alreadySubscribed(user.id, liveSubscription.status, 'stripe');
      }

      // Diagnostico de moeda legada (ver nota de 29/07 no CLAUDE.md): so avisa.
      const legacyCurrency = subscriptions.data.find(
        (sub) => sub.currency && sub.currency.toLowerCase() !== currency,
      )?.currency;
      if (legacyCurrency) {
        this.logger.warn(
          `[stripe] Cliente ${customerId} tem historico em ${legacyCurrency.toUpperCase()}; checkout vai em ${currency.toUpperCase()}.`,
        );
      }

      // Trava 3, sessoes abertas: no maximo UMA por cliente. Duas sessoes
      // abertas em abas diferentes podiam ser pagas as duas e virar duas
      // assinaturas. A equivalente e reaproveitada; as outras sao expiradas.
      const openSessions = await stripe.checkout.sessions.list({
        customer: customerId,
        status: 'open',
        limit: 20,
      });
      const nowSeconds = Math.floor(Date.now() / 1000);
      let reusable: Stripe.Checkout.Session | null = null;
      for (const open of openSessions.data) {
        const equivalent =
          open.mode === 'subscription' &&
          open.metadata?.priceId === priceId &&
          (open.metadata?.coupon ?? '') === (couponId ?? '') &&
          Boolean(open.url) &&
          open.expires_at - nowSeconds > REUSE_MIN_REMAINING_SECONDS;

        if (equivalent && !reusable) {
          reusable = open;
          continue;
        }

        // Se nao der para expirar, nao abre outra: o erro sobe e o usuario
        // tenta de novo, em vez de ficar com duas sessoes pagaveis.
        await stripe.checkout.sessions.expire(open.id);
        this.logger.log(`[stripe] Sessao aberta ${open.id} expirada antes de criar outra para ${customerId}.`);
      }

      if (reusable?.url) {
        this.logger.log(`Checkout session reused: ${reusable.id} for user: ${clerkUserId}`);
        return { sessionId: reusable.id, url: reusable.url, reused: true };
      }

      const appBaseUrl = this.resolveAppBaseUrl();
      const successUrl = `${appBaseUrl}/dashboard?success=true`;
      const cancelUrl = `${appBaseUrl}/pricing?canceled=true`;

      const baseParams: Stripe.Checkout.SessionCreateParams = {
        customer: customerId,
        mode: 'subscription',
        // NÃO fixar payment_method_types: ao omitir, a Stripe usa os métodos
        // automáticos configurados no painel (por país) e habilita o Adaptive
        // Pricing — cada cliente vê o preço e paga na MOEDA LOCAL dele (150+
        // países), além de liberar métodos locais (Pix no BR, etc.). Fixar
        // ['card'] travava tudo em cartão e atrapalhava a conversão de moeda.
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: user.id,
        billing_address_collection: 'required',
        // SEM trial: o "grátis" do Tickrify são as 3 análises gratuitas (freemium
        // de uso). Um trial de tempo por cima seria redundante — não dá ticks a
        // mais, só adiaria a receita e abriria churn involuntário. Cobra já; o
        // incentivo de entrada fica no cupom EARLY35 (35% no 1º mês).
        metadata: {
          userId: user.id,
          clerkUserId,
          planType,
          billingCycle,
          currency,
          // `priceId` e `coupon` identificam a sessao para a Trava 3 acima.
          priceId,
          checkoutSource: source ?? 'unknown',
          ...this.stripeAttributionMetadata(user),
        },
        // A assinatura nasce com o dono gravado nela. E o que permite ao
        // webhook achar o usuario mesmo se o vinculo pelo customer se perder.
        subscription_data: {
          metadata: {
            userId: user.id,
            clerkUserId,
            checkoutSource: source ?? 'unknown',
          },
        },
      };

      /**
       * `discounts` e `allow_promotion_codes` sao MUTUAMENTE EXCLUSIVOS na
       * Stripe: ou o desconto ja chega aplicado, ou o campo de codigo fica
       * aberto no checkout.
       *
       * ⚠️ O RISCO QUE ESTE FALLBACK COBRE: cupom pre-aplicado que a Stripe
       * recusa (esgotou os 50 usos, expirou, foi apagado) faz o
       * `sessions.create` LANCAR, e o usuario nao ve checkout nenhum. Ou seja,
       * o dia em que o EARLY35 acabar seria tambem o dia em que 100% dos
       * checkouts parariam de abrir, sem ninguem relacionar as duas coisas.
       * Com o fallback, o cupom morto apenas deixa de descontar.
       */
      const abrirCheckout = (comCupom: boolean) =>
        stripe.checkout.sessions.create({
          ...baseParams,
          metadata: { ...baseParams.metadata, coupon: comCupom && couponId ? couponId : '' },
          ...(comCupom && couponId
            ? { discounts: [{ coupon: couponId }] }
            : { allow_promotion_codes: true }),
        });

      let session: Stripe.Checkout.Session;
      try {
        session = await abrirCheckout(Boolean(couponId));
      } catch (erroCupom) {
        const recusouOCupom =
          Boolean(couponId) &&
          erroCupom instanceof Error &&
          /coupon|promotion|discount/i.test(erroCupom.message);

        if (!recusouOCupom) throw erroCupom;

        this.logger.warn(
          `[stripe] Cupom ${couponId} recusado pela Stripe (${erroCupom.message}). ` +
            `Reabrindo o checkout SEM desconto para nao bloquear a compra. ` +
            `Conferir se o cupom expirou ou esgotou os usos.`,
        );
        session = await abrirCheckout(false);
      }

      // Em modo subscription hospedado a Stripe sempre devolve `url`; se nao
      // vier, o frontend redirecionaria para "undefined". Falha alto aqui.
      if (!session.url) {
        this.logger.error(`[stripe] Sessao ${session.id} criada sem url.`);
        throw new InternalServerErrorException({
          code: 'checkout_url_missing',
          message: 'Could not open checkout. Please try again.',
        });
      }

      this.logger.log(`Checkout session created: ${session.id} for user: ${clerkUserId} (${currency})`);

      return {
        sessionId: session.id,
        url: session.url,
        reused: false,
      };
    } catch (error) {
      this.logger.error('Error creating checkout session:', error);
      this.rethrowCheckoutError(error);
    }
  }

  async createTicksCheckout(params: {
    userId: string;
    userEmail: string;
    packageId: string;
    packageName: string;
    ticks: number;
    priceInCents: number;
    currency?: Currency;
  }) {
    try {
      const stripe = this.getStripeClient();
      const appBaseUrl = this.resolveAppBaseUrl();

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: params.userEmail,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: params.currency ?? 'usd',
              unit_amount: params.priceInCents,
              product_data: {
                name: `Tickrify ${params.ticks} Ticks (${params.packageName})`,
                description: `${params.ticks} Ticks for analyses. They never expire.`,
              },
            },
          },
        ],
        metadata: {
          type: 'ticks_purchase',
          userId: params.userId,
          packageId: params.packageId,
          ticks: String(params.ticks),
        },
        success_url: `${appBaseUrl}/dashboard?ticks=success&package=${params.packageId}&amount=${params.ticks}`,
        cancel_url: `${appBaseUrl}/dashboard?ticks=cancelled`,
      });

      if (!session.url) {
        throw new InternalServerErrorException('Stripe checkout URL unavailable');
      }

      return session;
    } catch (error) {
      this.logger.error('Failed to create ticks checkout', {
        userId: params.userId,
        packageId: params.packageId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.rethrowStripeError(error, 'Falha ao criar checkout de Ticks no Stripe.');
    }
  }

  private rethrowCheckoutError(error: unknown): never {
    // Erro ja classificado (Conflict, BadRequest, ServiceUnavailable...) sobe
    // intacto, com o `code` que o frontend usa para decidir o que mostrar.
    if (error instanceof HttpException) {
      throw error;
    }

    const stripeError = error as {
      type?: string;
      code?: string;
      message?: string;
    };

    // Chave invalida, sem permissao, Stripe fora ou rate limit: nao e culpa de
    // quem clicou, e a mensagem crua da Stripe nao serve para o usuario.
    if (
      stripeError?.type === 'StripeAuthenticationError' ||
      stripeError?.type === 'StripePermissionError' ||
      stripeError?.type === 'StripeAPIError' ||
      stripeError?.type === 'StripeConnectionError' ||
      stripeError?.type === 'StripeRateLimitError'
    ) {
      throw new ServiceUnavailableException({
        code: 'stripe_unavailable',
        message: 'The payment provider is unavailable right now. Please try again in a moment.',
      });
    }

    if (stripeError?.type === 'StripeInvalidRequestError' || stripeError?.code === 'resource_missing') {
      throw new BadRequestException({
        code: 'stripe_rejected',
        message: stripeError.message || 'The payment provider rejected the checkout request.',
      });
    }

    throw new InternalServerErrorException({
      code: 'checkout_failed',
      message: 'Could not start checkout. Please try again.',
    });
  }

  private async resolveOrCreateCustomerId(user: {
    id: string;
    email: string | null;
    clerkUserId: string;
    stripeCustomerId: string | null;
  }) {
    const stripe = this.getStripeClient();
    let customerId = user.stripeCustomerId;

    if (customerId) {
      const customerExists = await this.customerExists(customerId);
      if (!customerExists) {
        this.logger.warn(
          `Stripe customer ${customerId} not found for user ${user.id}. Recreating customer.`,
        );
        customerId = null;
      } else if (user.email) {
        // Best-effort: garante que o customer tem e-mail (pré-preenche o
        // checkout e mantém recibos/webhooks casados com a conta certa).
        try {
          const existing = await stripe.customers.retrieve(customerId);
          if (!('deleted' in existing && existing.deleted) && !existing.email) {
            await stripe.customers.update(customerId, { email: user.email });
          }
        } catch {
          /* nunca bloquear o checkout por causa disso */
        }
      }
    }

    if (!customerId) {
      // Chave de idempotencia: dois pedidos que escapem do lock (ex.: dois
      // processos num deploy) recebem o MESMO customer da Stripe. O id antigo
      // entra na chave para que recriar um customer apagado nao devolva o
      // apagado (a Stripe guarda a resposta da chave por 24h).
      const customer = await stripe.customers.create(
        {
          email: user.email || undefined,
          metadata: {
            userId: user.id,
            clerkId: user.clerkUserId,
          },
        },
        { idempotencyKey: `customer-create:${user.id}:${user.stripeCustomerId ?? 'none'}` },
      );

      customerId = customer.id;

      await this.prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    return customerId;
  }

  private async customerExists(customerId: string) {
    const stripe = this.getStripeClient();
    try {
      const customer = await stripe.customers.retrieve(customerId);
      return !('deleted' in customer && customer.deleted);
    } catch (error) {
      const stripeError = error as { type?: string; code?: string };
      if (
        stripeError?.type === 'StripeInvalidRequestError' &&
        stripeError?.code === 'resource_missing'
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Criar portal do cliente
   */
  async createCustomerPortal(clerkUserId: string) {
    try {
      const stripe = this.getStripeClient();
      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
      });

      if (!user?.stripeCustomerId) {
        throw new Error('User does not have a Stripe customer ID');
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${this.resolveAppBaseUrl()}/dashboard`,
      });

      return {
        url: session.url,
      };
    } catch (error) {
      this.logger.error('Failed to create customer portal', {
        clerkUserId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.rethrowStripeError(error, 'Falha ao criar portal do cliente no Stripe.');
    }
  }

  private resolveAppBaseUrl(): string {
    const allowList = [
      process.env.APP_URL,
      process.env.FRONTEND_URL,
      ...(process.env.STRIPE_ALLOWED_RETURN_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ].filter(Boolean) as string[];

    for (const candidate of allowList) {
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === 'https:' || parsed.hostname === 'localhost') {
          return `${parsed.origin}`;
        }
      } catch {
        continue;
      }
    }

    throw new Error(
      'Missing APP_URL/FRONTEND_URL. Stripe redirect allowlist could not be resolved.',
    );
  }

  /**
   * Cancelar assinatura
   */
  async cancelSubscription(clerkUserId: string) {
    try {
      const stripe = this.getStripeClient();
      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const subscriptionRecord = await this.prisma.subscription.findFirst({
        where: {
          userId: user.id,
          status: {
            in: ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'],
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (!subscriptionRecord?.stripeId) {
        throw new Error('User does not have an active subscription');
      }

      const subscription = await stripe.subscriptions.update(
        subscriptionRecord.stripeId,
        {
          cancel_at_period_end: true,
        },
      );

      await this.upsertSubscriptionForUser(user.id, subscription);

      this.logger.log(`Subscription cancelled: ${subscription.id} for user: ${clerkUserId}`);

      return {
        subscriptionId: subscription.id,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: subscription.current_period_end,
      };
    } catch (error) {
      this.logger.error('Failed to cancel subscription', {
        clerkUserId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.rethrowStripeError(error, 'Falha ao cancelar assinatura no Stripe.');
    }
  }

  /**
   * Reativar assinatura
   */
  async reactivateSubscription(clerkUserId: string) {
    try {
      const stripe = this.getStripeClient();
      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const subscriptionRecord = await this.prisma.subscription.findFirst({
        where: {
          userId: user.id,
          status: {
            in: ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'canceled'],
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (!subscriptionRecord?.stripeId) {
        throw new Error('User does not have a subscription');
      }

      const subscription = await stripe.subscriptions.update(
        subscriptionRecord.stripeId,
        {
          cancel_at_period_end: false,
        },
      );

      await this.upsertSubscriptionForUser(user.id, subscription);

      this.logger.log(`Subscription reactivated: ${subscription.id} for user: ${clerkUserId}`);

      return {
        subscriptionId: subscription.id,
        status: subscription.status,
      };
    } catch (error) {
      this.logger.error('Failed to reactivate subscription', {
        clerkUserId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.rethrowStripeError(error, 'Falha ao reativar assinatura no Stripe.');
    }
  }

  /**
   * Obter assinatura do usuário
   */
  async getUserSubscription(clerkUserId: string) {
    let userId: string | null = null;

    try {
      const stripe = this.getStripeClient();
      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true },
      });

      if (!user) {
        return null;
      }
      userId = user.id;

      const subscriptionRecord = await this.prisma.subscription.findFirst({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
      });

      if (!subscriptionRecord?.stripeId) {
        return null;
      }

      let subscription = await stripe.subscriptions.retrieve(subscriptionRecord.stripeId);
      await this.upsertSubscriptionForUser(user.id, subscription);

      const activePriceId = subscription.items.data[0]?.price.id ?? '';
      const resolvedPlan = resolvePlanForPriceId(activePriceId);
      const isActive = ['active', 'trialing'].includes(String(subscription.status).toLowerCase());

      return {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        plan: isActive ? (resolvedPlan ?? 'pro') : 'free',
      };
    } catch (error) {
      this.logger.error('Failed to get user subscription', {
        userId,
        clerkUserId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.rethrowStripeError(error, 'Falha ao obter assinatura do usuário.');
    }
  }

  /**
   * Webhook da Stripe.
   *
   * Tres garantias, nesta ordem:
   * 1. So processa evento com assinatura HMAC valida (`constructEvent`).
   * 2. Cada `event.id` e processado UMA vez (`claimWebhookEvent`). A Stripe
   *    reenvia o mesmo evento em retry e as vezes entrega duplicado mesmo com
   *    sucesso; antes disso uma fatura podia creditar os 200 ticks duas vezes.
   * 3. Erro devolve nao-2xx e libera o evento, para a Stripe reenviar. Antes,
   *    usuario nao encontrado ou falha ao creditar ticks respondia 200 e o
   *    evento se perdia para sempre.
   */
  async handleWebhookEvent(signature: string, payload: Buffer) {
    let event: Stripe.Event;
    try {
      const stripeConfig = getStripeConfig();
      if (!stripeConfig.webhookSecret) {
        throw new ServiceUnavailableException('Stripe webhook secret is not configured');
      }
      event = this.getStripeClient().webhooks.constructEvent(
        payload,
        signature,
        stripeConfig.webhookSecret,
      );
    } catch (error) {
      this.logger.error('Error verifying webhook event:', error);
      const stripeError = error as { type?: string };
      if (stripeError?.type === 'StripeSignatureVerificationError') {
        throw new BadRequestException('Invalid webhook signature');
      }
      this.rethrowStripeError(error, 'Falha ao processar webhook do Stripe.');
    }

    const claim = await this.claimWebhookEvent(event);
    if (claim === 'duplicate') {
      this.logger.log(`[webhook] ${event.type} ${event.id} ja processado; ignorado.`);
      return { received: true, duplicate: true };
    }
    if (claim === 'in_progress') {
      // Outra entrega do mesmo evento esta rodando agora. Nao-2xx faz a Stripe
      // tentar de novo mais tarde; 2xx aqui perderia o evento se a outra falhar.
      throw new ConflictException('Webhook event is already being processed');
    }

    this.logger.log(`Processing webhook event: ${event.type} (${event.id})`);
    try {
      await this.dispatchWebhookEvent(event);
      await this.finishWebhookEvent(event.id, 'processed');
      return { received: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[webhook] Falha em ${event.type} ${event.id}: ${message}`, error);
      await this.finishWebhookEvent(event.id, 'failed', message);
      this.rethrowStripeError(error, 'Falha ao processar webhook do Stripe.');
    }
  }

  private async dispatchWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        return;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionChanged(event.data.object as Stripe.Subscription, event.type);
        return;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        return;
      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        return;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        return;
      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }
  }

  /**
   * Reserva o evento. `claimed` = processar agora (evento novo, ou que falhou
   * antes, ou preso em `processing` ha mais de 5 min por um processo que caiu).
   * `unavailable` = a tabela nao respondeu: processa assim mesmo, porque os
   * handlers sao idempotentes por conta propria (sync pela Stripe + chave
   * unica nos creditos). O registro e a primeira linha, nao a unica.
   */
  private async claimWebhookEvent(
    event: Stripe.Event,
  ): Promise<'claimed' | 'duplicate' | 'in_progress' | 'unavailable'> {
    try {
      const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "tickrify"."StripeWebhookEvent" ("id", "type", "status")
        VALUES (${event.id}, ${event.type}, 'processing')
        ON CONFLICT ("id") DO UPDATE
          SET "status" = 'processing',
              "attempts" = "StripeWebhookEvent"."attempts" + 1,
              "error" = NULL,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "StripeWebhookEvent"."status" = 'failed'
             OR ("StripeWebhookEvent"."status" = 'processing'
                 AND "StripeWebhookEvent"."updatedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
        RETURNING "id"`;
      if (claimed.length > 0) return 'claimed';

      const existing = await this.prisma.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "tickrify"."StripeWebhookEvent" WHERE "id" = ${event.id}`;
      return existing[0]?.status === 'processed' ? 'duplicate' : 'in_progress';
    } catch (error) {
      this.logger.error(
        `[webhook] Registro de eventos indisponivel; processando ${event.id} sem ele.`,
        error,
      );
      return 'unavailable';
    }
  }

  private async finishWebhookEvent(eventId: string, status: 'processed' | 'failed', error?: string) {
    try {
      await this.prisma.$executeRaw`
        UPDATE "tickrify"."StripeWebhookEvent"
        SET "status" = ${status},
            "error" = ${error ? error.slice(0, 1000) : null},
            "updatedAt" = CURRENT_TIMESTAMP,
            "processedAt" = ${status === 'processed' ? new Date() : null}
        WHERE "id" = ${eventId}`;
    } catch (updateError) {
      this.logger.error(`[webhook] Nao consegui marcar ${eventId} como ${status}.`, updateError);
    }
  }

  /**
   * Checkout concluido. A assinatura so fica ativa pelo status REAL que a
   * Stripe devolve (`active`/`trialing`), nunca por este evento sozinho: com
   * pagamento pendente a sessao completa e a assinatura nasce `incomplete`.
   */
  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    if (session.metadata?.type === 'ticks_purchase') {
      await this.creditTicksFromCompletedCheckout(session);
      return;
    }

    if (session.mode !== 'subscription') {
      this.logger.log(`[webhook] Checkout ${session.id} em modo ${session.mode}; nada a sincronizar.`);
      return;
    }

    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subscriptionId) {
      throw new Error(`Checkout session ${session.id} completed without subscription id`);
    }

    // `client_reference_id` e o id do usuario desde a criacao da sessao; a
    // metadata e a primeira fonte, ele e a segunda.
    const userIdHint = session.metadata?.userId || session.client_reference_id || null;
    const synced = await this.syncSubscriptionFromStripe(subscriptionId, { userIdHint });
    if (!synced) {
      throw new Error(`Could not resolve user for checkout session ${session.id}`);
    }

    await this.linkCustomerIfMissing(synced.userId, session.customer);
    this.logger.log(
      `User ${synced.userId} subscription synchronized: ${synced.subscription.id} (${synced.subscription.status})`,
    );

    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    if (!paid || !['active', 'trialing'].includes(synced.subscription.status)) {
      this.logger.warn(
        `[webhook] Checkout ${session.id} completo mas assinatura ${synced.subscription.status} ` +
          `(payment_status=${session.payment_status}). Acesso so libera quando ficar ativa.`,
      );
      return;
    }

    // RECEITA (fonte de verdade): dispara na confirmação do pagamento, mesmo se
    // o usuário fechar a aba. distinctId = id do Clerk (casa com o funil do frontend).
    // O registro de eventos garante que isto sai UMA vez por checkout.
    try {
      const analyticsUser = await this.prisma.user.findUnique({
        where: { id: synced.userId },
        select: {
          clerkUserId: true,
          firstTouchAttribution: true,
          firstTouchAt: true,
          lastTouchAttribution: true,
          lastTouchAt: true,
        },
      });
      const distinctId = String(
        analyticsUser?.clerkUserId || session.metadata?.clerkUserId || '',
      ).trim();
      // Era `subscription_activated`, com o MESMO nome do evento do navegador
      // no retorno do checkout: a receita contava em dobro (medido: 20 eventos
      // do webhook em 4 ids + 3 do navegador para 3 assinaturas reais).
      captureServer(
        distinctId,
        'checkout_completed',
        {
          source: 'stripe_webhook',
          checkoutSource: session.metadata?.checkoutSource,
          sessionId: session.id,
          subscriptionId: synced.subscription.id,
          priceId: synced.subscription.items?.data?.[0]?.price?.id,
          value: (session.amount_total ?? 0) / 100,
          currency: String(session.currency || 'usd').toUpperCase(),
          coupon: session.metadata?.coupon || null,
          ...this.posthogAttributionProperties(analyticsUser),
        },
        { dedupeKey: `checkout_completed:${session.id}`, timestamp: new Date(session.created * 1000) },
      );
    } catch {
      /* analytics nunca pode quebrar o webhook */
    }
  }

  private stripeAttributionMetadata(user: {
    firstTouchAttribution?: Prisma.JsonValue | null;
    lastTouchAttribution?: Prisma.JsonValue | null;
  }): Record<string, string> {
    return {
      ...this.flattenAttributionForStripe('ft', this.asAttributionRecord(user.firstTouchAttribution)),
      ...this.flattenAttributionForStripe('lt', this.asAttributionRecord(user.lastTouchAttribution)),
    };
  }

  private posthogAttributionProperties(user?: {
    firstTouchAttribution: Prisma.JsonValue | null;
    firstTouchAt: Date | null;
    lastTouchAttribution: Prisma.JsonValue | null;
    lastTouchAt: Date | null;
  } | null): Record<string, unknown> {
    if (!user) return {};
    const first = this.asAttributionRecord(user.firstTouchAttribution);
    const last = this.asAttributionRecord(user.lastTouchAttribution);
    return {
      firstTouchAttribution: first,
      firstTouchAt: user.firstTouchAt?.toISOString(),
      lastTouchAttribution: last,
      lastTouchAt: user.lastTouchAt?.toISOString(),
      firstUtmSource: first?.utmSource,
      firstUtmCampaign: first?.utmCampaign,
      lastUtmSource: last?.utmSource,
      lastUtmCampaign: last?.utmCampaign,
    };
  }

  private flattenAttributionForStripe(
    prefix: 'ft' | 'lt',
    attribution: AttributionRecord | null,
  ): Record<string, string> {
    if (!attribution) return {};
    const map: Array<[string, string]> = [
      ['source', 'utmSource'],
      ['medium', 'utmMedium'],
      ['campaign', 'utmCampaign'],
      ['content', 'utmContent'],
      ['term', 'utmTerm'],
      ['campaign_id', 'campaignId'],
      ['adset_id', 'adsetId'],
      ['ad_id', 'adId'],
      ['click_id', 'clickId'],
      ['landing', 'landingPath'],
      ['ref_domain', 'referrerDomain'],
    ];

    const out: Record<string, string> = {};
    for (const [stripeKey, sourceKey] of map) {
      const value = attribution[sourceKey];
      if (typeof value === 'string' && value.trim()) {
        out[`${prefix}_${stripeKey}`] = value.trim().slice(0, 500);
      }
    }
    return out;
  }

  private asAttributionRecord(value: Prisma.JsonValue | null | undefined): AttributionRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as AttributionRecord;
  }

  private async creditTicksFromCompletedCheckout(session: Stripe.Checkout.Session) {
    const userId = String(session.metadata?.userId || '').trim();
    const packageId = String(session.metadata?.packageId || '').trim();
    const ticks = Number(session.metadata?.ticks || 0);
    const paymentIntentId = String(session.payment_intent || '').trim() || null;

    if (!userId || !Number.isFinite(ticks) || ticks <= 0) {
      this.logger.error('[Ticks] Invalid checkout metadata for ticks purchase', {
        sessionId: session.id,
        userId,
        packageId,
        ticks: session.metadata?.ticks,
      });
      return;
    }

    if (paymentIntentId) {
      const existing = await this.prisma.tickTransaction.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
        select: { id: true },
      });
      if (existing) {
        this.logger.log(
          `[Ticks] Duplicate webhook ignored for payment intent ${paymentIntentId}`,
        );
        return;
      }
    }

    try {
      await this.prisma.$transaction([
        this.prisma.userTicks.upsert({
          where: { userId },
          create: { userId, balance: ticks },
          update: { balance: { increment: ticks } },
        }),
        this.prisma.tickTransaction.create({
          data: {
            userId,
            amount: ticks,
            type: 'PURCHASE',
            description: `Purchase: ${packageId}, ${ticks} Ticks`,
            stripePaymentIntentId: paymentIntentId,
            metadata: {
              stripeCheckoutSessionId: session.id,
              packageId,
            },
          },
        }),
      ]);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        paymentIntentId
      ) {
        this.logger.log(
          `[Ticks] Duplicate purchase ignored by unique constraint for ${paymentIntentId}`,
        );
        return;
      }
      throw error;
    }

    this.logger.log(`[Ticks] +${ticks} creditados para ${userId}`);
  }

  /**
   * `created` e `updated` fazem a mesma coisa: releem a assinatura na Stripe e
   * gravam o estado ATUAL. A Stripe nao garante ordem de entrega; gravar o
   * payload deixava um `updated` atrasado reativar uma assinatura ja cancelada.
   */
  private async handleSubscriptionChanged(subscription: Stripe.Subscription, eventType?: string) {
    const synced = await this.syncSubscriptionFromStripe(subscription.id, {
      userIdHint: subscription.metadata?.userId ?? null,
    });
    if (!synced) {
      throw new Error(
        `User not found for subscription ${subscription.id} (customer ${String(subscription.customer || '')})`,
      );
    }

    if (eventType === 'customer.subscription.created') {
      await this.captureForUser(
        synced.userId,
        'subscription_created',
        {
          subscriptionId: synced.subscription.id,
          status: synced.subscription.status,
          priceId: synced.subscription.items.data[0]?.price.id ?? null,
          checkoutSource: synced.subscription.metadata?.checkoutSource ?? null,
        },
        {
          dedupeKey: `subscription_created:${synced.subscription.id}`,
          timestamp: new Date(synced.subscription.created * 1000),
        },
        true,
      );
    }
  }

  /**
   * Evento de produto para o dono de uma assinatura/fatura. distinctId = id do
   * Clerk (o mesmo do identify do navegador). Nunca quebra o webhook.
   */
  private async captureForUser(
    userId: string | null,
    event: string,
    properties: Record<string, unknown>,
    options: CaptureOptions,
    withAttribution = false,
  ): Promise<void> {
    if (!userId) return;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          clerkUserId: true,
          firstTouchAttribution: true,
          firstTouchAt: true,
          lastTouchAttribution: true,
          lastTouchAt: true,
        },
      });
      if (!user?.clerkUserId) return;
      captureServer(
        user.clerkUserId,
        event,
        { ...properties, ...(withAttribution ? this.posthogAttributionProperties(user) : {}) },
        options,
      );
    } catch {
      /* analytics nunca pode quebrar o webhook */
    }
  }

  /**
   * Cancelamento. Relido na Stripe tambem: o status vem `canceled`. Sem
   * usuario conhecido nao ha o que liberar, entao so marca a linha, se houver.
   */
  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const synced = await this.syncSubscriptionFromStripe(subscription.id, {
      userIdHint: subscription.metadata?.userId ?? null,
    });

    if (!synced) {
      await this.prisma.subscription.updateMany({
        where: { stripeId: subscription.id },
        data: { status: 'canceled' },
      });
      this.logger.warn(`[webhook] Assinatura ${subscription.id} cancelada sem usuario conhecido.`);
      return;
    }

    this.logger.log(
      `Subscription ${subscription.id} marked as ${synced.subscription.status} for user ${synced.userId}`,
    );
  }

  /**
   * Fatura paga: sincroniza SO a assinatura desta fatura (antes era
   * `updateMany` em todas as do usuario, o que reativava as canceladas) e
   * credita os ticks do periodo UMA vez, pela chave da fatura.
   */
  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    const { subscriptionId, userIdHint } = this.invoiceSubscriptionRef(invoice);
    if (!subscriptionId) {
      this.logger.log(`[webhook] Fatura ${invoice.id} sem assinatura; nada a fazer.`);
      return;
    }

    const synced = await this.syncSubscriptionFromStripe(subscriptionId, { userIdHint });
    if (!synced) {
      throw new Error(`User not found for invoice ${invoice.id} (subscription ${subscriptionId})`);
    }

    this.logger.log(`Payment succeeded for user: ${synced.userId} (invoice ${invoice.id})`);

    // Receita confirmada (primeira cobranca e renovacoes). So o backend emite.
    const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
    await this.captureForUser(
      synced.userId,
      'payment_succeeded',
      {
        invoiceId: invoice.id,
        subscriptionId,
        billingReason: invoice.billing_reason ?? null,
        value: (invoice.amount_paid ?? 0) / 100,
        currency: String(invoice.currency || 'usd').toUpperCase(),
      },
      { dedupeKey: `payment_succeeded:${invoice.id}`, timestamp: new Date(paidAt * 1000) },
    );

    // Troca de plano/proration tambem gera fatura paga. So a criacao e a
    // renovacao abrem a janela do mes.
    const reason = invoice.billing_reason ?? '';
    if (!['subscription_create', 'subscription_cycle'].includes(reason)) {
      this.logger.log(`[Ticks] Fatura ${invoice.id} (${reason}) nao abre janela de ticks.`);
      return;
    }

    // Erro aqui SOBE: antes era engolido e o assinante ficava sem os ticks do
    // mes, com o webhook respondendo 200. A chave da janela impede reset duplo
    // quando a Stripe reenviar.
    await this.applyMonthlyAllowance(
      synced.userId,
      {
        stripeId: synced.subscription.id,
        priceId: synced.subscription.items.data[0]?.price.id ?? null,
        periodStart: new Date(synced.subscription.current_period_start * 1000),
      },
      'invoice_webhook',
    );
  }

  /**
   * Falha de pagamento: o status vem da Stripe (`past_due`, `incomplete`...)
   * so para a assinatura desta fatura, e a falha fica REGISTRADA no
   * AdminAudit, alem do log. Antes marcava todas as assinaturas do usuario
   * como `past_due`, inclusive as canceladas, e nao guardava nada.
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const { subscriptionId, userIdHint } = this.invoiceSubscriptionRef(invoice);
    const synced = subscriptionId
      ? await this.syncSubscriptionFromStripe(subscriptionId, { userIdHint })
      : null;

    const userId = synced?.userId ?? (await this.findUserIdByCustomer(invoice.customer));
    const details = {
      invoiceId: invoice.id,
      subscriptionId,
      subscriptionStatus: synced?.subscription.status ?? null,
      amountDue: invoice.amount_due,
      currency: invoice.currency,
      attemptCount: invoice.attempt_count,
      billingReason: invoice.billing_reason,
      nextPaymentAttempt: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toISOString()
        : null,
      customerId: String(invoice.customer || ''),
    };

    this.logger.warn(`Payment failed for user: ${userId ?? 'desconhecido'} ${JSON.stringify(details)}`);

    await this.prisma.adminAudit.create({
      data: {
        action: 'stripe_payment_failed',
        targetUserId: userId,
        targetEmail: invoice.customer_email ?? null,
        details,
      },
    });

    // Uma por tentativa de cobranca: a Stripe tenta de novo em outros dias, e
    // cada tentativa falha e um fato proprio. Reenvio do MESMO evento nao duplica.
    await this.captureForUser(userId, 'payment_failed', details, {
      dedupeKey: `payment_failed:${invoice.id}:${invoice.attempt_count ?? 0}`,
      timestamp: new Date(invoice.created * 1000),
    });
  }

  /**
   * Assinatura e dono da fatura, nos DOIS formatos da API.
   *
   * ⚠️ O endpoint de webhook esta na API `2025-07-30.basil` (conferido no
   * painel da Stripe em 21/09/2026), e o payload vem na versao do ENDPOINT, nao
   * na do SDK (`2023-10-16`). Desde a basil a fatura nao tem mais
   * `subscription` no topo: o id mora em `parent.subscription_details`. O
   * handler antigo lia so `invoice.subscription`, recebia undefined e saia sem
   * creditar os ticks: o credito por fatura nunca funcionou em producao.
   */
  private invoiceSubscriptionRef(invoice: Stripe.Invoice): {
    subscriptionId: string | null;
    userIdHint: string | null;
  } {
    type Ref = string | { id: string } | null | undefined;
    const raw = invoice as unknown as {
      subscription?: Ref;
      subscription_details?: { metadata?: Record<string, string> | null } | null;
      parent?: {
        subscription_details?: { subscription?: Ref; metadata?: Record<string, string> | null } | null;
      } | null;
    };
    const ref = raw.parent?.subscription_details?.subscription ?? raw.subscription ?? null;
    const subscriptionId = typeof ref === 'string' ? ref : ref?.id ?? null;
    const metadata = raw.parent?.subscription_details?.metadata ?? raw.subscription_details?.metadata ?? null;
    return { subscriptionId, userIdHint: metadata?.userId ?? null };
  }

  /**
   * Saldo do mes: o assinante tem NO MAXIMO o pacote do plano (200 no
   * starter). No inicio de cada janela mensal o saldo passa a ser exatamente o
   * pacote: nao soma, nao acumula, sobra do mes anterior nao passa.
   *
   * Uma vez por janela: a chave `allowance:<assinatura>:<inicio da janela>`
   * vai na coluna unica `stripePaymentIntentId` (a mesma trava dos pacotes
   * avulsos). Webhook da fatura, sync preguicoso e a checagem da analise usam
   * a mesma chave, entao chegam no mesmo reset e so um grava.
   *
   * Regra decidida pelo dono em 21/09/2026. Substitui o "+200 por fatura" e o
   * "+200 sempre que o saldo zerava" (este ultimo era tick sem pagamento).
   */
  private async applyMonthlyAllowance(
    userId: string,
    subscription: { stripeId: string; priceId: string | null; periodStart: Date | null },
    source: 'invoice_webhook' | 'lazy_sync' | 'access_check',
    now = new Date(),
  ): Promise<boolean> {
    const allowance = monthlyTicksForPriceId(subscription.priceId);
    if (allowance <= 0) {
      this.logger.warn(`[Ticks] priceId ${subscription.priceId} nao mapeado a nenhum plano; saldo intocado.`);
      return false;
    }

    const windowStart = allowanceWindowStart(subscription.periodStart, now);
    const key = `allowance:${subscription.stripeId}:${windowStart.toISOString().slice(0, 10)}`;

    // Caminho de toda analise: uma consulta pela chave unica e acabou.
    const applied = await this.prisma.tickTransaction.findUnique({
      where: { stripePaymentIntentId: key },
      select: { id: true },
    });
    if (applied) return false;

    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.userTicks.findUnique({ where: { userId }, select: { balance: true } });
        const previous = current?.balance ?? 0;
        await tx.userTicks.upsert({
          where: { userId },
          create: { userId, balance: allowance },
          update: { balance: allowance },
        });
        await tx.tickTransaction.create({
          data: {
            userId,
            // Diferenca real no saldo (pode ser negativa: quem tinha mais que
            // o teto volta para ele). O historico continua somando certo.
            amount: allowance - previous,
            type: 'BONUS',
            description: `Monthly allowance: saldo definido em ${allowance} Ticks`,
            stripePaymentIntentId: key,
            metadata: {
              source,
              reset: true,
              previousBalance: previous,
              allowance,
              subscriptionId: subscription.stripeId,
              priceId: subscription.priceId,
              windowStart: windowStart.toISOString(),
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(`[Ticks] Janela ${key} ja aplicada por outro caminho; ignorado.`);
        return false;
      }
      throw error;
    }

    this.logger.log(`[Ticks] Saldo de ${userId} definido em ${allowance} (${key}, ${source})`);
    return true;
  }

  /**
   * Rele a assinatura na Stripe e grava o estado atual. Assinatura que a
   * Stripe nao conhece mais (`resource_missing`) vira `canceled`.
   */
  private async syncSubscriptionFromStripe(
    subscriptionId: string,
    options: { userIdHint?: string | null } = {},
  ): Promise<{ userId: string; subscription: Stripe.Subscription } | null> {
    let subscription: Stripe.Subscription;
    try {
      subscription = await this.getStripeClient().subscriptions.retrieve(subscriptionId);
    } catch (error) {
      if ((error as { code?: string })?.code === 'resource_missing') {
        await this.prisma.subscription.updateMany({
          where: { stripeId: subscriptionId },
          data: { status: 'canceled' },
        });
        this.logger.warn(`[webhook] Assinatura ${subscriptionId} nao existe mais na Stripe; marcada canceled.`);
        return null;
      }
      throw error;
    }

    // Sem dono: devolve null e QUEM CHAMOU decide. created/updated/paga lancam
    // (a Stripe reenvia); cancelamento e falha de pagamento seguem sem usuario.
    const userId = await this.resolveUserIdForSubscription(subscription, options.userIdHint);
    if (!userId) return null;

    await this.upsertSubscriptionForUser(userId, subscription);
    return { userId, subscription };
  }

  /**
   * Dono da assinatura, da fonte mais confiavel para a menos: a linha que ja
   * existe no banco, a pista do evento, o customer vinculado ao usuario, e a
   * metadata gravada na assinatura e no customer na criacao.
   */
  private async resolveUserIdForSubscription(
    subscription: Stripe.Subscription,
    userIdHint?: string | null,
  ): Promise<string | null> {
    const existing = await this.prisma.subscription.findUnique({
      where: { stripeId: subscription.id },
      select: { userId: true },
    });
    if (existing) return existing.userId;

    const candidates = [userIdHint, subscription.metadata?.userId].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    for (const candidate of candidates) {
      const user = await this.prisma.user.findUnique({ where: { id: candidate }, select: { id: true } });
      if (user) return user.id;
    }

    const byCustomer = await this.findUserIdByCustomer(subscription.customer);
    if (byCustomer) return byCustomer;

    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    if (!customerId) return null;
    try {
      const customer = await this.getStripeClient().customers.retrieve(customerId);
      const metaUserId = 'deleted' in customer && customer.deleted ? null : customer.metadata?.userId;
      if (metaUserId) {
        const user = await this.prisma.user.findUnique({ where: { id: metaUserId }, select: { id: true } });
        if (user) {
          await this.linkCustomerIfMissing(user.id, customerId);
          return user.id;
        }
      }
    } catch (error) {
      if ((error as { code?: string })?.code !== 'resource_missing') throw error;
    }
    return null;
  }

  private async findUserIdByCustomer(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): Promise<string | null> {
    const customerId = typeof customer === 'string' ? customer : customer?.id;
    if (!customerId) return null;
    const user = await this.prisma.user.findFirst({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /** Grava o customer no usuario so se ele ainda nao tiver um. */
  private async linkCustomerIfMissing(
    userId: string,
    customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  ) {
    const customerId = typeof customer === 'string' ? customer : customer?.id;
    if (!customerId) return;
    await this.prisma.user.updateMany({
      where: { id: userId, stripeCustomerId: null },
      data: { stripeCustomerId: customerId },
    });
  }

  /**
   * Chamado a cada verificacao de acesso pago (toda analise e toda abertura
   * do painel, via /usage): garante que a janela mensal atual ja foi aplicada.
   *
   * O periodo vem do banco. So consulta a Stripe se ele estiver ausente ou
   * vencido (renovacao cujo webhook ainda nao chegou), e grava o novo.
   * Acesso manual (`manual_*`) usa o mes-calendario.
   */
  async ensureTicksForActiveSubscriber(
    userId: string,
    subscription: {
      stripeId: string;
      priceId: string | null;
      currentPeriodStart?: Date | null;
      currentPeriodEnd?: Date | null;
    },
  ): Promise<void> {
    try {
      let periodStart = subscription.currentPeriodStart ?? null;
      let priceId = subscription.priceId;

      if (subscription.stripeId.startsWith('sub_')) {
        const stale =
          !periodStart ||
          !subscription.currentPeriodEnd ||
          subscription.currentPeriodEnd.getTime() <= Date.now();
        if (stale) {
          const live = await this.getStripeClient().subscriptions.retrieve(subscription.stripeId);
          await this.upsertSubscriptionForUser(userId, live);
          if (!['active', 'trialing'].includes(live.status)) return;
          periodStart = new Date(live.current_period_start * 1000);
          priceId = live.items.data[0]?.price.id ?? priceId;
        }
      } else {
        periodStart = null;
      }

      await this.applyMonthlyAllowance(
        userId,
        { stripeId: subscription.stripeId, priceId, periodStart },
        'access_check',
      );
    } catch (error) {
      // Chamado dentro do fluxo de analise: nao pode derrubar a analise. O
      // webhook da fatura segue abrindo a janela de cada renovacao.
      this.logger.error(`[Ticks] Falha ao verificar a janela mensal de ${userId}`, error);
    }
  }

  /**
   * Lazy sync: fetch active subscriptions directly from Stripe and upsert to DB.
   * Used as fallback when webhook delivery fails.
   */
  async syncActiveSubscriptionFromStripe(userId: string, stripeCustomerId: string): Promise<boolean> {
    try {
      const stripe = this.getStripeClient();
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: 'all',
        limit: 5,
      });

      const active = subscriptions.data.filter(s =>
        ['active', 'trialing'].includes(s.status),
      );

      if (active.length === 0) return false;

      for (const sub of active) {
        await this.upsertSubscriptionForUser(userId, sub);
      }

      // Mesma janela do webhook: se ele chegar depois, a chave ja existe.
      const first = active[0];
      await this.applyMonthlyAllowance(
        userId,
        {
          stripeId: first.id,
          priceId: first.items.data[0]?.price.id ?? null,
          periodStart: new Date(first.current_period_start * 1000),
        },
        'lazy_sync',
      );

      this.logger.log(`[LazySync] Synced ${active.length} subscription(s) for user ${userId}`);
      return true;
    } catch (err) {
      this.logger.error('[LazySync] Failed to sync from Stripe', err);
      return false;
    }
  }

  private async upsertSubscriptionForUser(userId: string, subscription: Stripe.Subscription) {
    await this.prisma.subscription.upsert({
      where: { stripeId: subscription.id },
      create: {
        userId,
        stripeId: subscription.id,
        status: subscription.status,
        priceId: subscription.items.data[0]?.price.id || null,
        ...this.periodColumns(subscription),
      },
      update: {
        status: subscription.status,
        priceId: subscription.items.data[0]?.price.id || null,
        ...this.periodColumns(subscription),
      },
    });
  }

  private periodColumns(subscription: Stripe.Subscription) {
    const start = subscription.current_period_start;
    const end = subscription.current_period_end;
    return {
      currentPeriodStart: typeof start === 'number' ? new Date(start * 1000) : null,
      currentPeriodEnd: typeof end === 'number' ? new Date(end * 1000) : null,
    };
  }

  private rethrowStripeError(error: unknown, fallbackMessage: string): never {
    if (
      error instanceof BadRequestException ||
      error instanceof ServiceUnavailableException ||
      error instanceof InternalServerErrorException
    ) {
      throw error;
    }

    const stripeError = error as {
      type?: string;
      code?: string;
      message?: string;
    };

    if (stripeError?.type === 'StripeInvalidRequestError' || stripeError?.code === 'resource_missing') {
      throw new BadRequestException(stripeError.message || fallbackMessage);
    }

    if (
      stripeError?.type === 'StripeAuthenticationError' ||
      stripeError?.type === 'StripePermissionError' ||
      stripeError?.type === 'StripeRateLimitError' ||
      stripeError?.type === 'StripeAPIError' ||
      stripeError?.type === 'StripeConnectionError'
    ) {
      throw new ServiceUnavailableException(stripeError.message || fallbackMessage);
    }

    if (error instanceof Error && error.message) {
      throw new BadRequestException(error.message);
    }

    throw new InternalServerErrorException(fallbackMessage);
  }
}
