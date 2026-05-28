import { BadRequestException } from '@nestjs/common';
import { StripeService } from './stripe.service';

describe('StripeService webhook handling', () => {
  let service: StripeService;
  let prisma: any;
  let stripeMock: any;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'YOUR_SECRET_KEY_HERE';
    process.env.STRIPE_WEBHOOK_SECRET = 'YOUR_WEBHOOK_SECRET_HERE';
    process.env.STRIPE_PUBLISHABLE_KEY = 'YOUR_PUBLISHABLE_KEY_HERE';

    prisma = {
      subscription: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new StripeService(prisma);

    stripeMock = {
      webhooks: {
        constructEvent: jest.fn(),
      },
      subscriptions: {
        retrieve: jest.fn(),
      },
      customers: {
        retrieve: jest.fn(),
        create: jest.fn(),
      },
      checkout: {
        sessions: {
          create: jest.fn(),
        },
      },
      billingPortal: {
        sessions: {
          create: jest.fn(),
        },
      },
    };

    (service as any).stripe = stripeMock;
  });

  it('returns 400 for invalid webhook signature', async () => {
    const signatureError = Object.assign(new Error('Invalid signature'), {
      type: 'StripeSignatureVerificationError',
    });
    stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw signatureError;
    });

    await expect(
      service.handleWebhookEvent('invalid_signature', Buffer.from('{}')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates Subscription on valid checkout.session.completed webhook', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          metadata: { userId: 'usr_1' },
          subscription: 'sub_123',
        },
      },
    });

    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      items: {
        data: [{ price: { id: 'price_pro_monthly' } }],
      },
    });

    await expect(
      service.handleWebhookEvent('valid_signature', Buffer.from('{}')),
    ).resolves.toEqual({ received: true });

    expect(prisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeId: 'sub_123' },
        create: expect.objectContaining({
          userId: 'usr_1',
          stripeId: 'sub_123',
          status: 'active',
          priceId: 'price_pro_monthly',
        }),
      }),
    );
  });
});
