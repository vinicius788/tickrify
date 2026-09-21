import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StripeService } from './stripe.service';
import { captureServer } from '../../common/analytics/posthog';

jest.mock('../../common/analytics/posthog', () => ({ captureServer: jest.fn() }));

const STARTER_MONTHLY = 'price_1TRvEJB1hl0IoocUvbCyxkt5'; // 200 ticks

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    metadata: {},
    items: { data: [{ price: { id: STARTER_MONTHLY } }] },
    ...overrides,
  };
}

function duplicateKeyError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('StripeService webhooks', () => {
  let service: StripeService;
  let prisma: any;
  let stripe: any;

  const deliver = (type: string, object: Record<string, unknown>, id = 'evt_1') => {
    stripe.webhooks.constructEvent.mockReturnValue({ id, type, data: { object } });
    return service.handleWebhookEvent('sig', Buffer.from('{}'));
  };

  /** Status gravado no registro de eventos pela ultima chamada de $executeRaw. */
  const ledgerStatus = () => {
    const calls = prisma.$executeRaw.mock.calls;
    return calls.length ? calls[calls.length - 1][1] : undefined;
  };

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    (captureServer as jest.Mock).mockClear();

    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'evt_1' }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      subscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 'usr_1' ? { id: 'usr_1', clerkUserId: 'clerk_1' } : null)),
        findFirst: jest.fn(async ({ where }: any) => (where.stripeCustomerId === 'cus_1' ? { id: 'usr_1' } : null)),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userTicks: {
        findUnique: jest.fn().mockResolvedValue({ balance: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      tickTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      adminAudit: { create: jest.fn().mockResolvedValue({}) },
    };

    service = new StripeService(prisma);
    stripe = {
      webhooks: { constructEvent: jest.fn() },
      subscriptions: {
        retrieve: jest.fn().mockResolvedValue(subscription()),
        list: jest.fn().mockResolvedValue({ data: [] }),
      },
      customers: { retrieve: jest.fn().mockResolvedValue({ id: 'cus_1', metadata: {} }) },
    };
    (service as any).stripe = stripe;
  });

  describe('verificacao e idempotencia', () => {
    it('assinatura HMAC invalida devolve 400 sem tocar no banco', async () => {
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw Object.assign(new Error('bad'), { type: 'StripeSignatureVerificationError' });
      });

      await expect(service.handleWebhookEvent('x', Buffer.from('{}'))).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('evento ja processado e ignorado: nenhum efeito repetido', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: 'processed' }]);

      const result = await deliver('invoice.payment_succeeded', { id: 'in_1', subscription: 'sub_1' });

      expect(result).toEqual({ received: true, duplicate: true });
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(prisma.userTicks.upsert).not.toHaveBeenCalled();
    });

    it('mesmo evento em processamento paralelo devolve 409 para a Stripe reenviar', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: 'processing' }]);

      await expect(deliver('customer.subscription.updated', subscription())).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('sucesso marca o evento como processed', async () => {
      await deliver('customer.subscription.updated', subscription());
      expect(ledgerStatus()).toBe('processed');
    });

    it('registro fora do ar nao perde o evento: processa assim mesmo', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('relation does not exist'));

      await expect(deliver('customer.subscription.updated', subscription())).resolves.toEqual({ received: true });
      expect(prisma.subscription.upsert).toHaveBeenCalled();
    });
  });

  describe('checkout.session.completed', () => {
    const session = (overrides: Record<string, unknown> = {}) => ({
      id: 'cs_1',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'paid',
      subscription: 'sub_1',
      customer: 'cus_1',
      client_reference_id: 'usr_1',
      metadata: { userId: 'usr_1', clerkUserId: 'clerk_1', checkoutSource: 'pricing' },
      ...overrides,
    });

    it('ativa pelo status REAL da Stripe e dispara subscription_activated uma vez', async () => {
      await expect(deliver('checkout.session.completed', session())).resolves.toEqual({ received: true });

      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeId: 'sub_1' },
          create: expect.objectContaining({ userId: 'usr_1', status: 'active', priceId: STARTER_MONTHLY }),
        }),
      );
      expect(captureServer).toHaveBeenCalledTimes(1);
      expect(captureServer).toHaveBeenCalledWith('clerk_1', 'subscription_activated', expect.objectContaining({ checkoutSource: 'pricing' }));
    });

    it('pagamento pendente grava `incomplete` e NAO libera acesso nem conta receita', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'incomplete' }));

      await deliver('checkout.session.completed', session({ payment_status: 'unpaid' }));

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ status: 'incomplete' }) }),
      );
      expect(captureServer).not.toHaveBeenCalled();
    });

    it('sem metadata usa o client_reference_id para achar o usuario', async () => {
      await deliver('checkout.session.completed', session({ metadata: {} }));

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ userId: 'usr_1' }) }),
      );
    });

    it('usuario impossivel de achar vira erro (Stripe reenvia) em vez de 200 silencioso', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ customer: 'cus_unknown' }));

      await expect(
        deliver('checkout.session.completed', session({ metadata: {}, client_reference_id: null, customer: 'cus_unknown' })),
      ).rejects.toBeDefined();
      expect(ledgerStatus()).toBe('failed');
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });
  });

  describe('customer.subscription.*', () => {
    it('updated atrasado nao reativa assinatura cancelada: vale o estado atual da Stripe', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'canceled' }));

      await deliver('customer.subscription.updated', subscription({ status: 'active' }));

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'canceled' }) }),
      );
    });

    it('created acha o dono pela metadata gravada na assinatura', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ metadata: { userId: 'usr_1' } }));

      await deliver('customer.subscription.created', subscription({ metadata: { userId: 'usr_1' } }));

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ userId: 'usr_1' }) }),
      );
    });

    it('deleted grava canceled', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'canceled' }));

      await deliver('customer.subscription.deleted', subscription({ status: 'canceled' }));

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'canceled' }) }),
      );
    });

    it('deleted de assinatura que a Stripe ja apagou marca canceled pelo id', async () => {
      stripe.subscriptions.retrieve.mockRejectedValue(Object.assign(new Error('gone'), { code: 'resource_missing' }));

      await expect(deliver('customer.subscription.deleted', subscription())).resolves.toEqual({ received: true });
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({ where: { stripeId: 'sub_1' }, data: { status: 'canceled' } });
    });
  });

  describe('invoice.payment_succeeded', () => {
    const invoice = (overrides: Record<string, unknown> = {}) => ({
      id: 'in_1',
      customer: 'cus_1',
      subscription: 'sub_1',
      billing_reason: 'subscription_cycle',
      ...overrides,
    });

    it('credita o pacote UMA vez, com a chave da fatura, e sincroniza so esta assinatura', async () => {
      await deliver('invoice.payment_succeeded', invoice());

      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 200, stripePaymentIntentId: 'subscription_invoice:in_1' }),
        }),
      );
      expect(prisma.userTicks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { balance: { increment: 200 } } }),
      );
      // Antes: updateMany({ where: { userId } }) reativava ate as canceladas.
      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    });

    it('formato basil (API do endpoint em producao): assinatura em parent.subscription_details', async () => {
      // Formato copiado do evento real in_1UEFUv... (10/09/2026): sem
      // `subscription` no topo. O handler antigo saia daqui sem creditar.
      await deliver('invoice.payment_succeeded', {
        id: 'in_basil',
        customer: 'cus_1',
        billing_reason: 'subscription_create',
        parent: {
          quote_details: null,
          subscription_details: { metadata: {}, subscription: 'sub_1' },
          type: 'subscription_details',
        },
      });

      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 200, stripePaymentIntentId: 'subscription_invoice:in_basil' }),
        }),
      );
    });

    it('reentrega da mesma fatura bate na chave unica e nao credita de novo', async () => {
      prisma.$transaction.mockRejectedValueOnce(duplicateKeyError());

      await expect(deliver('invoice.payment_succeeded', invoice(), 'evt_2')).resolves.toEqual({ received: true });
      expect(ledgerStatus()).toBe('processed');
    });

    it('fatura ja creditada pelo formato antigo nao e creditada de novo', async () => {
      prisma.tickTransaction.findFirst.mockResolvedValue({ id: 'tx_old' });

      await deliver('invoice.payment_succeeded', invoice());

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('fatura de troca de plano nao da pacote', async () => {
      await deliver('invoice.payment_succeeded', invoice({ billing_reason: 'subscription_update' }));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('erro ao creditar SOBE (Stripe reenvia) em vez de ser engolido', async () => {
      prisma.$transaction.mockRejectedValueOnce(new Error('db down'));

      await expect(deliver('invoice.payment_succeeded', invoice())).rejects.toBeDefined();
      expect(ledgerStatus()).toBe('failed');
    });
  });

  describe('invoice.payment_failed', () => {
    it('grava o status real so desta assinatura e registra a falha no AdminAudit', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));

      await deliver('invoice.payment_failed', {
        id: 'in_2',
        customer: 'cus_1',
        parent: { subscription_details: { subscription: 'sub_1', metadata: {} }, type: 'subscription_details' },
        amount_due: 2900,
        currency: 'usd',
        attempt_count: 1,
        billing_reason: 'subscription_cycle',
        next_payment_attempt: 1790000000,
        customer_email: 'a@b.com',
      });

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'past_due' }) }),
      );
      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
      expect(prisma.adminAudit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'stripe_payment_failed',
          targetUserId: 'usr_1',
          details: expect.objectContaining({ invoiceId: 'in_2', amountDue: 2900, subscriptionStatus: 'past_due' }),
        }),
      });
      expect(captureServer).toHaveBeenCalledWith('clerk_1', 'payment_failed', expect.any(Object));
    });
  });

  describe('credito fora do webhook', () => {
    it('ensureTicks credita o pacote da ultima fatura PAGA, com a mesma chave do webhook', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ latest_invoice: { id: 'in_9', status: 'paid' } }));

      await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });

      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stripePaymentIntentId: 'subscription_invoice:in_9' }) }),
      );
    });

    it('ensureTicks NAO recarrega o saldo zerado de um periodo ja creditado', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ latest_invoice: { id: 'in_9', status: 'paid' } }));
      prisma.$transaction.mockRejectedValueOnce(duplicateKeyError());

      await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });

      expect(prisma.userTicks.upsert).toHaveBeenCalledTimes(1); // a tentativa, desfeita pela transacao
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    describe('assinantes anteriores a 22/09/2026 (transicao)', () => {
      const SEPT_8 = Date.UTC(2026, 8, 8) / 1000;
      const OCT_8 = Date.UTC(2026, 9, 8) / 1000;

      it('no periodo que ja pagaram: saldo zerado recebe o pacote, como antes', async () => {
        stripe.subscriptions.retrieve.mockResolvedValue(
          subscription({ created: SEPT_8, current_period_start: SEPT_8, latest_invoice: { id: 'in_sep', status: 'paid' } }),
        );
        prisma.tickTransaction.findFirst.mockImplementation(async (args: any) =>
          args?.orderBy ? { id: 'tx_usage_42' } : null,
        );

        await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });

        expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ amount: 200, stripePaymentIntentId: 'legacy_refill:sub_1:tx_usage_42' }),
          }),
        );
      });

      it('duas analises no mesmo saldo zero creditam uma vez so (mesma chave)', async () => {
        stripe.subscriptions.retrieve.mockResolvedValue(subscription({ created: SEPT_8, current_period_start: SEPT_8 }));
        prisma.tickTransaction.findFirst.mockImplementation(async (args: any) =>
          args?.orderBy ? { id: 'tx_usage_42' } : null,
        );
        prisma.$transaction.mockResolvedValueOnce([]).mockRejectedValueOnce(duplicateKeyError());

        await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });
        await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });

        const keys = prisma.tickTransaction.create.mock.calls.map((c: any) => c[0].data.stripePaymentIntentId);
        expect(keys).toEqual(['legacy_refill:sub_1:tx_usage_42', 'legacy_refill:sub_1:tx_usage_42']);
      });

      it('depois da renovacao vale o plano: um pacote por fatura paga', async () => {
        stripe.subscriptions.retrieve.mockResolvedValue(
          subscription({ created: SEPT_8, current_period_start: OCT_8, latest_invoice: { id: 'in_oct', status: 'paid' } }),
        );

        await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });

        expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ stripePaymentIntentId: 'subscription_invoice:in_oct' }) }),
        );
      });

      it('assinatura nova (depois do corte) ja nasce na regra do plano', async () => {
        const OCT_1 = Date.UTC(2026, 9, 1) / 1000;
        stripe.subscriptions.retrieve.mockResolvedValue(
          subscription({ created: OCT_1, current_period_start: OCT_1, latest_invoice: { id: 'in_new', status: 'paid' } }),
        );

        await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });

        expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ stripePaymentIntentId: 'subscription_invoice:in_new' }) }),
        );
      });
    });

    it('ensureTicks nao credita com a ultima fatura em aberto', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ latest_invoice: { id: 'in_9', status: 'open' } }));

      await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ensureTicks com saldo nao chama a Stripe', async () => {
      prisma.userTicks.findUnique.mockResolvedValue({ balance: 5 });

      await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });

      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('acesso manual recebe um pacote por mes-calendario', async () => {
      await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'manual_owner_1', priceId: STARTER_MONTHLY });

      const month = new Date().toISOString().slice(0, 7);
      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stripePaymentIntentId: `manual_subscription:manual_owner_1:${month}` }),
        }),
      );
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('lazy sync usa a chave da ultima fatura, a mesma do webhook', async () => {
      stripe.subscriptions.list.mockResolvedValue({ data: [subscription({ latest_invoice: 'in_7' })] });

      await expect(service.syncActiveSubscriptionFromStripe('usr_1', 'cus_1')).resolves.toBe(true);

      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stripePaymentIntentId: 'subscription_invoice:in_7' }) }),
      );
    });
  });
});
