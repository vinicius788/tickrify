import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { markTrialConverted } from '../../common/trial';
import { PrismaService } from '../database/prisma.service';
import { captureServer, type CaptureOptions } from '../../common/analytics/posthog';
import { sendMetaEvent, type MetaAdsContext } from '../../common/analytics/meta-capi';
import { funnelLog, safeErrorFields } from '../../common/observability/funnel-log';
import {
  FOUNDER_CLOSED,
  FOUNDER_COUPON_ID,
  FOUNDING_COUPON_ID,
  createFounderPromotionCode,
  ensureFounderCoupon,
  findFounderPromotion,
  founderOfferFromPromotion,
  getFoundingOffer,
  type FounderOffer,
  type FoundingOffer,
} from './founding-offer';
import { AffiliatesService, type ReferralKind } from '../affiliates/affiliates.service';
import { MailService } from '../mail/mail.service';
import { flagBool } from '../../common/flags/feature-flags';
import {
  getStripeConfig,
  portalV2Configuration,
  portalCatalog,
  portalUpgradeEnabled,
  PORTAL_V2_API_VERSION,
  getPriceId,
  resolvePlanForPriceId,
  billingCycleForPriceId,
  allowanceForPriceId,
  allowanceCadenceForPriceId,
  allowanceWindowStart,
  PlanType,
  BillingCycle,
  Currency,
  stripeKeyMode,
} from '../../config/stripe.config';

type AttributionRecord = Record<string, unknown>;

type CheckoutResult = { sessionId: string; url: string; reused: boolean };

/** Motivo da recusa e perfil do cartao de uma cobranca (so analytics, nunca dado de cartao). */
type InvoiceAttemptDetails = {
  declineCode: string | null;
  failureCode: string | null;
  networkDeclineCode: string | null;
  adviceCode: string | null;
  cardCountry: string | null;
  cardFunding: string | null;
  cardBrand: string | null;
  cardWallet: string | null;
};

/**
 * Folga entre o evento de falha e a cobranca que o originou (a cobranca nasce
 * segundos antes do evento). Uma cobranca mais nova que isso e de outra tentativa.
 */
const ATTEMPT_MATCH_TOLERANCE_MS = 60 * 1000;

/** Link/cupom de afiliado guardado no navegador, conferido no servidor antes do checkout. */
export type CheckoutReferral = { code: string; kind: ReferralKind; clickId?: string | null };

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

/** Status em que a pessoa ainda tem o que gerenciar no portal (cartao, faturas, cancelar). */
const MANAGEABLE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

function hasCurrentStripeAccess(subscription: Pick<Stripe.Subscription, 'status' | 'current_period_end'>): boolean {
  return ['active', 'trialing'].includes(subscription.status) &&
    Number.isFinite(subscription.current_period_end) && subscription.current_period_end * 1000 > Date.now();
}

/**
 * Portal da Stripe criado por API (13/10/2026), identificado pela metadata.
 * Cancelamento no FIM do periodo pago, motivo em lista fechada, troca de
 * cartao e faturas; sem troca de plano e sem tela de retencao. Mudar algo
 * aqui = subir a versao, para criar uma configuracao nova em vez de editar a
 * que ja esta em uso.
 */
const PORTAL_CONFIG_TAG = 'portal_v1';

