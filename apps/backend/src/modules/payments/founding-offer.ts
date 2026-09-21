/**
 * Oferta Founding Trader (cupom EARLY35, 35% no 1o mes, limitado na Stripe).
 *
 * A vitrine (/pricing, paywall, faixa da home) e o e-mail de recuperacao
 * prometiam o desconto sem saber se o cupom ainda existia. Quando os usos
 * acabassem, a pessoa leria "35% aplicado" e pagaria o preco cheio. Esta e a
 * fonte unica: pergunta a Stripe e todo mundo segue a resposta.
 *
 * Arquivo proprio porque e usado pelo StripeService (checkout e rota publica) e
 * pelo worker da fila (e-mail de recuperacao), que roda fora do Nest.
 *
 * Cache de 10 min: a vitrine chama isto a cada visita e a Stripe nao precisa
 * ver cada uma. Falha ao consultar = oferta desligada (com o ultimo valor bom
 * como reserva): esconder um desconto que existe custa pouco; anunciar um que
 * nao existe e cobrar cheio e o erro que isto evita.
 */
import Stripe from 'stripe';

export const FOUNDING_COUPON_ID = 'EARLY35';
const CACHE_MS = 10 * 60 * 1000;

export type FoundingOffer = {
  active: boolean;
  code: string;
  percentOff: number | null;
};

type CouponReader = Pick<Stripe, 'coupons'>;

let cache: { value: FoundingOffer; at: number } | null = null;

export function offerFromCoupon(coupon: Stripe.Coupon | Stripe.DeletedCoupon | null): FoundingOffer {
  const off: FoundingOffer = { active: false, code: FOUNDING_COUPON_ID, percentOff: null };
  if (!coupon || ('deleted' in coupon && coupon.deleted)) return off;
  const c = coupon as Stripe.Coupon;
  const esgotado = c.max_redemptions != null && c.times_redeemed >= c.max_redemptions;
  const expirado = c.redeem_by != null && c.redeem_by * 1000 <= Date.now();
  return {
    active: Boolean(c.valid) && !esgotado && !expirado,
    code: FOUNDING_COUPON_ID,
    percentOff: c.percent_off ?? null,
  };
}

export async function getFoundingOffer(stripe: CouponReader | null, now = Date.now()): Promise<FoundingOffer> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  if (!stripe) return { active: false, code: FOUNDING_COUPON_ID, percentOff: null };
  try {
    const value = offerFromCoupon(await stripe.coupons.retrieve(FOUNDING_COUPON_ID));
    cache = { value, at: now };
    return value;
  } catch (error) {
    // Cupom apagado responde 404: e resposta, nao falha, e desliga a oferta.
    if ((error as { statusCode?: number })?.statusCode === 404) {
      const value = offerFromCoupon(null);
      cache = { value, at: now };
      return value;
    }
    return cache?.value ?? offerFromCoupon(null);
  }
}

/** So para teste. */
export function resetFoundingOfferCache(): void {
  cache = null;
}
