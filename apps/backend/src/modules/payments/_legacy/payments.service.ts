// DEPRECATED - não exposto no módulo, mantido apenas por histórico.
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PaymentsService {
  private stripe: Stripe;

  constructor(private prisma: PrismaService) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2023-10-16',
    });
  }

  async createCheckoutSession(userId: string, priceId: string, mode: 'payment' | 'subscription') {
    const frontendBaseUrl = this.resolveFrontendBaseUrl();
    const session = await this.stripe.checkout.sessions.create({
      mode,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBaseUrl}/canceled`,
      metadata: { userId },
    });

    return { sessionId: session.id, url: session.url };
  }

  async createPortalSession(customerId: string) {
    const frontendBaseUrl = this.resolveFrontendBaseUrl();
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${frontendBaseUrl}/account`,
    });

    return { url: session.url };
  }

  async handleWebhook(signature: string, body: Buffer) {
    const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required');
    }

    const event = this.stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret,
    );

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;
    }

    return { received: true };
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId;
    if (!userId) return;

    if (session.mode === 'subscription' && session.subscription) {
      const subscription = await this.stripe.subscriptions.retrieve(
        session.subscription as string,
      );

      await this.prisma.subscription.upsert({
        where: { stripeId: subscription.id },
        create: {
          userId,
          stripeId: subscription.id,
          status: subscription.status,
          priceId: subscription.items.data[0]?.price.id,
        },
        update: {
          status: subscription.status,
          priceId: subscription.items.data[0]?.price.id,
        },
      });
    }
  }

  private async handleSubscriptionChange(subscription: Stripe.Subscription) {
    await this.prisma.subscription.updateMany({
      where: { stripeId: subscription.id },
      data: {
        status: subscription.status,
        priceId: subscription.items.data[0]?.price.id,
      },
    });
  }

  private resolveFrontendBaseUrl(): string {
    const candidate = String(process.env.FRONTEND_URL || '').trim();
    if (!candidate) {
      throw new Error('FRONTEND_URL is required for payments redirect URLs');
    }

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
        throw new Error('FRONTEND_URL must use https (or localhost for local development)');
      }

      return parsed.origin;
    } catch {
      throw new Error('FRONTEND_URL is invalid');
    }
  }
}
