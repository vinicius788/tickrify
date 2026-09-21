import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StripeService } from './stripe.service';
import { captureServer } from '../../common/analytics/posthog';

jest.mock('../../common/analytics/posthog', () => ({ captureServer: jest.fn() }));
jest.mock('../../common/analytics/meta-capi', () => ({ sendMetaEvent: jest.fn().mockResolvedValue(true) }));
import { sendMetaEvent } from '../../common/analytics/meta-capi';

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
    (sendMetaEvent as jest.Mock).mockClear();

    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'evt_1' }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      // Aceita os dois formatos do Prisma: lista de operacoes ou callback.
      $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
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

    it('ativa pelo status REAL da Stripe e dispara checkout_completed uma vez, deduplicado', async () => {
      await expect(deliver('checkout.session.completed', session())).resolves.toEqual({ received: true });

      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeId: 'sub_1' },
          create: expect.objectContaining({ userId: 'usr_1', status: 'active', priceId: STARTER_MONTHLY }),
        }),
      );
      expect(captureServer).toHaveBeenCalledTimes(1);
      expect(captureServer).toHaveBeenCalledWith(
        'clerk_1',
        'checkout_completed',
        expect.objectContaining({ checkoutSource: 'pricing', sessionId: 'cs_1' }),
        expect.objectContaining({ dedupeKey: 'checkout_completed:cs_1' }),
      );
      // O nome antigo contava a receita em dobro com o do navegador.
      expect(captureServer).not.toHaveBeenCalledWith('clerk_1', 'subscription_activated', expect.anything(), expect.anything());
    });

    it('Purchase no Meta SO com pagamento confirmado, com o event_id do pixel e o contexto da sessao', async () => {
      (sendMetaEvent as jest.Mock).mockClear();
      await deliver(
        'checkout.session.completed',
        session({
          amount_total: 1885,
          currency: 'usd',
          customer_details: { email: 'a@b.com' },
          metadata: { userId: 'usr_1', clerkUserId: 'clerk_1', ads_consent: '1', ads_fbp: 'fb.1.1789000000000.123456789' },
        }),
      );

      expect(sendMetaEvent).toHaveBeenCalledTimes(1);
      expect(sendMetaEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'Purchase',
          eventId: 'purchase_cs_1',
          ads: expect.objectContaining({ consent: true, fbp: 'fb.1.1789000000000.123456789' }),
          customData: expect.objectContaining({ value: 18.85, currency: 'usd' }),
        }),
      );
    });

    it('pagamento pendente grava `incomplete` e NAO libera acesso nem conta receita', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'incomplete' }));

      await deliver('checkout.session.completed', session({ payment_status: 'unpaid' }));

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ status: 'incomplete' }) }),
      );
      expect(captureServer).not.toHaveBeenCalled();
      expect(sendMetaEvent).not.toHaveBeenCalledWith(expect.objectContaining({ eventName: 'Purchase' }));
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

    it('created emite subscription_created uma vez; updated nao emite', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ created: 1789000000, metadata: { checkoutSource: 'pricing' } }));

      await deliver('customer.subscription.created', subscription());
      await deliver('customer.subscription.updated', subscription(), 'evt_2');

      const created = (captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'subscription_created');
      expect(created).toHaveLength(1);
      expect(created[0][3]).toEqual({ dedupeKey: 'subscription_created:sub_1', timestamp: new Date(1789000000 * 1000) });
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
    const PERIOD_START = Date.UTC(2026, 9, 8) / 1000; // 08/10/2026
    const invoice = (overrides: Record<string, unknown> = {}) => ({
      id: 'in_1',
      customer: 'cus_1',
      billing_reason: 'subscription_cycle',
      parent: { subscription_details: { subscription: 'sub_1', metadata: {} }, type: 'subscription_details' },
      ...overrides,
    });

    beforeEach(() => {
      stripe.subscriptions.retrieve.mockResolvedValue(
        subscription({ current_period_start: PERIOD_START, current_period_end: PERIOD_START + 30 * 86400 }),
      );
    });

    it('renovacao DEFINE o saldo em 200 (nao soma) e grava a janela do mes', async () => {
      prisma.userTicks.findUnique.mockResolvedValue({ balance: 57 });

      await deliver('invoice.payment_succeeded', invoice());

      expect(prisma.userTicks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { balance: 200 }, create: { userId: 'usr_1', balance: 200 } }),
      );
      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 143, stripePaymentIntentId: 'allowance:sub_1:2026-10-08' }),
        }),
      );
      // Antes: updateMany({ where: { userId } }) reativava ate as canceladas.
      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    });

    it('saldo acima do teto volta para 200 (nunca mais de 200)', async () => {
      prisma.userTicks.findUnique.mockResolvedValue({ balance: 358 });

      await deliver('invoice.payment_succeeded', invoice());

      expect(prisma.userTicks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { balance: 200 } }));
      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: -158 }) }),
      );
    });

    it('emite payment_succeeded com valor e chave da fatura (so o backend)', async () => {
      await deliver('invoice.payment_succeeded', invoice({ amount_paid: 1885, currency: 'usd', created: 1789075629 }));

      expect(captureServer).toHaveBeenCalledWith(
        'clerk_1',
        'payment_succeeded',
        expect.objectContaining({ invoiceId: 'in_1', value: 18.85, currency: 'USD', billingReason: 'subscription_cycle' }),
        expect.objectContaining({ dedupeKey: 'payment_succeeded:in_1' }),
      );
    });

    it('grava o periodo de cobranca na assinatura', async () => {
      await deliver('invoice.payment_succeeded', invoice());

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ currentPeriodStart: new Date(PERIOD_START * 1000) }),
        }),
      );
    });

    it('janela ja aplicada (reentrega, ou o painel chegou antes) nao mexe no saldo', async () => {
      prisma.tickTransaction.findUnique.mockResolvedValue({ id: 'tx_allowance' });

      await expect(deliver('invoice.payment_succeeded', invoice(), 'evt_2')).resolves.toEqual({ received: true });
      expect(prisma.userTicks.upsert).not.toHaveBeenCalled();
    });

    it('corrida na mesma janela bate na chave unica e nao falha o webhook', async () => {
      prisma.$transaction.mockRejectedValueOnce(duplicateKeyError());

      await expect(deliver('invoice.payment_succeeded', invoice(), 'evt_3')).resolves.toEqual({ received: true });
      expect(ledgerStatus()).toBe('processed');
    });

    it('formato antigo da API (subscription no topo) tambem funciona', async () => {
      await deliver('invoice.payment_succeeded', { id: 'in_old', customer: 'cus_1', subscription: 'sub_1', billing_reason: 'subscription_create' });
      expect(prisma.userTicks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { balance: 200 } }));
    });

    it('fatura de troca de plano nao abre janela', async () => {
      await deliver('invoice.payment_succeeded', invoice({ billing_reason: 'subscription_update' }));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('erro ao aplicar o saldo SOBE (Stripe reenvia) em vez de ser engolido', async () => {
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
      expect(captureServer).toHaveBeenCalledWith(
        'clerk_1',
        'payment_failed',
        expect.objectContaining({ invoiceId: 'in_2' }),
        expect.objectContaining({ dedupeKey: 'payment_failed:in_2:1' }),
      );
    });
  });

  describe('janela mensal fora do webhook (painel e analise)', () => {
    const SEPT_10 = new Date(Date.UTC(2026, 8, 10, 18, 27));
    const OCT_10 = new Date(Date.UTC(2026, 9, 10, 18, 27));

    it('assinante atual (periodo 10/09): primeira checagem define o saldo em 200', async () => {
      prisma.userTicks.findUnique.mockResolvedValue({ balance: 358 });

      await service.ensureTicksForActiveSubscriber('usr_1', {
        stripeId: 'sub_1',
        priceId: STARTER_MONTHLY,
        currentPeriodStart: SEPT_10,
        currentPeriodEnd: new Date(Date.now() + 86400_000),
      });

      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled(); // periodo em dia no banco
      expect(prisma.userTicks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { balance: 200 } }));
      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stripePaymentIntentId: 'allowance:sub_1:2026-09-10' }) }),
      );
    });

    it('gastar tudo NAO recarrega no mesmo mes: a janela ja foi aplicada', async () => {
      prisma.userTicks.findUnique.mockResolvedValue({ balance: 0 });
      prisma.tickTransaction.findUnique.mockResolvedValue({ id: 'tx_allowance_sep' });

      await service.ensureTicksForActiveSubscriber('usr_1', {
        stripeId: 'sub_1',
        priceId: STARTER_MONTHLY,
        currentPeriodStart: SEPT_10,
        currentPeriodEnd: new Date(Date.now() + 86400_000),
      });

      expect(prisma.userTicks.upsert).not.toHaveBeenCalled();
    });

    it('periodo ausente no banco (linhas antigas): busca na Stripe e grava', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(
        subscription({ current_period_start: SEPT_10.getTime() / 1000, current_period_end: OCT_10.getTime() / 1000 }),
      );

      await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });

      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ currentPeriodStart: SEPT_10 }) }),
      );
      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stripePaymentIntentId: 'allowance:sub_1:2026-09-10' }) }),
      );
    });

    it('assinatura que deixou de estar ativa na Stripe nao recebe saldo', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due', current_period_start: 1, current_period_end: 2 }));

      await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'sub_1', priceId: STARTER_MONTHLY });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('acesso manual: janela por mes-calendario', async () => {
      await service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'manual_owner_1', priceId: STARTER_MONTHLY });

      const month = new Date().toISOString().slice(0, 7);
      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stripePaymentIntentId: `allowance:manual_owner_1:${month}-01` }) }),
      );
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('falha aqui nao derruba a analise', async () => {
      prisma.tickTransaction.findUnique.mockRejectedValue(new Error('db down'));

      await expect(
        service.ensureTicksForActiveSubscriber('usr_1', { stripeId: 'manual_owner_1', priceId: STARTER_MONTHLY }),
      ).resolves.toBeUndefined();
    });

    it('lazy sync aplica a mesma janela do webhook', async () => {
      stripe.subscriptions.list.mockResolvedValue({
        data: [subscription({ current_period_start: SEPT_10.getTime() / 1000, current_period_end: OCT_10.getTime() / 1000 })],
      });

      await expect(service.syncActiveSubscriptionFromStripe('usr_1', 'cus_1')).resolves.toBe(true);

      expect(prisma.tickTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stripePaymentIntentId: 'allowance:sub_1:2026-09-10' }) }),
      );
    });
  });
});
