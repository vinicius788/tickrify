import { ValidationPipe } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { CreateCryptoCheckoutDto } from './dto/create-crypto-checkout.dto';
import { signIpn } from './nowpayments';
import * as nowpayments from './nowpayments';
import * as pass from './crypto-pass';

const SECRET = 'ipn-secret-test';

function makeService(record: Record<string, unknown> | null) {
  const prisma: any = {
    $executeRawUnsafe: jest.fn(async () => 0),
    cryptoPayment: {
      findUnique: jest.fn(async () => record),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({ id: 'ord_1' })),
    },
    subscription: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 0 })) },
    user: { findUnique: jest.fn(async () => ({ clerkUserId: 'user_clerk' })) },
    adminAudit: { create: jest.fn(async () => ({})) },
  };
  const service = new CryptoService(prisma);
  return { service, prisma };
}

const RECORD = { id: 'ord_1', userId: 'u1', pass: 'week', priceCents: 799, providerInvoiceId: '4522625843', status: 'created' };
const LIVE = {
  payment_id: 6249365965,
  invoice_id: 4522625843,
  payment_status: 'finished',
  price_amount: 7.99,
  price_currency: 'usd',
  pay_currency: 'usdttrc20',
  actually_paid: 8.01,
  order_id: 'ord_1',
  parent_payment_id: null,
};
const NOTICE = { payment_id: 6249365965, order_id: 'ord_1', payment_status: 'finished', price_amount: 7.99, price_currency: 'usd' };

