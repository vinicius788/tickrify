import { ValidationPipe } from '@nestjs/common';
import {
  FOUNDER_CODE_PATTERN,
  createFounderPromotionCode,
  ensureFounderCoupon,
  findFounderPromotion,
  founderOfferFromPromotion,
} from './founding-offer';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

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

  it('cupom EARLY35 nao existe mais no checkout (23/11/2026)', async () => {
    await expect(pipe.transform({ billingCycle: 'monthly', coupon: 'EARLY35' }, META)).rejects.toBeDefined();
  });
});
