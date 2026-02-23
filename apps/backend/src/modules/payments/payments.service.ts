import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PaymentsService {
  private stripe: Stripe;

  constructor(private prisma: PrismaService) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16',
    });
  }

  async createCheckoutSession(userId: string, priceId: string, mode: 'payment' | 'subscription') {
    const session = await this.stripe.checkout.sessions.create({
      mode,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/canceled`,
      metadata: { userId },
    });

    return { sessionId: session.id, url: session.url };
  }

  async createPortalSession(customerId: string) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL}/account`,
    });

    return { url: session.url };
  }

  async handleWebhook(signature: string, body: Buffer) {
    const event = this.stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
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
}

