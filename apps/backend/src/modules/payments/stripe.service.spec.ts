import { portalV2Configuration, PORTAL_V2_API_VERSION } from '../../config/stripe.config';
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
  let affiliates: any;

  /** Momento em que a Stripe criou o evento (segundos); igual em qualquer reentrega. */
  const EVENT_CREATED = 1790000000;

  const deliver = (type: string, object: Record<string, unknown>, id = 'evt_1', created = EVENT_CREATED) => {
    stripe.webhooks.constructEvent.mockReturnValue({ id, type, created, data: { object } });
    return service.handleWebhookEvent('sig', Buffer.from('{}'));
  };

  /** Status gravado no registro de eventos pela ultima chamada de $executeRaw. */
  const ledgerStatus = () => {
    const calls = prisma.$executeRaw.mock.calls;
    return calls.length ? calls[calls.length - 1][1] : undefined;
  };

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_TEST_PRODUCT_ID = 'prod_unit';
    process.env.STRIPE_TEST_PRICE_WEEKLY = 'price_1UKeWPB1hl0IoocUjsQNv9BG';
    process.env.STRIPE_TEST_PRICE_MONTHLY = STARTER_MONTHLY;
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
      adminAudit: {
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    affiliates = {
      recordInvoiceCommission: jest.fn().mockResolvedValue(undefined),
      cancelForCharge: jest.fn().mockResolvedValue(0),
    };
    service = new StripeService(prisma, affiliates);
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

  describe('cancelamento pelo portal', () => {
    const deliverUpdate = (object: Record<string, unknown>, previous: Record<string, unknown>, id = 'evt_c1') => {
      stripe.webhooks.constructEvent.mockReturnValue({
        id,
        type: 'customer.subscription.updated',
        data: { object, previous_attributes: previous },
      });
      return service.handleWebhookEvent('sig', Buffer.from('{}'));
    };
    const events = () => (captureServer as jest.Mock).mock.calls.map((call) => call[1]);
    const canceling = subscription({
      cancel_at_period_end: true,
      cancel_at: null,
      created: Math.floor(Date.now() / 1000) - 3 * 86400,
      current_period_end: Math.floor(Date.now() / 1000) + 4 * 86400,
      cancellation_details: { reason: 'cancellation_requested', feedback: 'too_expensive', comment: null },
    });

    it('agendar o cancelamento emite subscription_cancel_scheduled com motivo e dia', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(canceling);

      await deliverUpdate(canceling, { cancel_at_period_end: false });

      const call = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'subscription_cancel_scheduled');
      expect(call?.[2]).toEqual(expect.objectContaining({ reason: 'too_expensive', subscription_day: 4 }));
      expect(call?.[3]).toEqual(expect.objectContaining({ dedupeKey: 'cancel:evt_c1' }));
      expect(events()).not.toContain('subscription_reactivated');
    });

    it('grava o cancelamento agendado e o motivo no banco', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(canceling);

      await deliverUpdate(canceling, { cancel_at_period_end: false });

      const update = prisma.$executeRawUnsafe.mock.calls.find((c: any[]) => String(c[0]).includes('"cancelAtPeriodEnd" = $2'));
      expect(update?.slice(1, 3)).toEqual(['sub_1', true]);
      expect(update?.[6]).toBe('cancellation_requested');
      expect(update?.[7]).toBe('too_expensive');
    });

    it('desfazer antes do fim emite subscription_reactivated', async () => {
      const active = subscription({ cancel_at_period_end: false, cancel_at: null, created: 1 });
      stripe.subscriptions.retrieve.mockResolvedValue(active);

      await deliverUpdate(active, { cancel_at_period_end: true });

      expect(events()).toContain('subscription_reactivated');
      expect(events()).not.toContain('subscription_cancel_scheduled');
    });

    it('update sem mudanca de cancelamento nao emite nada', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(canceling);

      await deliverUpdate(canceling, { metadata: {} });

      expect(events()).not.toContain('subscription_cancel_scheduled');
    });

    it('e-mail de confirmacao desligado so loga (nada sai)', async () => {
      const mail = { sendCancellationConfirm: jest.fn() };
      (service as any).mail = mail;
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', clerkUserId: 'clerk_1', email: 'a@b.c', name: 'Ana' });
      stripe.subscriptions.retrieve.mockResolvedValue(canceling);

      await deliverUpdate(canceling, { cancel_at_period_end: false });

      expect(mail.sendCancellationConfirm).not.toHaveBeenCalled();
    });
  });

  describe('portal e reativacao', () => {
    it('sem assinatura gerenciavel o portal responde 403 e nao cria sessao', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', stripeCustomerId: 'cus_1' });
      prisma.subscription.findFirst = jest.fn().mockResolvedValue(null);
      stripe.billingPortal = { sessions: { create: jest.fn() }, configurations: { list: jest.fn(), create: jest.fn() } };

      await expect(service.createCustomerPortal('clerk_1')).rejects.toMatchObject({ status: 403 });
      expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    });

    it('com assinatura abre o portal do customer do BANCO com a configuracao propria', async () => {
      process.env.APP_URL = 'https://tickrify.com';
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', stripeCustomerId: 'cus_1' });
      prisma.subscription.findFirst = jest.fn().mockResolvedValue({ stripeId: 'sub_1' });
      stripe.billingPortal = {
        sessions: { create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/x' }) },
        configurations: {
          list: jest.fn().mockResolvedValue({ data: [] }),
          create: jest.fn().mockResolvedValue({ id: 'bpc_1' }),
        },
      };

      await expect(service.createCustomerPortal('clerk_1')).resolves.toEqual({ url: 'https://billing.stripe.com/x' });
      expect(stripe.billingPortal.configurations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          features: expect.objectContaining({
            subscription_cancel: expect.objectContaining({ enabled: true, mode: 'at_period_end' }),
            payment_method_update: { enabled: true },
            invoice_history: { enabled: true },
          }),
        }),
      );
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_1',
        return_url: 'https://tickrify.com/dashboard/settings',
        configuration: 'bpc_1',
      });
      expect(captureServer).toHaveBeenCalledWith('clerk_1', 'billing_portal_opened', { subscriptionId: 'sub_1' });
    });

    it('reativar desfaz o cancelamento agendado na Stripe', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1' });
      prisma.subscription.findFirst = jest.fn().mockResolvedValue({ stripeId: 'sub_1' });
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ cancel_at_period_end: true, cancel_at: null }));
      stripe.subscriptions.update = jest.fn().mockResolvedValue(subscription({ cancel_at_period_end: false, cancel_at: null }));

      const view = await service.reactivateSubscription('clerk_1');

      expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: false });
      expect(view).toEqual(expect.objectContaining({ cancelAtPeriodEnd: false, canReactivate: false }));
    });

    it('reativar o que nao esta cancelando responde 409', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1' });
      prisma.subscription.findFirst = jest.fn().mockResolvedValue({ stripeId: 'sub_1' });
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ cancel_at_period_end: false, cancel_at: null }));
      stripe.subscriptions.update = jest.fn();

      await expect(service.reactivateSubscription('clerk_1')).rejects.toBeInstanceOf(ConflictException);
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
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
        expect.objectContaining({ dedupeKey: 'checkout_completed:cs_1', timestamp: new Date(EVENT_CREATED * 1000) }),
      );
      // O nome antigo contava a receita em dobro com o do navegador.
      expect(captureServer).not.toHaveBeenCalledWith('clerk_1', 'subscription_activated', expect.anything(), expect.anything());
    });

    it('checkout_completed usa a hora do evento e guarda a criacao da sessao em sessionCreatedAt', async () => {
      const sessionCreated = EVENT_CREATED - 120;
      await deliver('checkout.session.completed', session({ created: sessionCreated }));

      const call = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'checkout_completed');
      expect(call[3].timestamp).toEqual(new Date(EVENT_CREATED * 1000));
      expect(call[3].dedupeKey).toBe('checkout_completed:cs_1');
      expect(call[2].sessionCreatedAt).toBe(new Date(sessionCreated * 1000).toISOString());
    });

    it('sessao sem created: sessionCreatedAt nulo e timestamp valido (nunca Invalid Date)', async () => {
      await deliver('checkout.session.completed', session());

      const call = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'checkout_completed');
      expect(call[2].sessionCreatedAt).toBeNull();
      expect(Number.isNaN(call[3].timestamp.getTime())).toBe(false);
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

    it('created marca assinante no PostHog so quando a assinatura nasce paga', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'active' }));
      await deliver('customer.subscription.created', subscription());
      const paid = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'subscription_created');
      expect(paid[2]).toEqual(expect.objectContaining({ $set: { is_subscriber: true } }));

      (captureServer as jest.Mock).mockClear();
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ id: 'sub_2', status: 'incomplete' }));
      await deliver('customer.subscription.created', subscription({ id: 'sub_2', status: 'incomplete' }), 'evt_3');
      const declined = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'subscription_created');
      expect(declined).toBeDefined();
      expect(declined[2]).not.toHaveProperty('$set');
    });

    it('deleted grava canceled', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'canceled' }));

      await deliver('customer.subscription.deleted', subscription({ status: 'canceled' }));

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'canceled' }) }),
      );
    });

    it('deleted desmarca a pessoa como assinante no PostHog', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'canceled' }));

      await deliver('customer.subscription.deleted', subscription({ status: 'canceled' }));

      expect(captureServer).toHaveBeenCalledWith(
        'clerk_1',
        'subscription_ended',
        expect.objectContaining({ $set: { is_subscriber: false } }),
        expect.anything(),
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

    // A janela mensal e calculada a partir de "agora": o relogio fica dentro do periodo que comeca em 08/10.
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-10-08T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      stripe.subscriptions.retrieve.mockResolvedValue(
        subscription({ current_period_start: PERIOD_START, current_period_end: PERIOD_START + 30 * 86400 }),
      );
    });

    afterEach(() => {
      jest.useRealTimers();
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
        expect.objectContaining({
          invoiceId: 'in_1',
          value: 18.85,
          currency: 'USD',
          billingReason: 'subscription_cycle',
          $set: { is_subscriber: true },
        }),
        expect.objectContaining({ dedupeKey: 'payment_succeeded:in_1' }),
      );
    });

    it('payment_succeeded leva plano e perfil do cartao quando a Stripe devolve', async () => {
      stripe.invoices = {
        retrieve: jest.fn().mockResolvedValue({
          payment_intent: {
            latest_charge: { created: 1790100000, payment_method_details: { card: { country: 'US', funding: 'debit', brand: 'mastercard', wallet: null } } },
          },
        }),
      };

      await deliver('invoice.payment_succeeded', invoice({ attempt_count: 1 }));

      const call = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'payment_succeeded');
      expect(call[2]).toEqual(
        expect.objectContaining({ priceId: STARTER_MONTHLY, attemptCount: 1, cardCountry: 'US', cardFunding: 'debit', cardBrand: 'mastercard', cardWallet: null }),
      );
      expect((captureServer as jest.Mock).mock.calls.some((c) => c[1] === 'payment_recovered')).toBe(false);
    });

    it('pagou so na 3a tentativa: emite payment_recovered uma vez por fatura', async () => {
      await deliver('invoice.payment_succeeded', invoice({ attempt_count: 3, amount_paid: 2900, currency: 'usd' }));

      const recovered = (captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'payment_recovered');
      expect(recovered).toHaveLength(1);
      expect(recovered[0][2]).toEqual(expect.objectContaining({ invoiceId: 'in_1', attemptCount: 3, value: 29, currency: 'USD' }));
      expect(recovered[0][2]).toEqual(expect.objectContaining({ detectedBy: 'attempt_count' }));
      expect(recovered[0][3]).toEqual(expect.objectContaining({ dedupeKey: 'payment_recovered:in_1' }));
      // Ja ha prova pela Stripe: nao precisa consultar o historico.
      expect(prisma.adminAudit.count).not.toHaveBeenCalled();
    });

    it('cartao atualizado no portal (attempt_count continua 1): recuperacao vem do registro da falha desta fatura', async () => {
      prisma.adminAudit.count.mockResolvedValue(1);

      await deliver('invoice.payment_succeeded', invoice({ attempt_count: 1, amount_paid: 2900, currency: 'usd' }));

      expect(prisma.adminAudit.count).toHaveBeenCalledWith({
        where: { action: 'stripe_payment_failed', targetUserId: 'usr_1', details: { path: ['invoiceId'], equals: 'in_1' } },
      });
      const recovered = (captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'payment_recovered');
      expect(recovered).toHaveLength(1);
      expect(recovered[0][2]).toEqual(expect.objectContaining({ invoiceId: 'in_1', attemptCount: 1, detectedBy: 'failure_record', value: 29 }));
    });

    it('fatura que nunca falhou (1o pagamento, conversao de trial, renovacao normal) NAO e recuperacao', async () => {
      prisma.adminAudit.count.mockResolvedValue(0);

      await deliver('invoice.payment_succeeded', invoice({ billing_reason: 'subscription_create', attempt_count: 1, amount_paid: 2900 }));
      await deliver('invoice.payment_succeeded', invoice({ id: 'in_2', attempt_count: 1, amount_paid: 2900 }), 'evt_2');

      expect((captureServer as jest.Mock).mock.calls.some((c) => c[1] === 'payment_recovered')).toBe(false);
      expect((captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'payment_succeeded')).toHaveLength(2);
    });

    it('falha na consulta do historico: nao inventa recuperacao e o pagamento segue normal', async () => {
      prisma.adminAudit.count.mockRejectedValue(new Error('banco indisponivel'));

      await deliver('invoice.payment_succeeded', invoice({ attempt_count: 1, amount_paid: 2900 }));

      expect((captureServer as jest.Mock).mock.calls.some((c) => c[1] === 'payment_recovered')).toBe(false);
      expect((captureServer as jest.Mock).mock.calls.some((c) => c[1] === 'payment_succeeded')).toBe(true);
      expect(prisma.userTicks.upsert).toHaveBeenCalled();
    });

    it('webhook reentregue: a recuperacao sai com o MESMO uuid e o MESMO timestamp, nunca duas vezes diferentes', async () => {
      prisma.adminAudit.count.mockResolvedValue(1);
      const paid = invoice({ attempt_count: 1, amount_paid: 2900, status_transitions: { paid_at: 1790000500 } });

      await deliver('invoice.payment_succeeded', paid);
      await deliver('invoice.payment_succeeded', paid);

      const recovered = (captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'payment_recovered');
      expect(recovered).toHaveLength(2); // o PostHog descarta a 2a pelo uuid + timestamp iguais
      expect(recovered[0][3]).toEqual(recovered[1][3]);
      expect(recovered[0][3]).toEqual({ dedupeKey: 'payment_recovered:in_1', timestamp: new Date(1790000500 * 1000) });
    });

    it('reentrega bloqueada pelo registro de eventos nao chega a emitir de novo', async () => {
      prisma.adminAudit.count.mockResolvedValue(1);
      await deliver('invoice.payment_succeeded', invoice({ attempt_count: 1, amount_paid: 2900 }), 'evt_dup_paid');
      const before = (captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'payment_recovered').length;

      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: 'processed' }]);
      const second = await deliver('invoice.payment_succeeded', invoice({ attempt_count: 1, amount_paid: 2900 }), 'evt_dup_paid');

      expect(second).toEqual({ received: true, duplicate: true });
      expect((captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'payment_recovered')).toHaveLength(before);
    });

    it('falha ao ler a cobranca na Stripe nao impede o evento nem os ticks', async () => {
      stripe.invoices = { retrieve: jest.fn().mockRejectedValue(new Error('timeout')) };

      await deliver('invoice.payment_succeeded', invoice());

      expect((captureServer as jest.Mock).mock.calls.some((c) => c[1] === 'payment_succeeded')).toBe(true);
      expect(prisma.userTicks.upsert).toHaveBeenCalled();
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

    it('fatura paga gera a comissao do afiliado DEPOIS dos ticks, com o dono da assinatura', async () => {
      await deliver('invoice.payment_succeeded', invoice({ amount_paid: 2610 }));

      expect(affiliates.recordInvoiceCommission).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'in_1', amount_paid: 2610 }),
        'usr_1',
      );
      expect(affiliates.recordInvoiceCommission.mock.invocationCallOrder[0]).toBeGreaterThan(
        prisma.userTicks.upsert.mock.invocationCallOrder[0],
      );
    });

    it('erro na comissao SOBE para a Stripe reenviar', async () => {
      affiliates.recordInvoiceCommission.mockRejectedValueOnce(new Error('db down'));
      await expect(deliver('invoice.payment_succeeded', invoice())).rejects.toBeDefined();
      expect(ledgerStatus()).toBe('failed');
    });
  });

  describe('afiliados: refund e disputa', () => {
    it('charge.refunded cancela pela charge e pelo payment intent', async () => {
      await deliver('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: 2610 });
      expect(affiliates.cancelForCharge).toHaveBeenCalledWith({ chargeId: 'ch_1', paymentIntentId: 'pi_1' }, 'refund');
    });

    it('charge.refunded sem valor devolvido nao cancela nada', async () => {
      await deliver('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: 0 });
      expect(affiliates.cancelForCharge).not.toHaveBeenCalled();
    });

    it('charge.dispute.created cancela a comissao da charge disputada', async () => {
      await deliver('charge.dispute.created', { id: 'dp_1', charge: 'ch_9', payment_intent: { id: 'pi_9' } });
      expect(affiliates.cancelForCharge).toHaveBeenCalledWith({ chargeId: 'ch_9', paymentIntentId: 'pi_9' }, 'dispute');
    });
  });

  describe('recusa e abandono dentro do checkout (sem fatura)', () => {
    it('payment_intent.payment_failed registra a recusa com o motivo, sem mexer em assinatura', async () => {
      await expect(
        deliver('payment_intent.payment_failed', {
          id: 'pi_1',
          customer: 'cus_1',
          amount: 1885,
          currency: 'usd',
          last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
        }),
      ).resolves.toEqual({ received: true });

      expect(prisma.adminAudit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'funnel:payment_failed',
          targetUserId: 'usr_1',
          details: expect.objectContaining({ code: 'card_declined', declineCode: 'insufficient_funds', reason: 'checkout_attempt' }),
        }),
      });
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('checkout.session.expired registra o abandono no historico do usuario', async () => {
      await deliver('checkout.session.expired', { id: 'cs_exp', status: 'expired', client_reference_id: 'usr_1', metadata: {} });

      expect(prisma.adminAudit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'funnel:checkout_returned',
          targetUserId: 'usr_1',
          details: expect.objectContaining({ outcome: 'expired', session: 'cs_exp' }),
        }),
      });
    });

    it('checkout.session.expired tambem vai para o PostHog, com plano, origem e cupom', async () => {
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_exp',
        type: 'checkout.session.expired',
        created: 1790200000,
        data: {
          object: {
            id: 'cs_exp2',
            status: 'expired',
            client_reference_id: 'usr_1',
            amount_total: 2900,
            currency: 'usd',
            metadata: { priceId: STARTER_MONTHLY, coupon: 'EARLY35', checkoutSource: 'paywall' },
          },
        },
      });
      await service.handleWebhookEvent('sig', Buffer.from('{}'));

      expect(captureServer).toHaveBeenCalledWith(
        'clerk_1',
        'checkout_session_expired',
        expect.objectContaining({ sessionId: 'cs_exp2', priceId: STARTER_MONTHLY, coupon: 'EARLY35', source: 'paywall', value: 29, currency: 'USD' }),
        { dedupeKey: 'checkout_session_expired:cs_exp2', timestamp: new Date(1790200000 * 1000) },
      );
    });

    it('checkout.session.completed entregue DUAS vezes: a segunda nao faz nada', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'evt_dup' }]);
      await deliver('checkout.session.completed', {
        id: 'cs_1', mode: 'subscription', status: 'complete', payment_status: 'paid', subscription: 'sub_1',
        customer: 'cus_1', client_reference_id: 'usr_1', metadata: { userId: 'usr_1', clerkUserId: 'clerk_1' },
      }, 'evt_dup');
      const upsertsAfterFirst = prisma.subscription.upsert.mock.calls.length;

      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: 'processed' }]);
      const second = await deliver('checkout.session.completed', { id: 'cs_1' }, 'evt_dup');

      expect(second).toEqual({ received: true, duplicate: true });
      expect(prisma.subscription.upsert.mock.calls.length).toBe(upsertsAfterFirst);
      expect((captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'checkout_completed')).toHaveLength(1);
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
        expect.objectContaining({ dedupeKey: `payment_failed:in_2:1:${EVENT_CREATED}` }),
      );
    });

    it('o evento do PostHog leva o motivo da recusa (failureCode e declineCode) lido da Stripe', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));
      stripe.invoices = {
        retrieve: jest.fn().mockResolvedValue({
          payment_intent: { last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' } },
        }),
      };

      await deliver('invoice.payment_failed', {
        id: 'in_3',
        customer: 'cus_1',
        parent: { subscription_details: { subscription: 'sub_1', metadata: {} }, type: 'subscription_details' },
        amount_due: 2900,
        currency: 'usd',
        attempt_count: 2,
        billing_reason: 'subscription_cycle',
      });

      expect(captureServer).toHaveBeenCalledWith(
        'clerk_1',
        'payment_failed',
        expect.objectContaining({ invoiceId: 'in_3', failureCode: 'card_declined', declineCode: 'insufficient_funds' }),
        expect.objectContaining({ dedupeKey: `payment_failed:in_3:2:${EVENT_CREATED}` }),
      );
    });

    it('o evento leva plano, perfil do cartao, codigo da rede e a data do EVENTO de falha (nao a da fatura)', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));
      stripe.invoices = {
        retrieve: jest.fn().mockResolvedValue({
          payment_intent: {
            last_payment_error: {
              code: 'card_declined',
              decline_code: 'generic_decline',
              network_decline_code: '51',
              advice_code: 'try_again_later',
            },
            latest_charge: {
              created: EVENT_CREATED - 4,
              payment_method_details: { card: { country: 'BR', funding: 'credit', brand: 'visa', wallet: { type: 'apple_pay' } } },
            },
          },
        }),
      };

      await deliver('invoice.payment_failed', {
        id: 'in_4',
        customer: 'cus_1',
        created: 1789000000,
        parent: { subscription_details: { subscription: 'sub_1', metadata: {} }, type: 'subscription_details' },
        amount_due: 2900,
        currency: 'usd',
        attempt_count: 3,
        billing_reason: 'subscription_cycle',
      });

      expect(stripe.invoices.retrieve).toHaveBeenCalledWith('in_4', {
        expand: ['payment_intent', 'payment_intent.latest_charge'],
      });
      const call = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'payment_failed');
      expect(call[2]).toEqual(
        expect.objectContaining({
          priceId: STARTER_MONTHLY,
          declineCode: 'generic_decline',
          networkDeclineCode: '51',
          adviceCode: 'try_again_later',
          cardCountry: 'BR',
          cardFunding: 'credit',
          cardBrand: 'visa',
          cardWallet: 'apple_pay',
        }),
      );
      expect(call[3].timestamp).toEqual(new Date(EVENT_CREATED * 1000));
    });

    it('sem detalhes da Stripe o evento sai mesmo assim, com os campos nulos', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));
      stripe.invoices = { retrieve: jest.fn().mockRejectedValue(new Error('stripe fora do ar')) };

      await deliver('invoice.payment_failed', {
        id: 'in_5',
        customer: 'cus_1',
        parent: { subscription_details: { subscription: 'sub_1', metadata: {} }, type: 'subscription_details' },
        amount_due: 2900,
        currency: 'usd',
        attempt_count: 1,
        billing_reason: 'subscription_cycle',
      });

      const call = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'payment_failed');
      expect(call[2]).toEqual(expect.objectContaining({ declineCode: null, cardCountry: null, cardWallet: null }));
      expect(call[3].timestamp).toEqual(new Date(EVENT_CREATED * 1000));
    });

    it('webhook atrasado: cobranca mais nova que o evento e de OUTRA tentativa, entao motivo e cartao ficam nulos', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));
      stripe.invoices = {
        retrieve: jest.fn().mockResolvedValue({
          payment_intent: {
            last_payment_error: { code: 'card_declined', decline_code: 'do_not_honor' },
            latest_charge: {
              created: EVENT_CREATED + 3 * 86400, // retentativa 3 dias depois
              payment_method_details: { card: { country: 'BR', funding: 'credit', brand: 'visa', wallet: null } },
            },
          },
        }),
      };

      await deliver('invoice.payment_failed', {
        id: 'in_6',
        customer: 'cus_1',
        parent: { subscription_details: { subscription: 'sub_1', metadata: {} }, type: 'subscription_details' },
        amount_due: 2900,
        currency: 'usd',
        attempt_count: 1,
        billing_reason: 'subscription_cycle',
      });

      const call = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'payment_failed');
      expect(call[2]).toEqual(
        expect.objectContaining({ failureCode: null, declineCode: null, cardCountry: null, cardBrand: null }),
      );
      expect(call[3].timestamp).toEqual(new Date(EVENT_CREATED * 1000));
    });

    it('a data nao depende do relogio: processar de novo depois produz o MESMO uuid e o MESMO timestamp', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-21T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      try {
        stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));
        const failed = {
          id: 'in_7',
          customer: 'cus_1',
          parent: { subscription_details: { subscription: 'sub_1', metadata: {} }, type: 'subscription_details' },
          amount_due: 2900,
          currency: 'usd',
          attempt_count: 2,
          billing_reason: 'subscription_cycle',
        };

        await deliver('invoice.payment_failed', failed);
        jest.setSystemTime(new Date('2026-10-23T18:30:00Z'));
        await deliver('invoice.payment_failed', failed);

        const calls = (captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'payment_failed');
        expect(calls).toHaveLength(2);
        expect(calls[0][3]).toEqual(calls[1][3]);
        expect(calls[0][3]).toEqual({
          dedupeKey: `payment_failed:in_7:2:${EVENT_CREATED}`,
          timestamp: new Date(EVENT_CREATED * 1000),
        });
      } finally {
        jest.useRealTimers();
      }
    });

    describe('e-mail de pagamento recusado (Resend)', () => {
      const renewalFailed = (overrides: Record<string, unknown> = {}) => ({
        id: 'in_9',
        customer: 'cus_1',
        parent: { subscription_details: { subscription: 'sub_1', metadata: {} }, type: 'subscription_details' },
        amount_due: 2900,
        currency: 'usd',
        attempt_count: 1,
        billing_reason: 'subscription_cycle',
        next_payment_attempt: 1790259200,
        ...overrides,
      });
      let mail: { sendPaymentFailed: jest.Mock };

      beforeEach(() => {
        mail = { sendPaymentFailed: jest.fn().mockResolvedValue(true) };
        (service as any).mail = mail;
        stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));
        prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', clerkUserId: 'clerk_1', email: 'ana@example.com', name: 'Ana Souza' });
      });

      afterEach(() => {
        delete process.env.EMAIL_PAYMENT_FAILED;
      });

      it('chave desligada (padrao): so loga, nada sai', async () => {
        await deliver('invoice.payment_failed', renewalFailed());

        expect(mail.sendPaymentFailed).not.toHaveBeenCalled();
        expect(prisma.adminAudit.create).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ action: 'payment_failed_email:in_9' }) }),
        );
      });

      it('chave ligada: manda uma vez com valor e proxima tentativa, e grava a marca da fatura', async () => {
        process.env.EMAIL_PAYMENT_FAILED = 'true';

        await deliver('invoice.payment_failed', renewalFailed());

        expect(mail.sendPaymentFailed).toHaveBeenCalledWith('ana@example.com', 'Ana Souza', {
          amount: 29,
          currency: 'usd',
          nextAttempt: new Date(1790259200 * 1000),
        });
        expect(prisma.adminAudit.create).toHaveBeenCalledWith({
          data: { action: 'payment_failed_email:in_9', targetUserId: 'usr_1', details: { invoiceId: 'in_9' } },
        });
      });

      it('retentativa da Stripe ou reenvio do webhook da MESMA fatura nao manda de novo', async () => {
        process.env.EMAIL_PAYMENT_FAILED = 'true';
        prisma.adminAudit.findFirst.mockResolvedValue({ id: 'audit_1' });

        await deliver('invoice.payment_failed', renewalFailed({ attempt_count: 2 }), 'evt_retry');

        expect(prisma.adminAudit.findFirst).toHaveBeenCalledWith({
          where: { action: 'payment_failed_email:in_9', targetUserId: 'usr_1' },
          select: { id: true },
        });
        expect(mail.sendPaymentFailed).not.toHaveBeenCalled();
      });

      it('fora da renovacao, sem valor ou com a assinatura ja ativa: nao manda', async () => {
        process.env.EMAIL_PAYMENT_FAILED = 'true';

        await deliver('invoice.payment_failed', renewalFailed({ billing_reason: 'subscription_update' }), 'evt_a');
        await deliver('invoice.payment_failed', renewalFailed({ amount_due: 0 }), 'evt_b');
        stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'active' }));
        await deliver('invoice.payment_failed', renewalFailed(), 'evt_c');

        expect(mail.sendPaymentFailed).not.toHaveBeenCalled();
      });

      it('Resend recusou: nao grava a marca (o proximo evento tenta de novo) e o webhook segue', async () => {
        process.env.EMAIL_PAYMENT_FAILED = 'true';
        mail.sendPaymentFailed.mockResolvedValue(false);

        await expect(deliver('invoice.payment_failed', renewalFailed())).resolves.toEqual({ received: true });

        expect(prisma.adminAudit.create).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ action: 'payment_failed_email:in_9' }) }),
        );
      });
    });

    describe('chave de deduplicacao do payment_failed', () => {
      const failedInvoice = (attemptCount: number) => ({
        id: 'in_8',
        customer: 'cus_1',
        parent: { subscription_details: { subscription: 'sub_1', metadata: {} }, type: 'subscription_details' },
        amount_due: 2900,
        currency: 'usd',
        attempt_count: attemptCount,
        billing_reason: 'subscription_cycle',
      });
      const failedKeys = () =>
        (captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'payment_failed').map((c) => c[3].dedupeKey);

      beforeEach(() => {
        stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));
      });

      it('reentrega do MESMO evento gera a mesma chave', async () => {
        await deliver('invoice.payment_failed', failedInvoice(1), 'evt_f1', 1790000000);
        await deliver('invoice.payment_failed', failedInvoice(1), 'evt_f1', 1790000000);

        const keys = failedKeys();
        expect(keys).toHaveLength(2);
        expect(keys[0]).toBe(keys[1]);
        expect(keys[0]).toBe('payment_failed:in_8:1:1790000000');
      });

      it('duas falhas manuais da mesma fatura (mesmo attempt_count, event.created diferente) geram chaves diferentes', async () => {
        await deliver('invoice.payment_failed', failedInvoice(1), 'evt_f1', 1790000000);
        await deliver('invoice.payment_failed', failedInvoice(1), 'evt_f2', 1790003600); // 1h depois, mesmo dia

        const [first, second] = failedKeys();
        expect(first).not.toBe(second);
        expect(first).toBe('payment_failed:in_8:1:1790000000');
        expect(second).toBe('payment_failed:in_8:1:1790003600');
      });

      it('retentativas automaticas seguem distintas: attempt_count 1, 2 e 3 em dias diferentes', async () => {
        await deliver('invoice.payment_failed', failedInvoice(1), 'evt_a1', 1790000000);
        await deliver('invoice.payment_failed', failedInvoice(2), 'evt_a2', 1790000000 + 86400);
        await deliver('invoice.payment_failed', failedInvoice(3), 'evt_a3', 1790000000 + 3 * 86400);

        const keys = failedKeys();
        expect(new Set(keys).size).toBe(3);
        expect(keys).toEqual([
          'payment_failed:in_8:1:1790000000',
          `payment_failed:in_8:2:${1790000000 + 86400}`,
          `payment_failed:in_8:3:${1790000000 + 3 * 86400}`,
        ]);
      });

      it('o uuid que o PostHog recebe muda quando a chave muda (e e igual na reentrega)', async () => {
        const { uuidFromKey } = jest.requireActual('../../common/analytics/posthog');
        const a = uuidFromKey('payment_failed:in_8:1:1790000000');
        const b = uuidFromKey('payment_failed:in_8:1:1790003600');
        expect(a).not.toBe(b);
        expect(uuidFromKey('payment_failed:in_8:1:1790000000')).toBe(a);
      });
    });
  });

  describe('janela mensal fora do webhook (painel e analise)', () => {
    const SEPT_10 = new Date(Date.UTC(2026, 8, 10, 18, 27));
    const OCT_10 = new Date(Date.UTC(2026, 9, 10, 18, 27));

    // A janela mensal e calculada a partir de "agora": o relogio fica dentro do periodo 10/09 a 10/10.
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-09-20T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

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
      ).resolves.toBe(true);
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
  describe('portal v2 cycle allowances', () => {
    const start = Math.floor(Date.now() / 1000) - 3600;
    const end = start + 30 * 86400;
    const live = () => subscription({ current_period_start: start, current_period_end: end, latest_invoice: 'in_change' });
    const paid = () => ({ id: 'in_change', status: 'paid', billing_reason: 'subscription_update', lines: { data: [
      { proration: false, price: { id: STARTER_MONTHLY }, period: { start, end } },
    ] } });
    beforeEach(() => {
      process.env.STRIPE_PORTAL_V2_CONFIG_ID = 'bpc_v2';
      process.env.STRIPE_UPGRADE_ENABLED = 'true';
      process.env.STRIPE_UPGRADE_USER_IDS = 'usr_1';
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1' });
      prisma.subscription.findFirst = jest.fn().mockResolvedValue({ stripeId: 'sub_1' });
      stripe.subscriptions.retrieve.mockResolvedValue(live());
      stripe.invoices = { retrieve: jest.fn().mockResolvedValue(paid()) };
    });
    afterEach(() => { delete process.env.STRIPE_PORTAL_V2_CONFIG_ID; delete process.env.STRIPE_UPGRADE_ENABLED; delete process.env.STRIPE_UPGRADE_USER_IDS; });
    const apply = () => service['applyMonthlyAllowance']('usr_1', {
      stripeId: 'sub_1', priceId: STARTER_MONTHLY, periodStart: new Date(start * 1000),
    }, 'access_check');
    it('paid weekly to monthly resets to 200 with a distinct same-day key', async () => {
      await apply();
      expect(prisma.userTicks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { balance: 200 } }));
      expect(prisma.tickTransaction.create.mock.calls[0][0].data.stripePaymentIntentId)
        .toBe(`allowance-cycle:sub_1:${new Date(start * 1000).toISOString()}`);
    });
    it.each(['open', 'draft', 'uncollectible'])('does not provision for unpaid invoice %s', async status => {
      stripe.invoices.retrieve.mockResolvedValue({ ...paid(), status });
      await apply();
      expect(prisma.userTicks.upsert).not.toHaveBeenCalled();
    });
    it.each(['card_declined', 'requires_action'])('preserves existing access and balance while pending: %s', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue({ ...live(), pending_update: { expires_at: end } });
      await apply();
      expect(prisma.userTicks.upsert).not.toHaveBeenCalled();
      expect(await service.getUserSubscription('clerk_1')).toMatchObject({ plan: 'starter', status: 'active' });
    });
    it('does not treat a proration-only invoice as a new paid cycle', async () => {
      const invoice = paid(); invoice.lines.data[0].proration = true;
      stripe.invoices.retrieve.mockResolvedValue(invoice);
      await apply(); expect(prisma.userTicks.upsert).not.toHaveBeenCalled();
    });
    it('duplicate paid transition does not replenish spent ticks', async () => {
      prisma.tickTransaction.findUnique.mockResolvedValue({ id: 'already_applied' });
      await apply(); expect(prisma.userTicks.upsert).not.toHaveBeenCalled();
    });
    it('out-of-order stale snapshot cannot overwrite the current allowance', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ current_period_start: start, items: { data: [{ price: { id: 'price_legacy' } }] } }));
      await apply(); expect(prisma.userTicks.upsert).not.toHaveBeenCalled();
    });
    it('shows future phase without applying its weekly allowance', async () => {
      stripe.subscriptionSchedules = { retrieve: jest.fn().mockResolvedValue({ status: 'active', phases: [
        { start_date: end, items: [{ price: 'price_1UKeWPB1hl0IoocUjsQNv9BG' }] },
      ] }) };
      stripe.subscriptions.retrieve.mockResolvedValue({ ...live(), schedule: 'sub_sched_1' });
      const view = await service.getUserSubscription('clerk_1');
      expect(view).toMatchObject({ billingCycle: 'monthly', scheduledChange: { billingCycle: 'weekly', effectiveAt: end } });
      expect(prisma.userTicks.upsert).not.toHaveBeenCalled();
    });
    it('first weekly renewal after downgrade supplies 25, preserving the existing renewal key', async () => {
      const weekly = 'price_1UKeWPB1hl0IoocUjsQNv9BG';
      stripe.subscriptions.retrieve.mockResolvedValue({ ...live(), items: { data: [{ price: { id: weekly } }] } });
      stripe.invoices.retrieve.mockResolvedValue({ ...paid(), billing_reason: 'subscription_cycle' });
      await service['applyMonthlyAllowance']('usr_1', { stripeId: 'sub_1', priceId: weekly, periodStart: new Date(start * 1000) }, 'access_check');
      expect(prisma.userTicks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { balance: 25 } }));
      expect(prisma.tickTransaction.create.mock.calls[0][0].data.stripePaymentIntentId).toBe(`allowance:sub_1:${new Date(start * 1000).toISOString().slice(0, 10)}`);
    });
    it('opens only a verified v2 config with the pinned API and never provisions configs', async () => {
      process.env.APP_URL = 'https://tickrify.com';
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', stripeCustomerId: 'cus_1' });
      stripe.subscriptions.retrieve.mockResolvedValue({ ...live(), items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_1UKeWPB1hl0IoocUjsQNv9BG' } }] } });
      stripe.billingPortal = { configurations: { retrieve: jest.fn().mockResolvedValue({ ...portalV2Configuration('https://tickrify.com'), active: true, livemode: false }) },
        sessions: { create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/local' }) } };
      await service.createCustomerPortal('clerk_1', true);
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: 'cus_1', configuration: 'bpc_v2', return_url: 'https://tickrify.com/dashboard/settings', flow_data: { type: 'subscription_update_confirm', subscription_update_confirm: { subscription: 'sub_1', items: [{ id: 'si_1', price: STARTER_MONTHLY, quantity: 1 }] } } }, { apiVersion: PORTAL_V2_API_VERSION });
      expect(stripe.billingPortal.configurations.create).toBeUndefined();
    });
    it('fails closed for a misconfigured v2 instead of falling back to the default portal', async () => {
      process.env.APP_URL = 'https://tickrify.com';
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', stripeCustomerId: 'cus_1' });
      stripe.subscriptions.retrieve.mockResolvedValue({ ...live(), items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_1UKeWPB1hl0IoocUjsQNv9BG' } }] } });
      const config = portalV2Configuration('https://tickrify.com');
      config.features.subscription_update.products[0].prices.push('price_legacy');
      stripe.billingPortal = { configurations: { retrieve: jest.fn().mockResolvedValue({ ...config, active: true, livemode: false }) }, sessions: { create: jest.fn() } };
      await expect(service.createCustomerPortal('clerk_1', true)).rejects.toMatchObject({ status: 503 });
      expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    });
    it('rejects a direct upgrade request while the global gate is off', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', stripeCustomerId: 'cus_1' });
      delete process.env.STRIPE_UPGRADE_ENABLED;
      await expect(service.createCustomerPortal('clerk_1', true)).rejects.toMatchObject({ status: 403 });
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });
    it('rejects a direct downgrade request from an already-monthly subscriber', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', stripeCustomerId: 'cus_1' });
      await expect(service.createCustomerPortal('clerk_1', true)).rejects.toMatchObject({ status: 409 });
      expect(stripe.subscriptions.update).toBeUndefined();
    });
    it('does not replenish a paid transition again when portal entry is disabled', async () => {
      delete process.env.STRIPE_PORTAL_V2_CONFIG_ID;
      prisma.tickTransaction.findUnique.mockResolvedValue({ id: 'existing_paid_transition' });
      await apply(); expect(prisma.userTicks.upsert).not.toHaveBeenCalled();
    });

  });
});
