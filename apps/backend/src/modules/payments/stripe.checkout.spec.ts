import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { allowanceWindowStart, monthlyTicksForPriceId } from '../../config/stripe.config';

const PRICE = 'price_1TRvEJB1hl0IoocUvbCyxkt5'; // starter mensal USD

describe('StripeService.createCheckoutSession', () => {
  let service: StripeService;
  let prisma: any;
  let stripe: any;
  const originalEnv = { ...process.env };

  const user = {
    id: 'usr_1',
    clerkUserId: 'clerk_1',
    email: 'a@b.com',
    stripeCustomerId: null as string | null,
    firstTouchAttribution: null,
    lastTouchAttribution: null,
  };

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.APP_URL = 'https://tickrify.com';
    process.env.NODE_ENV = 'test';

    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ ...user }), update: jest.fn() },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    service = new StripeService(prisma);

    stripe = {
      prices: {
        retrieve: jest.fn().mockResolvedValue({
          id: PRICE, active: true, type: 'recurring', currency: 'usd', livemode: false,
        }),
      },
      customers: {
        create: jest.fn().mockResolvedValue({ id: 'cus_new' }),
        retrieve: jest.fn(),
        update: jest.fn(),
      },
      subscriptions: { list: jest.fn().mockResolvedValue({ data: [] }) },
      checkout: {
        sessions: {
          list: jest.fn().mockResolvedValue({ data: [] }),
          expire: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue({ id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' }),
        },
      },
    };
    (service as any).stripe = stripe;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('cria a sessao com o price, as URLs de retorno e o cupom certos', async () => {
    const result = await service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd', 'EARLY35');

    expect(result).toEqual({ sessionId: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new', reused: false });
    const params = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.mode).toBe('subscription');
    expect(params.line_items).toEqual([{ price: PRICE, quantity: 1 }]);
    expect(params.success_url).toBe('https://tickrify.com/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}');
    expect(params.cancel_url).toBe('https://tickrify.com/pricing?canceled=true');
    expect(params.discounts).toEqual([{ coupon: 'EARLY35' }]);
    expect(params.metadata).toMatchObject({ priceId: PRICE, coupon: 'EARLY35', userId: 'usr_1' });
  });

  it('pedidos simultaneos do mesmo usuario criam UMA sessao e UM customer', async () => {
    const [a, b] = await Promise.all([
      service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd', 'EARLY35'),
      service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd', 'EARLY35'),
    ]);

    expect(a).toEqual(b);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
  });

  it('customer novo sai com chave de idempotencia e e gravado no usuario', async () => {
    await service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd');

    expect(stripe.customers.create.mock.calls[0][1]).toEqual({ idempotencyKey: 'customer-create:usr_1:none' });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'usr_1' }, data: { stripeCustomerId: 'cus_new' } });
  });

  it('reaproveita o customer existente em vez de criar outro', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...user, stripeCustomerId: 'cus_old' });
    stripe.customers.retrieve.mockResolvedValue({ id: 'cus_old', email: 'a@b.com' });

    await service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd');

    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_old');
  });

  it('recusa quem ja tem assinatura ativa no banco, sem tocar na Stripe', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ status: 'active' });

    await expect(service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd')).rejects.toBeInstanceOf(ConflictException);
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('recusa quem ja tem assinatura na Stripe que o webhook ainda nao gravou', async () => {
    stripe.subscriptions.list.mockResolvedValue({ data: [{ status: 'active', currency: 'usd' }] });

    await expect(service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd')).rejects.toBeInstanceOf(ConflictException);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('reaproveita a sessao aberta equivalente e expira as outras', async () => {
    const now = Math.floor(Date.now() / 1000);
    stripe.checkout.sessions.list.mockResolvedValue({
      data: [
        { id: 'cs_same', mode: 'subscription', url: 'https://checkout.stripe.com/c/pay/cs_same', expires_at: now + 3600, metadata: { priceId: PRICE, coupon: 'EARLY35' } },
        { id: 'cs_old', mode: 'subscription', url: 'https://checkout.stripe.com/c/pay/cs_old', expires_at: now + 3600, metadata: {} },
      ],
    });

    const result = await service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd', 'EARLY35');

    expect(result).toEqual({ sessionId: 'cs_same', url: 'https://checkout.stripe.com/c/pay/cs_same', reused: true });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_old');
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('nao reaproveita sessao prestes a expirar: expira e cria outra', async () => {
    const now = Math.floor(Date.now() / 1000);
    stripe.checkout.sessions.list.mockResolvedValue({
      data: [{ id: 'cs_late', mode: 'subscription', url: 'https://x', expires_at: now + 60, metadata: { priceId: PRICE, coupon: '' } }],
    });

    await service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd');

    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_late');
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('bloqueia chave de teste em producao', async () => {
    process.env.NODE_ENV = 'production';

    await expect(service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('bloqueia price inativo ou de outro modo', async () => {
    stripe.prices.retrieve.mockResolvedValue({ id: PRICE, active: false, type: 'recurring', currency: 'usd', livemode: true });

    await expect(service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('falha alto se a Stripe devolver sessao sem url', async () => {
    stripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_nourl', url: null });

    await expect(service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd')).rejects.toMatchObject({
      response: { code: 'checkout_url_missing' },
    });
  });

  it('cupom recusado reabre o checkout sem desconto e marca a sessao sem cupom', async () => {
    stripe.checkout.sessions.create
      .mockRejectedValueOnce(new Error('No such coupon: EARLY35'))
      .mockResolvedValueOnce({ id: 'cs_full', url: 'https://checkout.stripe.com/c/pay/cs_full' });

    const result = await service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd', 'EARLY35');

    expect(result.sessionId).toBe('cs_full');
    const second = stripe.checkout.sessions.create.mock.calls[1][0];
    expect(second.discounts).toBeUndefined();
    expect(second.allow_promotion_codes).toBe(true);
    expect(second.metadata.coupon).toBe('');
  });

  it('com aceite de cookies: grava o contexto do Meta na sessao; sem aceite, nada', async () => {
    await service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd', undefined, 'pricing', {
      consent: true,
      fbp: 'fb.1.1789000000000.123456789',
      fbc: 'fb.1.1789000000000.IwAR0abcdefgh',
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
    });
    expect(stripe.checkout.sessions.create.mock.calls[0][0].metadata).toMatchObject({
      ads_consent: '1',
      ads_fbp: 'fb.1.1789000000000.123456789',
      ads_ip: '203.0.113.9',
    });

    stripe.checkout.sessions.create.mockClear();
    stripe.checkout.sessions.list.mockResolvedValue({ data: [] });
    (service as any).checkoutInFlight.clear();
    await service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd', undefined, 'pricing', { consent: false });
    const meta = stripe.checkout.sessions.create.mock.calls[0][0].metadata;
    expect(meta.ads_consent).toBeUndefined();
    expect(meta.ads_ip).toBeUndefined();
  });

  describe('getCheckoutStatus (retorno da Stripe)', () => {
    beforeEach(() => {
      stripe.checkout.sessions.retrieve = jest.fn();
      prisma.adminAudit = { create: jest.fn().mockResolvedValue({}) };
    });

    it('sessao paga da propria pessoa: confirma com valor real', async () => {
      stripe.checkout.sessions.retrieve.mockResolvedValue({
        id: 'cs_live_x', client_reference_id: 'usr_1', payment_status: 'paid', status: 'complete', amount_total: 1885, currency: 'usd',
      });
      await expect(service.getCheckoutStatus('clerk_1', 'cs_live_x', 'success')).resolves.toEqual({
        sessionId: 'cs_live_x', paid: true, value: 18.85, currency: 'USD',
      });
    });

    it('sessao de OUTRA pessoa nunca e confirmada (nao dispara Purchase)', async () => {
      stripe.checkout.sessions.retrieve.mockResolvedValue({
        id: 'cs_live_x', client_reference_id: 'usr_OUTRO', metadata: { userId: 'usr_OUTRO' }, payment_status: 'paid', amount_total: 1885,
      });
      await expect(service.getCheckoutStatus('clerk_1', 'cs_live_x', 'success')).resolves.toMatchObject({ paid: false, value: null });
    });

    it('sessao nao paga (ex.: pagamento pendente) nao confirma', async () => {
      stripe.checkout.sessions.retrieve.mockResolvedValue({
        id: 'cs_live_x', client_reference_id: 'usr_1', payment_status: 'unpaid', status: 'complete', amount_total: 1885,
      });
      await expect(service.getCheckoutStatus('clerk_1', 'cs_live_x', 'success')).resolves.toMatchObject({ paid: false });
    });

    it('volta pelo cancelamento: so registra', async () => {
      await expect(service.getCheckoutStatus('clerk_1', null, 'canceled')).resolves.toMatchObject({ paid: false });
      expect(prisma.adminAudit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'funnel:checkout_returned', targetUserId: 'usr_1' }),
      });
    });
  });

  it('falha da Stripe ao listar assinaturas vira 503, nunca checkout as cegas', async () => {
    stripe.subscriptions.list.mockRejectedValue(Object.assign(new Error('down'), { type: 'StripeConnectionError' }));

    await expect(service.createCheckoutSession('clerk_1', 'starter', 'monthly', 'usd')).rejects.toMatchObject({
      response: { code: 'stripe_unavailable' },
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('allowanceWindowStart', () => {
  it('mensal: a janela e o proprio periodo', () => {
    const start = new Date(Date.UTC(2026, 8, 10));
    expect(allowanceWindowStart(start, new Date(Date.UTC(2026, 9, 1)))).toEqual(start);
  });

  it('anual: 200 por mes, janela avanca mes a mes a partir do inicio', () => {
    const start = new Date(Date.UTC(2026, 0, 31));
    expect(allowanceWindowStart(start, new Date(Date.UTC(2026, 2, 5)))).toEqual(new Date(Date.UTC(2026, 1, 28)));
    expect(allowanceWindowStart(start, new Date(Date.UTC(2026, 3, 1)))).toEqual(new Date(Date.UTC(2026, 2, 31)));
  });

  it('sem periodo (acesso manual): mes-calendario', () => {
    expect(allowanceWindowStart(null, new Date(Date.UTC(2026, 8, 21, 15)))).toEqual(new Date(Date.UTC(2026, 8, 1)));
  });

  it('o anual recebe o pacote MENSAL, nao 12x', () => {
    expect(monthlyTicksForPriceId('price_1TRvKHB1hl0IoocU3N7MMGcG')).toBe(200); // starter anual
    expect(monthlyTicksForPriceId('price_1TRvEJB1hl0IoocUvbCyxkt5')).toBe(200); // starter mensal
    expect(monthlyTicksForPriceId('price_desconhecido')).toBe(0);
  });
});