/** Cancelamento agendado, nos dois modos de cobranca da Stripe (classico e flexivel). */
export function cancelScheduled(subscription: Pick<Stripe.Subscription, 'cancel_at_period_end' | 'cancel_at' | 'status'>): boolean {
  if (subscription.status === 'canceled') return false;
  return Boolean(subscription.cancel_at_period_end) || typeof subscription.cancel_at === 'number';
}

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

  private portalConfigurationId: string | null = null;

  constructor(
    private prisma: PrismaService,
    private affiliates: AffiliatesService,
    @Optional() private readonly mail?: MailService,
  ) {
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
      // Cancelamento (13/10/2026). Fora do schema.prisma de proposito, como o
      // clientContext: o upsert do client nao depende delas. Gravadas por SQL
      // em `recordCancellationColumns`. Mesmo conteudo da migracao 20261013140000.
      for (const column of [
        '"cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false',
        '"cancelAt" TIMESTAMP(3)',
        '"canceledAt" TIMESTAMP(3)',
        '"endedAt" TIMESTAMP(3)',
        '"cancelReason" TEXT',
        '"cancelFeedback" TEXT',
      ]) {
        await this.prisma.$executeRawUnsafe(`ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS ${column}`);
      }
      this.logger.log('[webhook] Registro de eventos pronto.');
    } catch (error) {
      this.logger.error('[webhook] Nao consegui garantir a tabela StripeWebhookEvent.', error);
    }
  }

  /** Oferta EARLY35 como a Stripe a ve agora (cache de 10 min). */
  getFoundingOffer(): Promise<FoundingOffer> {
    return getFoundingOffer(this.stripe);
  }

  /**
   * Oferta Founding Member de UM codigo (link pessoal). Nunca lanca: erro da
   * Stripe = oferta fechada, e a vitrine so mostra o que o servidor confirma.
   */
  async getFounderOffer(code: string): Promise<FounderOffer> {
    if (!this.stripe) return FOUNDER_CLOSED;
    try {
      return founderOfferFromPromotion(await findFounderPromotion(this.stripe, code));
    } catch (error) {
      this.logger.warn(`[founder] Consulta do codigo falhou: ${error instanceof Error ? error.message : String(error)}`);
      return FOUNDER_CLOSED;
    }
  }

  /** Cria (se preciso) o cupom das vagas e um codigo pessoal para `userId`. Uso: campanha do /admin. */
  async issueFounderCode(userId: string, expiresAt: number): Promise<{ id: string; code: string }> {
    const stripe = this.getStripeClient();
    await ensureFounderCoupon(stripe);
    return createFounderPromotionCode(stripe, { userId, expiresAt });
  }

  /** Desativa um codigo que nao chegou a sair (e-mail recusado pelo provedor). */
  async revokeFounderCode(promotionCodeId: string): Promise<void> {
    await this.getStripeClient().promotionCodes.update(promotionCodeId, { active: false });
  }

  /** Vagas usadas, para a conferencia do /admin. null = cupom ainda nao criado. */
  async founderSeats(): Promise<{ used: number; total: number | null; valid: boolean } | null> {
    try {
      const coupon = await this.getStripeClient().coupons.retrieve(FOUNDER_COUPON_ID);
      return { used: coupon.times_redeemed, total: coupon.max_redemptions, valid: coupon.valid };
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 404) return null;
      throw error;
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

  private founderUnavailable(userId: string): ConflictException {
    this.logger.warn(`[founder] Codigo recusado para o usuario ${userId}.`);
    return new ConflictException({
      code: 'founder_offer_unavailable',
      message: 'This offer is no longer available. The regular plans are still open.',
    });
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
    source?: 'pricing' | 'locked_value' | 'last_free_result' | 'upgrade_modal',
    ads: MetaAdsContext = { consent: false },
    referral?: CheckoutReferral,
    founderCode?: string,
  ): Promise<CheckoutResult> {
    const inFlight = this.checkoutInFlight.get(clerkUserId);
    if (inFlight) {
      this.logger.log(`[stripe] Checkout de ${clerkUserId} ja em andamento; reaproveitando o mesmo pedido.`);
      return inFlight;
    }

    const run = this.createCheckoutSessionUnlocked(clerkUserId, planType, billingCycle, currency, couponId, source, ads, referral, founderCode)
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
    source?: 'pricing' | 'locked_value' | 'last_free_result' | 'upgrade_modal',
    ads: MetaAdsContext = { consent: false },
    referral?: CheckoutReferral,
    founderCode?: string,
  ): Promise<CheckoutResult> {
    const startedAt = Date.now();
    // Resolvido logo que o usuario e lido; os logs de erro usam o que houver.
    let funnelUser: string = clerkUserId;
    funnelLog('checkout_requested', { user: clerkUserId, plan: planType, cycle: billingCycle, source });
    try {
      if (!['starter', 'pro', 'elite'].includes(planType)) {
        throw new BadRequestException({ code: 'invalid_plan', message: `Invalid plan type: ${planType}` });
      }

      this.assertLiveModeInProduction();

      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
      });

      if (user) funnelUser = user.id;
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

      // Cupom esgotado ou expirado nao vai para a sessao: a vitrine ja parou de
      // anuncia-lo, e a sessao sem ele abre de primeira em vez de depender do
      // fallback de erro mais abaixo.
      // EARLY35 e "35% no primeiro MES": vale SO no mensal (decisao de
      // 05/10/2026). No semanal viraria 35% da primeira semana, e no anual
      // 35% de US$ 290 (US$ 188,50), o que nenhuma pagina promete. A regra
      // mora AQUI: a vitrine so mostra o desconto onde o servidor aplica.
      if (billingCycle !== 'monthly') couponId = undefined;

      // Founding Member (link pessoal): valida o codigo na Stripe ANTES de abrir
      // a sessao. Codigo recusado NUNCA cai no preco cheio em silencio: quem
      // clicou esperando US$ 15 e chegasse num checkout de US$ 29 sentiria que
      // foi enganado. Falha explicita e a tela explica.
      let founderPromotionId: string | undefined;
      if (founderCode) {
        const promo = billingCycle === 'monthly' ? await findFounderPromotion(stripe, founderCode) : null;
        if (!founderOfferFromPromotion(promo).active) throw this.founderUnavailable(user.id);
        founderPromotionId = promo?.id;
        couponId = undefined;
      }
      if (couponId === FOUNDING_COUPON_ID && !(await this.getFoundingOffer()).active) {
        this.logger.warn(`[stripe] ${FOUNDING_COUPON_ID} sem usos ou expirado; checkout sem desconto.`);
        couponId = undefined;
      }

      // Afiliado: o vinculo e conferido AQUI (clique de ate 30 dias, sem
      // self-referral), porque a retomada do checkout depois do login pode
      // chegar antes da chamada de atribuicao do navegador. Nunca bloqueia.
      if (referral) {
        try {
          await this.affiliates.claim(user.id, referral);
        } catch (error) {
          this.logger.warn(`[affiliate] Atribuicao no checkout falhou: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // UM desconto por sessao: vale o maior. O EARLY35 (35%) ganha dos 10% do
      // afiliado enquanto existir, porque a /pricing e o paywall prometem os
      // 35% "aplicados automaticamente" e a promessa tem que valer para todos.
      // A comissao sai sobre o valor pago de fato, entao o afiliado segue
      // recebendo pela indicacao (vinculo no banco, nao no cupom).
      let discount: Stripe.Checkout.SessionCreateParams.Discount | undefined = founderPromotionId
        ? { promotion_code: founderPromotionId }
        : couponId
          ? { coupon: couponId }
          : undefined;
      let discountLabel = founderPromotionId ? `founder:${founderCode}` : couponId ?? '';
      let affiliateId: string | null = null;
      if (!discount) {
        const affiliateDiscount = await this.affiliates.checkoutDiscountFor(user.id).catch(() => null);
        if (affiliateDiscount) {
          discount = affiliateDiscount.discount;
          affiliateId = affiliateDiscount.affiliateId;
          discountLabel = `aff:${affiliateDiscount.affiliateId}`;
        }
      }

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
          (open.metadata?.coupon ?? '') === discountLabel &&
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
        funnelLog(
          'checkout_session_reused',
          { user: user.id, session: reusable.id, plan: planType, cycle: billingCycle, source, durationMs: Date.now() - startedAt },
          { persist: this.prisma },
        );
        return { sessionId: reusable.id, url: reusable.url, reused: true };
      }

      const appBaseUrl = this.resolveAppBaseUrl();
      // `{CHECKOUT_SESSION_ID}` a Stripe troca pelo id real. E com ele que o
      // painel confirma no servidor que a sessao foi paga antes de disparar o
      // Purchase do pixel (com o mesmo event_id do servidor, para deduplicar).
      const successUrl = `${appBaseUrl}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`;
      // So quem esta logado abre checkout, entao cancelar volta para os Planos
      // DENTRO do painel (antes ia para a /pricing publica e o voltar do
      // navegador tirava a pessoa do app).
      const cancelUrl = `${appBaseUrl}/dashboard/plans?canceled=true${founderCode ? `&offer=${founderCode}` : ''}`;

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
        // 'auto': a Stripe pede so o que o cartao exige (pais, as vezes CEP).
        // 'required' abria o formulario de endereco inteiro no celular.
        billing_address_collection: 'auto',
        // Texto acima do botao de pagar (05/10/2026). Em 14 dias, 10 de 13
        // pessoas abriram o checkout e sairam sem digitar o cartao: o medo de
        // assinatura recorrente e a duvida "quando recebo" sao respondidos ali.
        // As duas frases sao verdadeiras: o portal da Stripe cancela pelo
        // painel, e os ticks entram pelo webhook logo apos o pagamento.
        custom_text: {
          submit: {
            message: 'Cancel anytime from your Tickrify dashboard. Your analyses are available right after payment.',
          },
        },
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
          ...(affiliateId ? { affiliateId } : {}),
          ...this.stripeAttributionMetadata(user),
          // Contexto do Meta, SO com aceite de cookies. E o que permite ao
          // webhook mandar o Purchase pela Conversions API com boa
          // correspondencia, horas depois, sem o navegador por perto.
          ...(ads.consent
            ? {
                ads_consent: '1',
                ...(ads.fbp ? { ads_fbp: ads.fbp } : {}),
                ...(ads.fbc ? { ads_fbc: ads.fbc.slice(0, 500) } : {}),
                ...(ads.ip ? { ads_ip: ads.ip.slice(0, 100) } : {}),
                ...(ads.userAgent ? { ads_ua: ads.userAgent.slice(0, 500) } : {}),
              }
            : {}),
        },
        // A assinatura nasce com o dono gravado nela. E o que permite ao
        // webhook achar o usuario mesmo se o vinculo pelo customer se perder.
        subscription_data: {
          metadata: {
            userId: user.id,
            clerkUserId,
            checkoutSource: source ?? 'unknown',
            ...(affiliateId ? { affiliateId } : {}),
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
       * Com o fallback, o cupom morto apenas deixa de descontar. Vale igual para
       * o desconto de afiliado.
       */
      // Campo de codigo digitavel SO no mensal (05/10/2026, decisao do dono):
      // o EARLY35 e "35% no 1o mes para os primeiros 50" e nao pode valer no
      // anual nem no semanal nem digitado a mao. O codigo promocional EARLY35
      // da Stripe vale para qualquer produto, entao a trava tem que ser aqui.
      const campoDeCodigo = billingCycle === 'monthly';
      const abrirCheckout = (comCupom: boolean) =>
        stripe.checkout.sessions.create({
          ...baseParams,
          metadata: { ...baseParams.metadata, coupon: comCupom && discount ? discountLabel : '' },
          ...(comCupom && discount
            ? { discounts: [discount] }
            : campoDeCodigo
              ? { allow_promotion_codes: true }
              : {}),
        });

      let session: Stripe.Checkout.Session;
      try {
        session = await abrirCheckout(Boolean(discount));
      } catch (erroCupom) {
        const recusouOCupom =
          Boolean(discount) &&
          erroCupom instanceof Error &&
          /coupon|promotion|discount/i.test(erroCupom.message);

        if (!recusouOCupom) throw erroCupom;
        // Founding Member: sem desconto nao ha oferta (ver acima).
        if (founderPromotionId) throw this.founderUnavailable(user.id);

        this.logger.warn(
          `[stripe] Desconto ${discountLabel} recusado pela Stripe (${erroCupom.message}). ` +
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

      funnelLog(
        'checkout_session_created',
        {
          user: user.id,
          session: session.id,
          plan: planType,
          cycle: billingCycle,
          source,
          amount: (session.amount_total ?? 0) / 100,
          currency,
          // O que a Stripe ofereceu de fato (sem `payment_method_types` na
          // criacao, quem decide e a configuracao do painel). Carteiras como
          // Apple Pay e Google Pay aparecem como `card`.
          paymentMethodTypes: session.payment_method_types?.join(','),
          paymentMethodConfig: session.payment_method_configuration_details?.id,
          durationMs: Date.now() - startedAt,
        },
        { persist: this.prisma },
      );

      // InitiateCheckout pelo servidor, com o mesmo event_id do pixel
      // (checkout_<sessao>): o Meta fica com um so. Fire-and-forget.
      void sendMetaEvent({
        eventName: 'InitiateCheckout',
        eventId: `checkout_${session.id}`,
        eventSourceUrl: `${appBaseUrl}/pricing`,
        user: { externalId: clerkUserId, email: user.email },
        ads,
        customData: { value: (session.amount_total ?? 0) / 100, currency, contentName: planType },
      });

      return {
        sessionId: session.id,
        url: session.url,
        reused: false,
      };
    } catch (error) {
      // O objeto de erro da Stripe carrega corpo e cabecalhos da resposta:
      // loga so o essencial (tipo, codigo, requestId, mensagem sanitizada).
      const httpError = error as { response?: { code?: string } };
      funnelLog(
        'checkout_failed',
        {
          user: funnelUser,
          plan: planType,
          source,
          ...safeErrorFields(error),
          ...(httpError?.response?.code ? { code: httpError.response.code } : {}),
          durationMs: Date.now() - startedAt,
        },
        { level: 'error', persist: funnelUser !== clerkUserId ? this.prisma : undefined },
      );
      this.rethrowCheckoutError(error);
    }
  }

  /**
   * Retorno da Stripe (ver StripeController.getCheckoutStatus). So confirma
   * sessao da PROPRIA pessoa: `client_reference_id` e o id dela no banco.
   */
  async getCheckoutStatus(
    clerkUserId: string,
    sessionId: string | null,
    outcome: 'success' | 'canceled',
  ): Promise<{ sessionId: string | null; paid: boolean; value: number | null; currency: string | null }> {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId }, select: { id: true } });
    const userId = user?.id ?? clerkUserId;

    if (!sessionId) {
      funnelLog('checkout_returned', { user: userId, outcome }, { persist: user ? this.prisma : undefined });
      return { sessionId: null, paid: false, value: null, currency: null };
    }

    try {
      const session = await this.getStripeClient().checkout.sessions.retrieve(sessionId);
      const mine = Boolean(user) && (session.client_reference_id === user!.id || session.metadata?.userId === user!.id);
      if (!mine) {
        funnelLog('checkout_returned', { user: userId, session: sessionId, outcome, reason: 'not_owner' }, { level: 'warn' });
        return { sessionId, paid: false, value: null, currency: null };
      }
      const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
      funnelLog(
        'checkout_returned',
        { user: userId, session: sessionId, outcome, status: session.status, paymentStatus: session.payment_status, paid },
        { persist: this.prisma },
      );
      return {
        sessionId,
        paid,
        value: paid ? (session.amount_total ?? 0) / 100 : null,
        currency: paid ? String(session.currency || 'usd').toUpperCase() : null,
      };
    } catch (error) {
      funnelLog('checkout_returned', { user: userId, session: sessionId, outcome, ...safeErrorFields(error) }, { level: 'warn' });
      return { sessionId, paid: false, value: null, currency: null };
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
   * Portal da Stripe (gerenciar cartao, faturas e cancelar). So para quem tem
   * assinatura da Stripe que ainda se gerencia: o customer vem do banco pelo
   * usuario do token, nunca do navegador. Quem nunca assinou (ou so abriu um
   * checkout) recebe 403 e a tela nem mostra o botao.
   */
  async createCustomerPortal(clerkUserId: string, upgrade = false) {
    try {
      const stripe = this.getStripeClient();
      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true, stripeCustomerId: true },
      });
      const subscription = user
        ? await this.prisma.subscription.findFirst({
            where: { userId: user.id, stripeId: { startsWith: 'sub_' }, status: { in: MANAGEABLE_SUBSCRIPTION_STATUSES } },
            select: { stripeId: true },
          })
        : null;
      if (!user?.stripeCustomerId || !subscription) {
        throw new ForbiddenException({ code: 'no_subscription', message: 'There is no subscription to manage.' });
      }

      // The rollout is checked against the internal user ID resolved from authentication.
      if (upgrade && !portalUpgradeEnabled(user.id)) throw new ForbiddenException('Plan upgrade is not enabled for this user.');
      const live = upgrade && portalUpgradeEnabled(user.id) ? await stripe.subscriptions.retrieve(subscription.stripeId) : null;
      const eligible = live?.status === 'active' && !live.schedule && !live.pending_update && !cancelScheduled(live) &&
        live.items.data.length === 1 && live.items.data[0].quantity === 1 && live.items.data[0].price.id === portalCatalog().weekly;
      if (upgrade && !eligible) throw new ConflictException('This subscription cannot be upgraded.');
      const v2 = eligible ? process.env.STRIPE_PORTAL_V2_CONFIG_ID?.trim() : undefined;
      if (eligible && !v2) throw new ServiceUnavailableException('Upgrade portal is not configured.');
      if (v2) {
        // Provisioning is deliberately external; opening a session never creates v2.
        const config = await stripe.billingPortal.configurations.retrieve(v2, { expand: ['features.subscription_update.products'] }, { apiVersion: PORTAL_V2_API_VERSION });
        const expected = portalV2Configuration(this.resolveAppBaseUrl()).features.subscription_update;
        const update = config.features.subscription_update;

        if (!config.active || config.metadata?.tickrify !== 'portal_v2' || !update.enabled ||
            JSON.stringify(update.default_allowed_updates) !== JSON.stringify(expected.default_allowed_updates) ||
            update.proration_behavior !== expected.proration_behavior ||
            (!update.products || update.products.length !== 1 || update.products[0].product !== expected.products[0].product ||
              JSON.stringify([...update.products[0].prices].sort()) !== JSON.stringify([...expected.products[0].prices].sort())) ||
            config.livemode !== (stripeKeyMode(getStripeConfig().secretKey) === 'live')) {
          throw new ServiceUnavailableException('Billing portal configuration has not been verified.');
        }
      }
      const configuration = v2 || await this.ensurePortalConfiguration();
      const params: Stripe.BillingPortal.SessionCreateParams = {
        customer: user.stripeCustomerId,
        return_url: `${this.resolveAppBaseUrl()}/dashboard/settings`,
        ...(configuration ? { configuration } : {}),
        ...(v2 && live ? { flow_data: {
          type: 'subscription_update_confirm' as const,
          subscription_update_confirm: { subscription: live.id, items: [{ id: live.items.data[0].id, price: portalCatalog().monthly, quantity: 1 }] },
        } } : {}),
      };
      const session = v2
        ? await stripe.billingPortal.sessions.create(params, { apiVersion: PORTAL_V2_API_VERSION })
        : await stripe.billingPortal.sessions.create(params);

      captureServer(clerkUserId, 'billing_portal_opened', { subscriptionId: subscription.stripeId });
      return { url: session.url };
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof ConflictException) throw error;
      this.logger.error('Failed to create customer portal', {
        clerkUserId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.rethrowStripeError(error, 'Falha ao criar portal do cliente no Stripe.');
    }
  }

  /**
   * Configuracao do portal criada por API, uma vez por modo (live/teste). A
   * configuracao PADRAO do painel fica intocada. Falhou (permissao da chave,
   * Stripe fora): o portal abre com a padrao do painel, e o log avisa.
   */
  private async ensurePortalConfiguration(): Promise<string | null> {
    if (this.portalConfigurationId) return this.portalConfigurationId;
    const stripe = this.getStripeClient();
    try {
      const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
      const found = existing.data.find((c) => c.metadata?.tickrify === PORTAL_CONFIG_TAG);
      if (found) {
        this.portalConfigurationId = found.id;
        return found.id;
      }
      const base = this.resolveAppBaseUrl();
      const created = await stripe.billingPortal.configurations.create({
        business_profile: {
          privacy_policy_url: `${base}/privacy`,
          terms_of_service_url: `${base}/terms`,
        },
        default_return_url: `${base}/dashboard/settings`,
        features: {
          subscription_cancel: {
            enabled: true,
            mode: 'at_period_end',
            proration_behavior: 'none',
            cancellation_reason: {
              enabled: true,
              options: [
                'too_expensive',
                'missing_features',
                'switched_service',
                'unused',
                'low_quality',
                'too_complex',
                'customer_service',
                'other',
              ],
            },
          },
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
          // Sem troca de plano pelo portal (fica desligada por padrao) e sem
          // edicao de e-mail/endereco: o e-mail da conta vem do Clerk.
          customer_update: { enabled: false },
        },
        metadata: { tickrify: PORTAL_CONFIG_TAG },
      });
      this.logger.log(`[portal] Configuracao do portal criada (${created.id}).`);
      this.portalConfigurationId = created.id;
      return created.id;
    } catch (error) {
      this.logger.error('[portal] Nao consegui garantir a configuracao do portal; usando a padrao do painel.', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private safeAppUrl(path: string): string | undefined {
    try {
      return `${this.resolveAppBaseUrl()}${path}`;
    } catch {
      return undefined;
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
   * Assinatura para a tela de Configuracoes, relida na Stripe (e gravada).
   * null = nada para mostrar (nunca assinou, ou so o acesso manual `manual_*`).
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
        where: { userId: user.id, stripeId: { startsWith: 'sub_' } },
        orderBy: { updatedAt: 'desc' },
      });

      if (!subscriptionRecord?.stripeId) {
        return null;
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionRecord.stripeId);
      await this.upsertSubscriptionForUser(user.id, subscription);
      return this.subscriptionViewWithSchedule(subscription, user.id);
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

  private async subscriptionViewWithSchedule(subscription: Stripe.Subscription, userId = '') {
    const scheduleId = this.refId(subscription.schedule);
    const schedule = scheduleId ? await this.getStripeClient().subscriptionSchedules.retrieve(scheduleId) : null;
    const next = schedule?.status === 'active'
      ? schedule.phases.find(phase => phase.start_date >= subscription.current_period_end)
      : null;
    const nextPrice = next ? this.refId(next.items[0]?.price) : null;
    return { ...this.subscriptionView(subscription),
      canChangePlans: Boolean(process.env.STRIPE_PORTAL_V2_CONFIG_ID) && portalUpgradeEnabled(userId) && subscription.status === 'active' && !subscription.schedule && !subscription.pending_update && !cancelScheduled(subscription) && subscription.items.data.length === 1 && subscription.items.data[0].quantity === 1 && subscription.items.data[0].price.id === portalCatalog().weekly,
      pendingPayment: Boolean(subscription.pending_update),
      scheduledChange: next && nextPrice ? { billingCycle: billingCycleForPriceId(nextPrice), effectiveAt: next.start_date } : null,
    };
  }

  private subscriptionView(subscription: Stripe.Subscription) {
    const price = subscription.items.data[0]?.price;
    const priceId = price?.id ?? '';
    const status = String(subscription.status).toLowerCase();
    const isActive = ['active', 'trialing'].includes(status);
    const canceling = cancelScheduled(subscription);
    const accessEndsAt = canceling
      ? subscription.cancel_at ?? subscription.current_period_end
      : status === 'canceled'
        ? subscription.ended_at ?? subscription.canceled_at
        : null;
    return {
      id: subscription.id,
      status: subscription.status,
      plan: isActive ? (resolvePlanForPriceId(priceId) ?? 'pro') : 'free',
      billingCycle: billingCycleForPriceId(priceId),
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: canceling,
      /** Fim do acesso (agendado ou ja encerrado), em segundos. */
      accessEndsAt: accessEndsAt ?? null,
      /** Proxima cobranca: so existe para assinatura viva e sem cancelamento agendado. */
      nextChargeAt: isActive && !canceling ? subscription.current_period_end : null,
      amount: typeof price?.unit_amount === 'number' ? price.unit_amount / 100 : null,
      currency: price?.currency ?? null,
      manageable: MANAGEABLE_SUBSCRIPTION_STATUSES.includes(status),
      canReactivate: canceling && isActive,
    };
  }

  /**
   * Desfaz o cancelamento agendado, antes do fim do periodo pago. O evento
   * `subscription_reactivated` sai do webhook (fonte unica, com idempotencia).
   */
  async reactivateSubscription(clerkUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId }, select: { id: true } });
    const record = user
      ? await this.prisma.subscription.findFirst({
          where: { userId: user.id, stripeId: { startsWith: 'sub_' }, status: { in: ['active', 'trialing'] } },
          orderBy: { updatedAt: 'desc' },
          select: { stripeId: true },
        })
      : null;
    if (!user || !record) {
      throw new ForbiddenException({ code: 'no_subscription', message: 'There is no subscription to reactivate.' });
    }
    try {
      const stripe = this.getStripeClient();
      const live = await stripe.subscriptions.retrieve(record.stripeId);
      if (!cancelScheduled(live) || !['active', 'trialing'].includes(live.status)) {
        throw new ConflictException({ code: 'not_canceling', message: 'This subscription is not scheduled to cancel.' });
      }
      // Agendado por data (cancel_at) se desfaz com valor vazio; pelo fim do periodo, com false.
      const updated = await stripe.subscriptions.update(
        live.id,
        live.cancel_at_period_end ? { cancel_at_period_end: false } : { cancel_at: '' },
      );
      await this.upsertSubscriptionForUser(user.id, updated);
      return this.subscriptionView(updated);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      this.rethrowStripeError(error, 'Falha ao reativar a assinatura.');
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
      // NAO logar o erro cru: o de assinatura invalida carrega o corpo inteiro
      // do evento (e-mail, nome, endereco de cobranca) em `payload`.
      funnelLog('webhook_failed', { reason: 'verification', ...safeErrorFields(error) }, { level: 'warn' });
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

    funnelLog('webhook_received', { event: event.id, eventType: event.type });
    try {
      await this.dispatchWebhookEvent(event);
      await this.finishWebhookEvent(event.id, 'processed');
      return { received: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      funnelLog('webhook_failed', { event: event.id, eventType: event.type, ...safeErrorFields(error), message }, { level: 'error' });
      await this.finishWebhookEvent(event.id, 'failed', message);
      this.rethrowStripeError(error, 'Falha ao processar webhook do Stripe.');
    }
  }

  private async dispatchWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session, event.created);
        return;
      case 'customer.subscription.created':
      case 'customer.subscription.pending_update_applied':
      case 'customer.subscription.pending_update_expired':
      case 'customer.subscription.updated':
        await this.handleSubscriptionChanged(
          event.data.object as Stripe.Subscription,
          event.type,
          (event.data as { previous_attributes?: Record<string, unknown> }).previous_attributes,
          event.id,
        );
        return;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        return;
      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        return;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, event.created);
        return;
      // Os dois abaixo so chegam se estiverem marcados no endpoint da Stripe.
      // Recusa DENTRO da pagina de checkout nao gera fatura: sem este evento,
      // "cartao sem saldo" (os 2 casos de setembro) era invisivel no log.
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        return;
      // Afiliados: refund ou disputa cancela a comissao ainda nao paga. So
      // chegam se estiverem marcados no endpoint da Stripe.
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        if ((charge.amount_refunded ?? 0) > 0) {
          await this.affiliates.cancelForCharge(
            { chargeId: charge.id, paymentIntentId: this.refId(charge.payment_intent) },
            'refund',
          );
        }
        return;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        await this.affiliates.cancelForCharge(
          { chargeId: this.refId(dispute.charge), paymentIntentId: this.refId(dispute.payment_intent) },
          'dispute',
        );
        return;
      }
      // Sessao aberta que ninguem pagou em 24h: o abandono, com data e sessao.
      case 'checkout.session.expired': {
        const expired = event.data.object as Stripe.Checkout.Session;
        const expiredUser = expired.client_reference_id || expired.metadata?.userId || null;
        funnelLog(
          'checkout_returned',
          { user: expiredUser, session: expired.id, outcome: 'expired', status: expired.status },
          { persist: expiredUser ? this.prisma : undefined },
        );
        // O abandono do checkout hospedado so existia no log do Render: sem o
        // evento no PostHog nao da para ver quantos abriram e deixaram expirar.
        await this.captureForUser(
          expiredUser,
          'checkout_session_expired',
          {
            sessionId: expired.id,
            priceId: expired.metadata?.priceId ?? null,
            coupon: expired.metadata?.coupon || null,
            source: expired.metadata?.checkoutSource ?? null,
            value: (expired.amount_total ?? 0) / 100,
            currency: String(expired.currency || 'usd').toUpperCase(),
          },
          { dedupeKey: `checkout_session_expired:${expired.id}`, timestamp: new Date(event.created * 1000) },
        );
        return;
      }
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
  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session, eventCreated: number) {
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
          // Criacao da sessao (o timestamp do evento e a conclusao, abaixo).
          sessionCreatedAt:
            typeof session.created === 'number' ? new Date(session.created * 1000).toISOString() : null,
          ...this.posthogAttributionProperties(analyticsUser),
        },
        // Timestamp = hora do evento `checkout.session.completed` (conclusao real),
        // estavel em reentrega. Antes era `session.created`, que antecedia o
        // `checkout_started` do navegador e quebrava funil sequencial.
        { dedupeKey: `checkout_completed:${session.id}`, timestamp: new Date(eventCreated * 1000) },
      );
    } catch {
      /* analytics nunca pode quebrar o webhook */
    }

    // Purchase pela Conversions API: SO aqui, com pagamento confirmado e
    // assinatura ativa. Mesmo event_id do pixel (purchase_<sessao>), que so
    // dispara depois que o servidor confirma a sessao paga (checkout-status).
    try {
      const meta = session.metadata ?? {};
      const clerkId = String(session.metadata?.clerkUserId || '').trim();
      if (clerkId) {
        void sendMetaEvent({
          eventName: 'Purchase',
          eventId: `purchase_${session.id}`,
          // URL e opcional para o Meta: nunca pode ser o motivo de o Purchase nao sair.
          eventSourceUrl: this.safeAppUrl('/dashboard'),
          user: { externalId: clerkId, email: session.customer_details?.email ?? null },
          ads: {
            consent: meta.ads_consent === '1',
            fbp: meta.ads_fbp ?? null,
            fbc: meta.ads_fbc ?? null,
            ip: meta.ads_ip ?? null,
            userAgent: meta.ads_ua ?? null,
          },
          customData: {
            value: (session.amount_total ?? 0) / 100,
            currency: String(session.currency || 'usd'),
            contentName: meta.planType,
          },
        });
      }
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

  /**
   * `created` e `updated` fazem a mesma coisa: releem a assinatura na Stripe e
   * gravam o estado ATUAL. A Stripe nao garante ordem de entrega; gravar o
   * payload deixava um `updated` atrasado reativar uma assinatura ja cancelada.
   */
  private async handleSubscriptionChanged(
    subscription: Stripe.Subscription,
    eventType?: string,
    previous?: Record<string, unknown>,
    eventId?: string,
  ) {
    const synced = await this.syncSubscriptionFromStripe(subscription.id, {
      userIdHint: subscription.metadata?.userId ?? null,
    });
    if (!synced) {
      throw new Error(
        `User not found for subscription ${subscription.id} (customer ${String(subscription.customer || '')})`,
      );
    }

    // Cancelamento agendado (fica ativa ate o fim do periodo) ou desfeito. O
    // fim de fato chega depois como customer.subscription.deleted. Os dois
    // modos da Stripe: `cancel_at_period_end` (classico) e `cancel_at`.
    if (
      eventType === 'customer.subscription.updated' &&
      previous &&
      ('cancel_at_period_end' in previous || 'cancel_at' in previous)
    ) {
      // `previous_attributes` traz o valor ANTIGO so do que mudou; o resto e o atual.
      const before = {
        cancel_at_period_end: Boolean(
          'cancel_at_period_end' in previous ? previous.cancel_at_period_end : synced.subscription.cancel_at_period_end,
        ),
        cancel_at: ('cancel_at' in previous ? previous.cancel_at : synced.subscription.cancel_at) as number | null,
        status: synced.subscription.status,
      };
      const wasScheduled = cancelScheduled(before);
      const nowScheduled = cancelScheduled(synced.subscription);
      if (wasScheduled !== nowScheduled) {
        await this.onCancellationChanged(synced.userId, synced.subscription, nowScheduled, eventId);
      }
    }

    if (eventType === 'customer.subscription.created') {
      // Trial de 3 dias: assinatura que ja nasce paga encerra o trial como
      // convertido (idempotente; a fatura paga faz o mesmo quando chega depois).
      const trialDay = ['active', 'trialing'].includes(synced.subscription.status)
        ? await markTrialConverted(this.prisma, synced.userId, new Date(synced.subscription.created * 1000))
        : null;
      funnelLog(
        'subscription_created',
        {
          user: synced.userId,
          subscription: synced.subscription.id,
          status: synced.subscription.status,
          source: synced.subscription.metadata?.checkoutSource ?? null,
        },
        { persist: this.prisma },
      );
      await this.captureForUser(
        synced.userId,
        'subscription_created',
        {
          subscriptionId: synced.subscription.id,
          status: synced.subscription.status,
          priceId: synced.subscription.items.data[0]?.price.id ?? null,
          checkoutSource: synced.subscription.metadata?.checkoutSource ?? null,
          ...(trialDay !== null ? { trial_day_at_conversion: trialDay } : {}),
          // Marca a pessoa no PostHog so se a assinatura ja nasceu paga. Com o
          // cartao recusado ela nasce `incomplete` e expira sem evento de fim
          // (29/09: cartao recusado ficou marcado como assinante). Quem paga
          // depois e marcado pelo `payment_succeeded`.
          ...(['active', 'trialing'].includes(synced.subscription.status)
            ? { $set: { is_subscriber: true } }
            : {}),
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
   * Cancelamento agendado pelo portal (ou desfeito antes do fim do periodo).
   * Cada evento da Stripe passa aqui UMA vez (`claimWebhookEvent`); o
   * dedupeKey do PostHog usa o id do evento, entao reenvio nao duplica.
   */
  private async onCancellationChanged(
    userId: string,
    subscription: Stripe.Subscription,
    scheduled: boolean,
    eventId?: string,
  ): Promise<void> {
    const priceId = subscription.items.data[0]?.price.id ?? null;
    const reason = subscription.cancellation_details?.reason ?? null;
    const feedback = subscription.cancellation_details?.feedback ?? null;
    const accessEndsAt = subscription.cancel_at ?? subscription.current_period_end;
    // Dia da assinatura em que cancelou (1 = no dia em que assinou).
    const subscriptionDay = Math.max(1, Math.floor((Date.now() / 1000 - subscription.created) / 86400) + 1);
    funnelLog(
      'subscription_canceled',
      {
        user: userId,
        subscription: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: scheduled,
        reason: scheduled ? 'scheduled' : 'reactivated',
      },
      { persist: this.prisma },
    );
    const dedupe = eventId ? { dedupeKey: `${scheduled ? 'cancel' : 'reactivate'}:${eventId}` } : {};
    if (scheduled) {
      await this.captureForUser(
        userId,
        'subscription_cancel_scheduled',
        {
          subscriptionId: subscription.id,
          billingCycle: billingCycleForPriceId(priceId),
          reason: feedback,
          comment_given: Boolean(subscription.cancellation_details?.comment),
          subscription_day: subscriptionDay,
          access_ends_at: new Date(accessEndsAt * 1000).toISOString(),
          cancellation_source: reason,
        },
        dedupe,
      );
      await this.sendCancellationEmail(userId, subscription.id, accessEndsAt);
    } else {
      await this.captureForUser(
        userId,
        'subscription_reactivated',
        { subscriptionId: subscription.id, billingCycle: billingCycleForPriceId(priceId), subscription_day: subscriptionDay },
        dedupe,
      );
    }
  }

  /**
   * Confirmacao de cancelamento (fim do acesso e como reativar). Chave
   * EMAIL_CANCELLATION_CONFIRM DESLIGADA = so loga. Uma por assinatura e por
   * fim de acesso (AdminAudit), para reenvio do webhook nao mandar dois.
   */
  private async sendCancellationEmail(userId: string, subscriptionId: string, accessEndsAt: number): Promise<void> {
    try {
      const marker = `cancellation_email:${subscriptionId}:${accessEndsAt}`;
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
      if (!user?.email) return;
      if (!flagBool('EMAIL_CANCELLATION_CONFIRM')) {
        this.logger.log(`[mail] dry-run kind=cancellation_confirm user=${userId}`);
        return;
      }
      const already = await this.prisma.adminAudit.findFirst({ where: { action: marker, targetUserId: userId }, select: { id: true } });
      if (already || !this.mail) return;
      const sent = await this.mail.sendCancellationConfirm(user.email, user.name, new Date(accessEndsAt * 1000));
      if (sent) {
        await this.prisma.adminAudit.create({ data: { action: marker, targetUserId: userId, details: { subscriptionId } } });
      }
    } catch (error) {
      this.logger.warn(`[mail] Falha no e-mail de cancelamento: ${error instanceof Error ? error.message : String(error)}`);
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

    funnelLog(
      'subscription_canceled',
      { user: synced.userId, subscription: subscription.id, status: synced.subscription.status, reason: 'ended' },
      { persist: this.prisma },
    );
    const endedAt = synced.subscription.ended_at ?? synced.subscription.canceled_at;
    const endedPriceId = synced.subscription.items.data[0]?.price.id ?? null;
    await this.captureForUser(
      synced.userId,
      'subscription_ended',
      {
        subscriptionId: subscription.id,
        billingCycle: billingCycleForPriceId(endedPriceId),
        reason: synced.subscription.cancellation_details?.feedback ?? null,
        cancellation_source: synced.subscription.cancellation_details?.reason ?? null,
        $set: { is_subscriber: false },
      },
      endedAt
        ? { dedupeKey: `subscription_ended:${subscription.id}`, timestamp: new Date(endedAt * 1000) }
        : {},
    );
  }

  /** Recusa dentro da pagina de checkout (sem fatura): so observabilidade. */
  private async handlePaymentIntentFailed(intent: Stripe.PaymentIntent) {
    const userId = await this.findUserIdByCustomer(intent.customer as string | Stripe.Customer | null);
    const error = intent.last_payment_error;
    funnelLog(
      'payment_failed',
      {
        user: userId,
        amount: (intent.amount ?? 0) / 100,
        currency: intent.currency,
        code: error?.code ?? null,
        declineCode: error?.decline_code ?? null,
        reason: 'checkout_attempt',
      },
      { level: 'warn', persist: userId ? this.prisma : undefined },
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

    funnelLog(
      'payment_succeeded',
      {
        user: synced.userId,
        invoice: invoice.id,
        subscription: subscriptionId,
        billingReason: invoice.billing_reason ?? null,
        amount: (invoice.amount_paid ?? 0) / 100,
        currency: invoice.currency,
      },
      { persist: this.prisma },
    );

    // Receita confirmada (primeira cobranca e renovacoes). So o backend emite.
    const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
    const attempt = await this.invoiceAttemptDetails(invoice.id);
    // 1a cobranca de quem estava no trial de 3 dias: encerra como convertido.
    const trialDay =
      invoice.billing_reason === 'subscription_create'
        ? await markTrialConverted(this.prisma, synced.userId, new Date(paidAt * 1000))
        : null;
    await this.captureForUser(
      synced.userId,
      'payment_succeeded',
      {
        invoiceId: invoice.id,
        subscriptionId,
        billingReason: invoice.billing_reason ?? null,
        value: (invoice.amount_paid ?? 0) / 100,
        currency: String(invoice.currency || 'usd').toUpperCase(),
        attemptCount: invoice.attempt_count ?? null,
        priceId: synced.subscription.items?.data?.[0]?.price?.id ?? null,
        billingInterval: synced.subscription.items?.data?.[0]?.price?.recurring?.interval ?? null,
        cardCountry: attempt.cardCountry,
        cardFunding: attempt.cardFunding,
        cardBrand: attempt.cardBrand,
        cardWallet: attempt.cardWallet,
        ...(trialDay !== null ? { trial_day_at_conversion: trialDay } : {}),
        $set: { is_subscriber: true },
      },
      { dedupeKey: `payment_succeeded:${invoice.id}`, timestamp: new Date(paidAt * 1000) },
    );
    // Pagou depois de uma recusa: mede se Smart Retries e troca de cartao salvam
    // receita. `attempt_count` sozinho nao basta: a Stripe so o incrementa nas
    // retentativas AUTOMATICAS, e quem atualiza o cartao no portal paga com
    // tentativa manual (continua em 1). Por isso a falha tambem e conferida no
    // registro que o webhook de falha grava (AdminAudit), por fatura. Sem uma
    // das duas provas nao ha recuperacao: o 1o pagamento e a conversao de trial
    // nunca entram.
    const recoveredBy = await this.recoveryEvidence(invoice, synced.userId);
    if (recoveredBy) {
      await this.captureForUser(
        synced.userId,
        'payment_recovered',
        {
          invoiceId: invoice.id,
          subscriptionId,
          attemptCount: invoice.attempt_count ?? null,
          detectedBy: recoveredBy,
          billingReason: invoice.billing_reason ?? null,
          value: (invoice.amount_paid ?? 0) / 100,
          currency: String(invoice.currency || 'usd').toUpperCase(),
        },
        { dedupeKey: `payment_recovered:${invoice.id}`, timestamp: new Date(paidAt * 1000) },
      );
    }
    // Renovacao (2a cobranca em diante): evento proprio para o funil de retencao.
    if (invoice.billing_reason === 'subscription_cycle') {
      await this.captureForUser(
        synced.userId,
        'subscription_renewed',
        {
          invoiceId: invoice.id,
          subscriptionId,
          priceId: synced.subscription.items?.data?.[0]?.price?.id ?? null,
          value: (invoice.amount_paid ?? 0) / 100,
          currency: String(invoice.currency || 'usd').toUpperCase(),
        },
        { dedupeKey: `subscription_renewed:${invoice.id}`, timestamp: new Date(paidAt * 1000) },
      );
    }

    // Criacao e renovacao mantem a regra existente. Troca de ciclo exige
    // uma linha do novo periodo paga; prorrata isolada nao abre franquia.
    const reason = invoice.billing_reason ?? '';
    if (!['subscription_create', 'subscription_cycle', 'subscription_update'].includes(reason)) {
      this.logger.log(`[Ticks] Fatura ${invoice.id} (${reason}) nao abre janela de ticks.`);
      return;
    }

    if (reason === 'subscription_update' && !(await this.confirmedCyclePayment(synced.subscription, invoice))) return;

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

    // Comissao de afiliado DEPOIS dos ticks: se falhar, o erro sobe e a Stripe
    // reenvia; os ticks ja aplicados nao repetem (chave da janela) e a
    // comissao e unica por fatura.
    await this.affiliates.recordInvoiceCommission(invoice, synced.userId);
  }

  /**
   * Prova de que esta fatura paga ja tinha falhado antes, ou null.
   * - `attempt_count`: > 1 so acontece depois de uma falha (retentativa automatica).
   * - `failure_record`: o webhook de falha desta MESMA fatura foi gravado no
   *   AdminAudit (cobre a atualizacao manual do cartao, que nao incrementa
   *   `attempt_count`).
   * Se a consulta falhar, so vale a primeira prova: nunca se inventa recuperacao.
   * Limite conhecido: uma falha anterior ao registro no AdminAudit (ou um
   * `invoice.payment_succeeded` que chegue ANTES do `payment_failed`) nao e vista.
   */
  private async recoveryEvidence(
    invoice: Stripe.Invoice,
    userId: string,
  ): Promise<'attempt_count' | 'failure_record' | null> {
    if ((invoice.attempt_count ?? 0) > 1) return 'attempt_count';
    if ((invoice.amount_paid ?? 0) <= 0) return null;
    try {
      const failures = await this.prisma.adminAudit.count({
        where: {
          action: 'stripe_payment_failed',
          targetUserId: userId,
          details: { path: ['invoiceId'], equals: invoice.id },
        },
      });
      return failures > 0 ? 'failure_record' : null;
    } catch {
      return null;
    }
  }

  /**
   * Detalhes da cobranca de uma fatura, so para analytics: motivo da recusa e
   * perfil do cartao (pais, tipo, bandeira, carteira). Nunca numero, validade
   * nem nome. Uma chamada a Stripe; qualquer falha devolve tudo nulo, porque
   * isso nunca pode derrubar o webhook.
   *
   * `attemptNotAfter` (so no webhook de FALHA): a Stripe devolve a fatura como
   * ela esta AGORA, entao com o webhook atrasado a ultima cobranca pode ser de
   * uma retentativa posterior. Se a cobranca e mais nova que o evento, o motivo
   * e o cartao nao sao desta tentativa e voltam nulos, em vez de atribuidos a
   * tentativa errada.
   */
  private async invoiceAttemptDetails(
    invoiceId: string,
    attemptNotAfter?: Date,
  ): Promise<InvoiceAttemptDetails> {
    const empty: InvoiceAttemptDetails = {
      declineCode: null,
      failureCode: null,
      networkDeclineCode: null,
      adviceCode: null,
      cardCountry: null,
      cardFunding: null,
      cardBrand: null,
      cardWallet: null,
    };
    try {
      const expanded = await this.getStripeClient().invoices.retrieve(invoiceId, {
        expand: ['payment_intent', 'payment_intent.latest_charge'],
      });
      const pi = expanded.payment_intent as Stripe.PaymentIntent | string | null;
      if (!pi || typeof pi === 'string') return empty;

      // `network_decline_code` e `advice_code` existem na API, mas nao nos
      // tipos do SDK 14.x.
      const err = pi.last_payment_error as
        | (Stripe.PaymentIntent.LastPaymentError & {
            network_decline_code?: string | null;
            advice_code?: string | null;
          })
        | null;
      const charge = pi.latest_charge && typeof pi.latest_charge !== 'string' ? pi.latest_charge : null;
      if (
        attemptNotAfter &&
        charge &&
        charge.created * 1000 > attemptNotAfter.getTime() + ATTEMPT_MATCH_TOLERANCE_MS
      ) {
        return empty;
      }
      const card = charge?.payment_method_details?.card ?? null;
      return {
        declineCode: err?.decline_code ?? null,
        failureCode: err?.code ?? null,
        networkDeclineCode: err?.network_decline_code ?? null,
        adviceCode: err?.advice_code ?? null,
        cardCountry: card?.country ?? null,
        cardFunding: card?.funding ?? null,
        cardBrand: card?.brand ?? null,
        cardWallet: card?.wallet?.type ?? null,
      };
    } catch {
      return empty;
    }
  }

  private refId(ref: string | { id: string } | null | undefined): string | null {
    if (!ref) return null;
    return typeof ref === 'string' ? ref : ref.id ?? null;
  }

  /**
   * Falha de pagamento: o status vem da Stripe (`past_due`, `incomplete`...)
   * so para a assinatura desta fatura, e a falha fica REGISTRADA no
   * AdminAudit, alem do log. Antes marcava todas as assinaturas do usuario
   * como `past_due`, inclusive as canceladas, e nao guardava nada.
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice, eventCreated: number) {
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

    // Motivo da recusa e perfil do cartao (so codigos e atributos da Stripe,
    // nunca dado de cartao). Uma chamada a mais, so em falha, e nunca derruba o webhook.
    const attempt = await this.invoiceAttemptDetails(invoice.id, new Date(eventCreated * 1000));
    const { declineCode, failureCode } = attempt;
    funnelLog(
      'payment_failed',
      {
        user: userId,
        invoice: invoice.id,
        subscription: subscriptionId,
        status: details.subscriptionStatus,
        amount: (invoice.amount_due ?? 0) / 100,
        currency: invoice.currency,
        attempt: invoice.attempt_count ?? null,
        billingReason: invoice.billing_reason ?? null,
        code: failureCode,
        declineCode,
      },
      { level: 'warn' },
    );

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
    // O motivo (`insufficient_funds`, `do_not_honor`...) ia so para o log do
    // Render: no PostHog a falha vinha sem causa e nao dava para separar saldo
    // de recusa do banco. So codigos da Stripe, nunca dado de cartao.
    // A data e a do EVENTO de falha, que a Stripe cria no momento da tentativa
    // e repete igual em qualquer reentrega ou processamento atrasado. Nao e a
    // de criacao da fatura (`invoice.created` e a da 1a tentativa e jogava
    // todas as retentativas no mesmo dia) nem a da ultima cobranca (com o
    // webhook atrasado ela pode ser de uma tentativa posterior). Sem
    // `new Date()`: a deduplicacao do PostHog exige timestamp estavel.
    await this.captureForUser(
      userId,
      'payment_failed',
      {
        ...details,
        failureCode,
        declineCode,
        networkDeclineCode: attempt.networkDeclineCode,
        adviceCode: attempt.adviceCode,
        priceId: synced?.subscription.items?.data?.[0]?.price?.id ?? null,
        cardCountry: attempt.cardCountry,
        cardFunding: attempt.cardFunding,
        cardBrand: attempt.cardBrand,
        cardWallet: attempt.cardWallet,
      },
      {
        // `attempt_count` sozinho nao separa duas falhas MANUAIS da mesma fatura
        // (ele so sobe nas retentativas automaticas) e o PostHog junta eventos
        // de mesmo uuid no mesmo dia. A data do evento distingue as tentativas e
        // e igual em qualquer reentrega do mesmo evento.
        dedupeKey: `payment_failed:${invoice.id}:${invoice.attempt_count ?? 0}:${eventCreated}`,
        timestamp: new Date(eventCreated * 1000),
      },
    );

    await this.sendPaymentFailedEmail(userId, invoice, details.subscriptionStatus);
  }

  /**
   * Aviso de renovacao recusada pela Resend. So renovacao (`subscription_cycle`)
   * com assinatura em `past_due`/`unpaid`: a 1a cobranca nao gera fatura recusada
   * (o Checkout so cria a assinatura quando o pagamento passa). Uma vez por
   * fatura (AdminAudit): as retentativas da Stripe e o reenvio do webhook nao
   * repetem. EMAIL_PAYMENT_FAILED DESLIGADA = so loga. Nunca derruba o webhook.
   */
  private async sendPaymentFailedEmail(
    userId: string | null,
    invoice: Stripe.Invoice,
    subscriptionStatus: string | null,
  ): Promise<void> {
    try {
      if (!userId || invoice.billing_reason !== 'subscription_cycle') return;
      if ((invoice.amount_due ?? 0) <= 0) return;
      if (subscriptionStatus !== 'past_due' && subscriptionStatus !== 'unpaid') return;
      if (!flagBool('EMAIL_PAYMENT_FAILED')) {
        this.logger.log(`[mail] dry-run kind=payment_failed user=${userId}`);
        return;
      }
      const marker = `payment_failed_email:${invoice.id}`;
      const already = await this.prisma.adminAudit.findFirst({ where: { action: marker, targetUserId: userId }, select: { id: true } });
      if (already || !this.mail) return;
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
      if (!user?.email) return;
      const sent = await this.mail.sendPaymentFailed(user.email, user.name, {
        amount: (invoice.amount_due ?? 0) / 100,
        currency: String(invoice.currency || 'usd'),
        nextAttempt: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : null,
      });
      if (sent) {
        await this.prisma.adminAudit.create({ data: { action: marker, targetUserId: userId, details: { invoiceId: invoice.id } } });
      }
    } catch (error) {
      this.logger.warn(`[mail] Falha no e-mail de pagamento recusado: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  private async confirmedCyclePayment(subscription: Stripe.Subscription, invoice?: Stripe.Invoice): Promise<boolean> {
    // Read invoice through our pinned 2023 API: webhook lines use the Basil schema.
    if (invoice && invoice.status !== 'paid') return false;
    const invoiceId = invoice?.id ?? this.refId(subscription.latest_invoice);
    const paid = invoiceId ? await this.getStripeClient().invoices.retrieve(invoiceId) : null;
    if (!paid || paid.status !== 'paid' || subscription.pending_update) return false;
    return paid.lines.data.some(line => !line.proration && line.price?.id === subscription.items.data[0]?.price.id &&
      line.period.start === subscription.current_period_start && line.period.end === subscription.current_period_end);
  }

  private async applyMonthlyAllowance(
    userId: string,
    subscription: { stripeId: string; priceId: string | null; periodStart: Date | null },
    source: 'invoice_webhook' | 'lazy_sync' | 'access_check',
    now = new Date(),
  ): Promise<boolean> {
    const allowance = allowanceForPriceId(subscription.priceId);
    if (allowance <= 0) {
      this.logger.warn(`[Ticks] priceId ${subscription.priceId} nao mapeado a nenhum plano; saldo intocado.`);
      return false;
    }

    const windowStart = allowanceWindowStart(
      subscription.periodStart,
      now,
      allowanceCadenceForPriceId(subscription.priceId),
    );
    const cycleKey = `allowance-cycle:${subscription.stripeId}:${windowStart.toISOString()}`;
    // Keep paid transitions idempotent even when portal entry is disabled during rollback.
    if (await this.prisma.tickTransaction.findUnique({ where: { stripePaymentIntentId: cycleKey }, select: { id: true } })) return false;
    let transition = false;
    if (subscription.stripeId.startsWith('sub_') && process.env.STRIPE_PORTAL_V2_CONFIG_ID) {
      const live = await this.getStripeClient().subscriptions.retrieve(subscription.stripeId);
      if (live.items.data[0]?.price.id !== subscription.priceId ||
          !subscription.periodStart || live.current_period_start !== subscription.periodStart.getTime() / 1000) return false;
      const invoiceId = this.refId(live.latest_invoice);
      if (!invoiceId) return false;
      if (invoiceId) {
        const invoice = await this.getStripeClient().invoices.retrieve(invoiceId);
        if (invoice.status !== 'paid') return false;
        if (invoice.billing_reason === 'subscription_update') {
          if (!(await this.confirmedCyclePayment(live, invoice))) return false;
          transition = true;
        }
      }
    }
    const key = transition
      ? cycleKey
      : `allowance:${subscription.stripeId}:${windowStart.toISOString().slice(0, 10)}`;

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
            description: `Allowance: saldo definido em ${allowance} Ticks`,
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
   * Acesso manual (`manual_*`) usa o mes-calendario. O retorno decide o acesso
   * desta mesma requisicao; falha de reposicao nao revoga um periodo confirmado.
   */
  async ensureTicksForActiveSubscriber(
    userId: string,
    subscription: {
      stripeId: string;
      priceId: string | null;
      currentPeriodStart?: Date | null;
      currentPeriodEnd?: Date | null;
    },
  ): Promise<boolean> {
    let accessConfirmed = !subscription.stripeId.startsWith('sub_');
    try {
      let periodStart = subscription.currentPeriodStart ?? null;
      let priceId = subscription.priceId;

      if (subscription.stripeId.startsWith('sub_')) {
        const periodEnd = subscription.currentPeriodEnd?.getTime();
        accessConfirmed = typeof periodEnd === 'number' && Number.isFinite(periodEnd) && periodEnd > Date.now();
        const stale =
          !periodStart || !Number.isFinite(periodStart.getTime()) || !accessConfirmed;
        if (stale) {
          // Falha temporaria so pode preservar um periodo local ainda vigente.
          let live: Stripe.Subscription;
          try {
            live = await this.getStripeClient().subscriptions.retrieve(subscription.stripeId);
          } catch (error) {
            if ((error as { code?: string })?.code !== 'resource_missing') throw error;
            accessConfirmed = false;
            await this.prisma.subscription.updateMany({
              where: { stripeId: subscription.stripeId },
              data: { status: 'canceled' },
            });
            return false;
          }
          accessConfirmed = hasCurrentStripeAccess(live);
          await this.upsertSubscriptionForUser(userId, live);
          if (!accessConfirmed) return false;
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
      this.logger.error(`[Ticks] Falha ao verificar a janela mensal de ${userId}`, error);
      if (!accessConfirmed) {
        throw new ServiceUnavailableException({
          code: 'subscription_verification_unavailable',
          message: 'Unable to confirm subscription access. Please try again shortly.',
        });
      }
      // So a reposicao falhou: preserva acesso ja confirmado e saldo existente.
    }
    return true;
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

      const active = subscriptions.data.filter(hasCurrentStripeAccess);

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
    if (typeof this.prisma.$executeRawUnsafe === 'function') await this.recordCancellationColumns(subscription);
  }

  /**
   * Colunas do cancelamento (fora do schema.prisma, ver onModuleInit). Sempre o
   * estado ATUAL relido na Stripe, entao reenvio do webhook grava o mesmo valor.
   * Coluna ausente (boot ainda nao rodou) nao derruba o webhook.
   */
  private async recordCancellationColumns(subscription: Stripe.Subscription): Promise<void> {
    const toDate = (value: number | null | undefined) => (typeof value === 'number' ? new Date(value * 1000) : null);
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "tickrify"."Subscription"
            SET "cancelAtPeriodEnd" = $2, "cancelAt" = $3, "canceledAt" = $4, "endedAt" = $5,
                "cancelReason" = $6, "cancelFeedback" = $7
          WHERE "stripeId" = $1`,
        subscription.id,
        cancelScheduled(subscription),
        toDate(subscription.cancel_at),
        toDate(subscription.canceled_at),
        toDate(subscription.ended_at),
        subscription.cancellation_details?.reason ?? null,
        subscription.cancellation_details?.feedback ?? null,
      );
    } catch (error) {
      this.logger.warn(`[webhook] Colunas de cancelamento nao gravadas (${subscription.id}): ${error instanceof Error ? error.message : String(error)}`);
    }
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