describe('CryptoService', () => {
  let activate: jest.SpyInstance;
  let getPayment: jest.SpyInstance;

  beforeEach(async () => {
    process.env.NOWPAYMENTS_API_KEY = 'api-key-test';
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
    activate = jest.spyOn(pass, 'activateCryptoPass').mockResolvedValue({
      stripeId: 'crypto_ord_1',
      status: 'active',
      start: new Date(),
      end: new Date(Date.now() + 7 * 86400000),
      created: true,
    });
    getPayment = jest.spyOn(nowpayments, 'getPayment').mockResolvedValue({ ...LIVE });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NOWPAYMENTS_API_KEY;
    delete process.env.NOWPAYMENTS_IPN_SECRET;
  });

  async function ready(record: Record<string, unknown> | null = { ...RECORD }) {
    const made = makeService(record);
    await made.service.onModuleInit();
    return made;
  }

  it('sem as chaves, fica desligado e recusa tudo', async () => {
    delete process.env.NOWPAYMENTS_API_KEY;
    const { service } = await ready();
    expect(service.isEnabled()).toBe(false);
    await expect(service.handleIpn(NOTICE, signIpn(NOTICE, SECRET))).rejects.toMatchObject({ status: 503 });
    await expect(service.createCheckout('u1', 'week')).rejects.toMatchObject({ status: 503 });
  });

  it('aviso sem assinatura valida e recusado e nada muda', async () => {
    const { service, prisma } = await ready();
    await expect(service.handleIpn(NOTICE, signIpn(NOTICE, 'outro-segredo'))).rejects.toMatchObject({ status: 401 });
    expect(getPayment).not.toHaveBeenCalled();
    expect(prisma.cryptoPayment.update).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('pagamento completo, conferido na API: libera o passe uma vez', async () => {
    const { service, prisma } = await ready();
    await service.handleIpn(NOTICE, signIpn(NOTICE, SECRET));
    expect(getPayment).toHaveBeenCalledWith('6249365965');
    expect(activate).toHaveBeenCalledWith(prisma, { userId: 'u1', paymentId: 'ord_1', kind: 'week' });
    expect(prisma.cryptoPayment.update).toHaveBeenLastCalledWith({
      where: { id: 'ord_1' },
      data: expect.objectContaining({ subscriptionId: 'crypto_ord_1', paidAt: expect.any(Date) }),
    });
  });

  it('a decisao vem da releitura, nao do corpo do aviso', async () => {
    const { service } = await ready();
    getPayment.mockResolvedValue({ ...LIVE, payment_status: 'waiting' });
    await service.handleIpn(NOTICE, signIpn(NOTICE, SECRET));
    expect(activate).not.toHaveBeenCalled();
  });

  it.each([
    ['valor menor', { price_amount: 1 }],
    ['outra moeda', { price_currency: 'eur' }],
    ['outro pedido', { order_id: 'ord_2' }],
    ['outra invoice', { invoice_id: 999 }],
    ['deposito repetido', { parent_payment_id: 123 }],
  ])('nao libera com %s', async (_label, change) => {
    const { service, prisma } = await ready();
    getPayment.mockResolvedValue({ ...LIVE, ...change });
    await service.handleIpn(NOTICE, signIpn(NOTICE, SECRET));
    expect(activate).not.toHaveBeenCalled();
    expect(prisma.cryptoPayment.update).not.toHaveBeenCalled();
  });

  it('pago a menos: marca parcial e nao libera', async () => {
    const { service, prisma } = await ready();
    getPayment.mockResolvedValue({ ...LIVE, payment_status: 'partially_paid', actually_paid: 5 });
    await service.handleIpn(NOTICE, signIpn(NOTICE, SECRET));
    expect(activate).not.toHaveBeenCalled();
    expect(prisma.cryptoPayment.update).toHaveBeenCalledWith({
      where: { id: 'ord_1' },
      data: expect.objectContaining({ status: 'partially_paid', actuallyPaid: '5' }),
    });
  });

  it('pedido desconhecido responde 2xx sem consultar nem liberar', async () => {
    const { service } = await ready(null);
    await expect(service.handleIpn(NOTICE, signIpn(NOTICE, SECRET))).resolves.toEqual({ received: true });
    expect(getPayment).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('quem tem assinatura de cartao ativa nao compra passe', async () => {
    const { service, prisma } = await ready();
    prisma.subscription.findFirst.mockResolvedValue({ status: 'active' });
    await expect(service.createCheckout('u1', 'month')).rejects.toMatchObject({ status: 409 });
    expect(prisma.cryptoPayment.create).not.toHaveBeenCalled();
  });

  it('abre a invoice com preco do servidor e as voltas para o painel', async () => {
    process.env.APP_URL = 'https://tickrify.com';
    const { service, prisma } = await ready();
    const createInvoice = jest
      .spyOn(nowpayments, 'createInvoice')
      .mockResolvedValue({ id: 'inv_9', invoice_url: 'https://nowpayments.io/payment/?iid=inv_9' });
    const out = await service.createCheckout('u1', 'month');
    expect(out.url).toBe('https://nowpayments.io/payment/?iid=inv_9');
    expect(createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        priceUsd: 29,
        orderId: 'ord_1',
        successUrl: 'https://tickrify.com/dashboard?crypto=success&order=ord_1',
        cancelUrl: 'https://tickrify.com/dashboard/plans?crypto=canceled',
        ipnCallbackUrl: expect.stringMatching(/\/api\/crypto\/webhook$/),
      }),
    );
    expect(prisma.cryptoPayment.update).toHaveBeenCalledWith({ where: { id: 'ord_1' }, data: { providerInvoiceId: 'inv_9' } });
    delete process.env.APP_URL;
  });

  it('status do pagamento so da propria conta', async () => {
    const { service, prisma } = await ready();
    prisma.cryptoPayment.findFirst = jest.fn(async ({ where }: any) =>
      where.userId === 'u1' ? { status: 'finished', subscriptionId: 'crypto_ord_1' } : null,
    );
    await expect(service.getPaymentStatus('u1', 'ord_1')).resolves.toEqual({ status: 'finished', active: true });
    await expect(service.getPaymentStatus('u2', 'ord_1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('CreateCryptoCheckoutDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const META = { type: 'body' as const, metatype: CreateCryptoCheckoutDto };

  it('aceita so o tipo do passe; preco nunca vem do corpo', async () => {
    await expect(pipe.transform({ pass: 'week' }, META)).resolves.toBeDefined();
    await expect(pipe.transform({ pass: 'month' }, META)).resolves.toBeDefined();
    await expect(pipe.transform({ pass: 'year' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({}, META)).rejects.toBeDefined();
    await expect(pipe.transform({ pass: 'week', priceCents: 1 }, META)).rejects.toBeDefined();
  });
});
