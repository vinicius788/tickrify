import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../database/prisma.service';
import { stripeConfig, PlanType, BillingCycle } from '../../config/stripe.config';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe;

  constructor(private prisma: PrismaService) {
    this.stripe = new Stripe(stripeConfig.secretKey, {
      apiVersion: '2023-10-16',
    });
  }

  /**
   * Criar sessão de checkout
   */
  async createCheckoutSession(
    clerkUserId: string,
    planType: PlanType,
    billingCycle: BillingCycle,
  ) {
    try {
      if (planType !== 'pro') {
        throw new Error(`Invalid plan type: ${planType}`);
      }

      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const plan = stripeConfig.plans[planType];
      const selectedPrice = plan.prices[billingCycle];
      const appBaseUrl = this.resolveAppBaseUrl();
      const successUrl = `${appBaseUrl}/dashboard?success=true`;
      const cancelUrl = `${appBaseUrl}/pricing?canceled=true`;

      if (!selectedPrice?.priceId) {
        throw new Error(`Price ID not configured for plan: ${planType} (${billingCycle})`);
      }

      const customerId = await this.resolveOrCreateCustomerId(user);

      // Criar checkout session
      const session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: selectedPrice.priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        metadata: {
          userId: user.id,
          clerkUserId,
          planType,
          billingCycle,
        },
      });

      this.logger.log(`Checkout session created: ${session.id} for user: ${clerkUserId}`);

      return {
        sessionId: session.id,
        url: session.url,
      };
    } catch (error) {
      this.logger.error('Error creating checkout session:', error);
      this.rethrowCheckoutError(error);
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
      const customer = await this.stripe.customers.create({
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
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
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
      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
      });

      if (!user?.stripeCustomerId) {
        throw new Error('User does not have a Stripe customer ID');
      }

      const session = await this.stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${this.resolveAppBaseUrl()}/dashboard`,
      });

      return {
        url: session.url,
      };
    } catch (error) {
      this.logger.error('Error creating customer portal:', error);
      throw error;
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

      const subscription = await this.stripe.subscriptions.update(
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
      this.logger.error('Error cancelling subscription:', error);
      throw error;
    }
  }

  /**
   * Reativar assinatura
   */
  async reactivateSubscription(clerkUserId: string) {
    try {
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

      const subscription = await this.stripe.subscriptions.update(
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
      this.logger.error('Error reactivating subscription:', error);
      throw error;
    }
  }

  /**
   * Obter assinatura do usuário
   */
  async getUserSubscription(clerkUserId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true },
      });

      if (!user) {
        return null;
      }

      const subscriptionRecord = await this.prisma.subscription.findFirst({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
      });

      if (!subscriptionRecord?.stripeId) {
        return null;
      }

      let subscription = await this.stripe.subscriptions.retrieve(subscriptionRecord.stripeId);
      await this.upsertSubscriptionForUser(user.id, subscription);

      return {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        plan: ['active', 'trialing'].includes(String(subscription.status).toLowerCase())
          ? 'pro'
          : 'free',
      };
    } catch (error) {
      this.logger.error('Error getting user subscription:', error);
      return null;
    }
  }

  /**
   * Processar evento de webhook do Stripe
   */
  async handleWebhookEvent(signature: string, payload: Buffer) {
    try {
      const event = this.stripe.webhooks.constructEvent(
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
      throw error instanceof Error ? new BadRequestException(error.message) : error;
    }
  }

  /**
   * Handler: Checkout session completed
   */
  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
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

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    await this.upsertSubscriptionForUser(userId, subscription);

    this.logger.log(`User ${userId} subscription synchronized: ${subscription.id}`);
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
      data: {
        status: 'active',
      },
    });
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
}
