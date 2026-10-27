import { ValidationPipe } from '@nestjs/common';
import {
  FOUNDER_CODE_PATTERN,
  createFounderPromotionCode,
  ensureFounderCoupon,
  findFounderPromotion,
  founderOfferFromPromotion,
  getFoundingOffer,
  offerFromCoupon,
  resetFoundingOfferCache,
} from './founding-offer';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

const coupon = (over: Record<string, unknown> = {}) =>
  ({ id: 'EARLY35', valid: true, percent_off: 35, max_redemptions: 50, times_redeemed: 5, redeem_by: null, ...over }) as any;

describe('oferta EARLY35', () => {
  beforeEach(() => resetFoundingOfferCache());

  it('ativa enquanto tem usos', () => {
    expect(offerFromCoupon(coupon())).toEqual({ active: true, code: 'EARLY35', percentOff: 35 });
  });

  it('esgotada, expirada, invalida ou apagada: desligada', () => {
    expect(offerFromCoupon(coupon({ times_redeemed: 50 })).active).toBe(false);
    expect(offerFromCoupon(coupon({ redeem_by: Math.floor(Date.now() / 1000) - 60 })).active).toBe(false);
    expect(offerFromCoupon(coupon({ valid: false })).active).toBe(false);
    expect(offerFromCoupon({ id: 'EARLY35', deleted: true } as any).active).toBe(false);
  });

  it('guarda a resposta por 10 minutos', async () => {
    const retrieve = jest.fn().mockResolvedValue(coupon());
    const stripe = { coupons: { retrieve } } as any;
    await getFoundingOffer(stripe, 0);
    await getFoundingOffer(stripe, 9 * 60_000);
    expect(retrieve).toHaveBeenCalledTimes(1);
    await getFoundingOffer(stripe, 11 * 60_000);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it('cupom apagado (404) desliga; erro de rede sem historico tambem', async () => {
    const naoExiste = { coupons: { retrieve: jest.fn().mockRejectedValue({ statusCode: 404 }) } } as any;
    expect((await getFoundingOffer(naoExiste, 0)).active).toBe(false);

    resetFoundingOfferCache();
    const semRede = { coupons: { retrieve: jest.fn().mockRejectedValue(new Error('ECONNRESET')) } } as any;
    expect((await getFoundingOffer(semRede, 0)).active).toBe(false);
  });

  it('erro de rede com historico: mantem o ultimo valor bom', async () => {
    const retrieve = jest.fn().mockResolvedValueOnce(coupon()).mockRejectedValueOnce(new Error('timeout'));
    const stripe = { coupons: { retrieve } } as any;
    await getFoundingOffer(stripe, 0);
    expect((await getFoundingOffer(stripe, 11 * 60_000)).active).toBe(true);
  });

  it('sem Stripe configurada: desligada', async () => {
    expect((await getFoundingOffer(null)).active).toBe(false);
  });
});

describe('oferta Founding Member (link pessoal)', () => {
  const promo = (over: Record<string, unknown> = {}, coupon: Record<string, unknown> = {}) =>
    ({
      id: 'promo_f1',
      code: 'FND-ABCD2345',
      active: true,
      max_redemptions: 1,
      times_redeemed: 0,
      expires_at: Math.floor(Date.now() / 1000) + 86_400,
      coupon: { id: 'FOUNDER15', valid: true, max_redemptions: 30, times_redeemed: 3, ...coupon },
      ...over,
    }) as any;

  it('ativa mostra preco, vagas restantes e validade', () => {
    const p = promo();
    expect(founderOfferFromPromotion(p)).toEqual({
      active: true,
      priceUsd: 15,
      seatsLeft: 27,
      expiresAt: p.expires_at,
    });
  });

  it('fechada: sem codigo, ja usado, expirado, desativado, cupom errado ou 30 vagas gastas', () => {
    expect(founderOfferFromPromotion(null).active).toBe(false);
    expect(founderOfferFromPromotion(promo({ times_redeemed: 1 })).active).toBe(false);
    expect(founderOfferFromPromotion(promo({ expires_at: Math.floor(Date.now() / 1000) - 5 })).active).toBe(false);
    expect(founderOfferFromPromotion(promo({ active: false })).active).toBe(false);
    expect(founderOfferFromPromotion(promo({}, { id: 'EARLY35' })).active).toBe(false);
    expect(founderOfferFromPromotion(promo({}, { valid: false })).active).toBe(false);
    expect(founderOfferFromPromotion(promo({}, { times_redeemed: 30 })).active).toBe(false);
  });

  it('o codigo so e procurado na Stripe se tiver o formato FND-XXXXXXXX, e a resposta tem que ser o mesmo codigo', async () => {
    const list = jest.fn().mockResolvedValue({ data: [promo()] });
    const stripe = { promotionCodes: { list } } as any;
    expect(await findFounderPromotion(stripe, 'EARLY35')).toBeNull();
    expect(await findFounderPromotion(stripe, 'fnd-abcd2345')).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect((await findFounderPromotion(stripe, 'FND-ABCD2345'))?.id).toBe('promo_f1');
    expect(await findFounderPromotion(stripe, 'FND-ZZZZ9999')).toBeNull();
  });

  it('cria o cupom das vagas so quando ele nao existe (404); outro erro sobe', async () => {
    const create = jest.fn().mockResolvedValue({});
    await ensureFounderCoupon({ coupons: { retrieve: jest.fn().mockResolvedValue({}), create } } as any);
    expect(create).not.toHaveBeenCalled();

    await ensureFounderCoupon({ coupons: { retrieve: jest.fn().mockRejectedValue({ statusCode: 404 }), create } } as any);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'FOUNDER15', percent_off: 48.28, duration: 'forever', max_redemptions: 30 }),
    );

    await expect(
      ensureFounderCoupon({ coupons: { retrieve: jest.fn().mockRejectedValue(new Error('ECONNRESET')), create } } as any),
    ).rejects.toThrow('ECONNRESET');
  });

  it('US$ 29 com o desconto do cupom fica em US$ 15,00 depois do arredondamento da Stripe', () => {
    expect(Math.round(2900 * 0.4828)).toBe(1400);
    expect(2900 - Math.round(2900 * 0.4828)).toBe(1500);
  });

  it('codigo pessoal: formato valido, 1 uso, so para quem nunca pagou, dono na metadata', async () => {
    const create = jest.fn().mockImplementation(async (params: any) => ({ id: 'promo_new', code: params.code }));
    const out = await createFounderPromotionCode({ promotionCodes: { create } } as any, { userId: 'usr_1', expiresAt: 1_800_000_000 });
    expect(out.code).toMatch(FOUNDER_CODE_PATTERN);
    expect(out.id).toBe('promo_new');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        coupon: 'FOUNDER15',
        max_redemptions: 1,
        expires_at: 1_800_000_000,
        restrictions: { first_time_transaction: true },
        metadata: { campaign: 'founder_2026_10', userId: 'usr_1' },
      }),
    );
  });

  it('dois codigos seguidos nao saem iguais', async () => {
    const create = jest.fn().mockImplementation(async (params: any) => ({ id: 'p', code: params.code }));
    const stripe = { promotionCodes: { create } } as any;
    const codes = new Set<string>();
    for (let i = 0; i < 50; i += 1) codes.add((await createFounderPromotionCode(stripe, { userId: 'u', expiresAt: 1 })).code);
    expect(codes.size).toBe(50);
  });
});

describe('DTO do checkout aceita so o formato do codigo fundador', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const META = { type: 'body' as const, metatype: CreateCheckoutSessionDto };

  it('offerCode opcional e com formato fixo', async () => {
    await expect(pipe.transform({ billingCycle: 'monthly' }, META)).resolves.toBeDefined();
    await expect(pipe.transform({ billingCycle: 'monthly', offerCode: 'FND-ABCD2345' }, META)).resolves.toBeDefined();
    await expect(pipe.transform({ offerCode: 'fnd-abcd2345' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ offerCode: 'EARLY35' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ offerCode: 'FND-ABCD234' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ offerCode: 'FND-ABCD2345; DROP' }, META)).rejects.toBeDefined();
  });
});
