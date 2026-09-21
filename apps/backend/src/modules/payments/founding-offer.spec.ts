import { getFoundingOffer, offerFromCoupon, resetFoundingOfferCache } from './founding-offer';

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
