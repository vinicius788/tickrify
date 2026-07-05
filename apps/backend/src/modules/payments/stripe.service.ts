import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../database/prisma.service';
import { captureServer } from '../../common/analytics/posthog';
import {
  getStripeConfig,
  getPriceId,
  resolvePlanForPriceId,
  resolveTicksForPriceId,
  PlanType,
  BillingCycle,
  Currency,
} from '../../config/stripe.config';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe | null;

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
  }

  private getStripeClient(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Stripe is not configured');
    }
    return this.stripe;
  }

  /**
   * Descobre em qual moeda o cliente já tem compromisso ativo na Stripe.
   * A Stripe proíbe misturar moedas no mesmo customer, então se ele já tem uma
   * assinatura (qualquer status "vivo") ou um checkout aberto, precisamos reusar
   * a mesma moeda no novo checkout. Retorna null se não houver nada — aí o novo
   * checkout pode usar a moeda pedida (usuário novo).
   */
  private async detectExistingCustomerCurrency(customerId: string): Promise<Currency | null> {
    const stripe = this.getStripeClient();
    const supported: Currency[] = ['brl', 'usd', 'eur'];

    try {
      // 1) Assinaturas em qualquer estado "vivo".
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 10,
      });
      const liveStatuses = new Set([
        'active',
        'trialing',
        'past_due',
        'unpaid',
        'incomplete',
      ]);
      for (const sub of subs.data) {
        if (liveStatuses.has(sub.status) && sub.currency) {
          const cur = sub.currency.toLowerCase() as Currency;
          if (supported.includes(cur)) return cur;
        }
      }

      // 2) Checkout sessions abertas ainda seguram a moeda.
      const sessions = await stripe.checkout.sessions.list({
        customer: customerId,
        limit: 10,
      });
      for (const s of sessions.data) {
        if (s.status === 'open' && s.currency) {
          const cur = s.currency.toLowerCase() as Currency;
          if (supported.includes(cur)) return cur;
        }
      }
    } catch (error) {
      // Nunca deixar essa checagem derrubar o checkout — no pior caso segue com a
      // moeda pedida (e a Stripe devolve o erro claro, que já tratamos no front).
      this.logger.warn(
        `[stripe] detectExistingCustomerCurrency falhou para ${customerId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    return null;
  }

  /**
   * Criar sessão de checkout
   */
  async createCheckoutSession(
    clerkUserId: string,
    planType: PlanType,
    billingCycle: BillingCycle,
    currency: Currency = 'usd',
  ) {
    try {
      if (!['starter', 'pro', 'elite'].includes(planType)) {
        throw new Error(`Invalid plan type: ${planType}`);
      }

      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const customerId = await this.resolveOrCreateCustomerId(user);

      // A Stripe não deixa um mesmo cliente ter assinaturas em moedas diferentes.
      // Se este cliente JÁ tem assinatura/checkout ativo em outra moeda (ex: assinou
      // em BRL e agora o site mostra USD), forçar a MESMA moeda evita o erro
      // "You cannot combine currencies on a single customer".
      const existingCurrency = await this.detectExistingCustomerCurrency(customerId);
      const effectiveCurrency: Currency = existingCurrency ?? currency;

      const priceId = getPriceId(planType, billingCycle, effectiveCurrency);
      const appBaseUrl = this.resolveAppBaseUrl();
      const successUrl = `${appBaseUrl}/dashboard?success=true`;
      const cancelUrl = `${appBaseUrl}/pricing?canceled=true`;

      if (!priceId) {
        throw new Error(`Price ID not configured for plan: ${planType} (${billingCycle}/${effectiveCurrency})`);
      }

      // Criar checkout session
      const stripe = this.getStripeClient();
      const session = await stripe.checkout.sessions.create({
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
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        // SEM trial: o "grátis" do Tickrify são as 3 análises gratuitas (freemium
        // de uso). Um trial de tempo por cima seria redundante — não dá ticks a
        // mais, só adiaria a receita e abriria churn involuntário. Cobra já; o
        // incentivo de entrada fica no cupom EARLY50 (50% no 1º mês).
        metadata: {
          userId: user.id,
          clerkUserId,
          planType,
          billingCycle,
          currency: effectiveCurrency,
        },
      });

      this.logger.log(
        `Checkout session created: ${session.id} for user: ${clerkUserId} (${effectiveCurrency}${
          existingCurrency ? ' — reused existing customer currency' : ''
        })`,
      );

      return {
        sessionId: session.id,
        url: session.url,
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
                name: `Tickrify — ${params.ticks} Ticks (${params.packageName})`,
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
    if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
      throw error;
    }

    const stripeError = error as {
      type?: string;
      code?: string;
      message?: string;
    };

    const message = stripeError?.message || 'Falha ao criar sessão de checkout no Stripe.';

    if (
      stripeError?.type === 'StripeInvalidRequestError' ||
      stripeError?.type === 'StripeAuthenticationError' ||
      stripeError?.type === 'StripePermissionError' ||
      stripeError?.code === 'resource_missing'
    ) {
      throw new BadRequestException(message);
    }

    if (error instanceof Error && error.message) {
      throw new BadRequestException(error.message);
    }

    throw new InternalServerErrorException('Erro interno ao processar checkout.');
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
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: {
          userId: user.id,
          clerkId: user.clerkUserId,
        },
      });

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
   * Processar evento de webhook do Stripe
   */
  async handleWebhookEvent(signature: string, payload: Buffer) {
    try {
      const stripeConfig = getStripeConfig();
      if (!stripeConfig.webhookSecret) {
        throw new ServiceUnavailableException('Stripe webhook secret is not configured');
      }

      const stripe = this.getStripeClient();
      const event = stripe.webhooks.constructEvent(
        payload,
        signature,
        stripeConfig.webhookSecret,
      );

      this.logger.log(`Processing webhook event: ${event.type}`);

      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      this.logger.error('Error handling webhook event:', error);
      const stripeError = error as { type?: string; message?: string };
      if (stripeError?.type === 'StripeSignatureVerificationError') {
        throw new BadRequestException('Invalid webhook signature');
      }
      this.rethrowStripeError(error, 'Falha ao processar webhook do Stripe.');
    }
  }

  /**
   * Handler: Checkout session completed
   */
  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    if (session.metadata?.type === 'ticks_purchase') {
      await this.creditTicksFromCompletedCheckout(session);
      return;
    }

    const stripe = this.getStripeClient();
    const userId = session.metadata?.userId;

    if (!userId) {
      this.logger.error('Missing metadata in checkout session');
      return;
    }

    const subscriptionId = session.subscription as string;
    if (!subscriptionId) {
      this.logger.warn(`Checkout session ${session.id} has no subscription id`);
      return;
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await this.upsertSubscriptionForUser(userId, subscription);

    this.logger.log(`User ${userId} subscription synchronized: ${subscription.id}`);

    // RECEITA (fonte de verdade): dispara na confirmação do pagamento, mesmo se
    // o usuário fechar a aba. distinctId = id do Clerk (casa com o funil do frontend).
    try {
      captureServer(userId, 'subscription_activated', {
        source: 'stripe_webhook',
        subscriptionId: subscription.id,
        priceId: subscription.items?.data?.[0]?.price?.id,
      });
    } catch {
      /* analytics nunca pode quebrar o webhook */
    }
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
            description: `Compra ${packageId} — ${ticks} Ticks`,
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
   * Handler: Subscription created
   */
  private async handleSubscriptionCreated(subscription: Stripe.Subscription) {
    const user = await this.resolveUserFromSubscriptionCustomer(subscription);

    if (!user) {
      this.logger.error(`User not found for customer: ${String(subscription.customer || '')}`);
      return;
    }

    await this.upsertSubscriptionForUser(user.id, subscription);
  }

  /**
   * Handler: Subscription updated
   */
  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const user = await this.resolveUserFromSubscriptionCustomer(subscription);

    if (!user) {
      this.logger.error(`User not found for customer: ${String(subscription.customer || '')}`);
      return;
    }

    await this.upsertSubscriptionForUser(user.id, subscription);
  }

  /**
   * Handler: Subscription deleted
   */
  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const user = await this.resolveUserFromSubscriptionCustomer(subscription);

    if (!user) {
      this.logger.error(`User not found for customer: ${String(subscription.customer || '')}`);
      return;
    }

    await this.prisma.subscription.updateMany({
      where: {
        userId: user.id,
        stripeId: subscription.id,
      },
      data: {
        status: 'canceled',
      },
    });

    this.logger.log(`Subscription ${subscription.id} marked as canceled for user ${user.id}`);
  }

  /**
   * Handler: Invoice payment succeeded
   * Atualiza status da assinatura e credita ticks mensais do plano.
   */
  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    const user = await this.resolveUserFromInvoiceCustomer(invoice);

    if (!user) {
      this.logger.error(`User not found for customer: ${String(invoice.customer || '')}`);
      return;
    }

    this.logger.log(`Payment succeeded for user: ${user.id}`);

    await this.prisma.subscription.updateMany({
      where: { userId: user.id },
      data: { status: 'active' },
    });

    // Creditar ticks mensais com base no plano
    const subscriptionId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : (invoice.subscription as Stripe.Subscription | null)?.id;

    if (!subscriptionId) return;

    try {
      const stripe = this.getStripeClient();
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0]?.price.id || '';
      const { ticks, planName } = resolveTicksForPriceId(priceId);

      if (ticks > 0) {
        await this.prisma.$transaction([
          this.prisma.userTicks.upsert({
            where: { userId: user.id },
            create: { userId: user.id, balance: ticks },
            update: { balance: { increment: ticks } },
          }),
          this.prisma.tickTransaction.create({
            data: {
              userId: user.id,
              amount: ticks,
              type: 'BONUS',
              description: `Recarga mensal — Plano ${planName} (${ticks} Ticks)`,
              metadata: { invoiceId: invoice.id, subscriptionId, priceId },
            },
          }),
        ]);
        this.logger.log(`[Ticks] +${ticks} creditados para ${user.id} (plano ${planName})`);
      } else {
        this.logger.warn(`[Ticks] priceId ${priceId} não mapeado a nenhum plano — nenhum tick creditado`);
      }
    } catch (err) {
      // Não falhar o webhook por erro de ticks — o pagamento já foi registrado
      this.logger.error('[Ticks] Falha ao creditar ticks da assinatura', err);
    }
  }

  /**
   * Handler: Invoice payment failed
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const user = await this.resolveUserFromInvoiceCustomer(invoice);

    if (!user) {
      this.logger.error(`User not found for customer: ${String(invoice.customer || '')}`);
      return;
    }

    this.logger.warn(`Payment failed for user: ${user.id}`);

    await this.prisma.subscription.updateMany({
      where: { userId: user.id },
      data: {
        status: 'past_due',
      },
    });
  }

  private async resolveUserFromSubscriptionCustomer(subscription: Stripe.Subscription) {
    const customerId = String(subscription.customer || '').trim();
    if (!customerId) {
      return null;
    }
    return this.prisma.user.findFirst({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
  }

  private async resolveUserFromInvoiceCustomer(invoice: Stripe.Invoice) {
    const customerId = String(invoice.customer || '').trim();
    if (!customerId) {
      return null;
    }
    return this.prisma.user.findFirst({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
  }

  /**
   * Ensures a subscriber has their tick allocation.
   * Called whenever DB confirms an active subscription but balance may be 0 (webhook missed).
   */
  async ensureTicksForActiveSubscriber(userId: string, priceId: string | null): Promise<void> {
    if (!priceId) return;

    const currentBalance = await this.prisma.userTicks.findUnique({
      where: { userId },
      select: { balance: true },
    });

    if ((currentBalance?.balance ?? 0) > 0) return;

    const { ticks, planName } = resolveTicksForPriceId(priceId);
    if (ticks <= 0) return;

    await this.prisma.$transaction([
      this.prisma.userTicks.upsert({
        where: { userId },
        create: { userId, balance: ticks },
        update: { balance: ticks },
      }),
      this.prisma.tickTransaction.create({
        data: {
          userId,
          amount: ticks,
          type: 'BONUS',
          description: `Inicialização de ticks — Plano ${planName} (${ticks} Ticks)`,
          metadata: { priceId, source: 'ensure_ticks' },
        },
      }),
    ]);

    this.logger.log(`[EnsureTicks] Credited ${ticks} ticks for user ${userId} (plan: ${planName})`);
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

      // Credit ticks if balance is 0 — webhook was missed, user never got their allocation
      const currentBalance = await this.prisma.userTicks.findUnique({
        where: { userId },
        select: { balance: true },
      });

      if ((currentBalance?.balance ?? 0) === 0) {
        const priceId = active[0].items.data[0]?.price.id ?? '';
        const { ticks, planName } = resolveTicksForPriceId(priceId);

        if (ticks > 0) {
          await this.prisma.$transaction([
            this.prisma.userTicks.upsert({
              where: { userId },
              create: { userId, balance: ticks },
              update: { balance: ticks }, // SET not increment — idempotent on zero balance
            }),
            this.prisma.tickTransaction.create({
              data: {
                userId,
                amount: ticks,
                type: 'BONUS',
                description: `Recarga mensal — Plano ${planName} (${ticks} Ticks) [lazy sync]`,
                metadata: { subscriptionId: active[0].id, priceId, source: 'lazy_sync' },
              },
            }),
          ]);
          this.logger.log(`[LazySync] Credited ${ticks} ticks for user ${userId} (plan: ${planName})`);
        }
      }

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
      },
      update: {
        status: subscription.status,
        priceId: subscription.items.data[0]?.price.id || null,
      },
    });
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
