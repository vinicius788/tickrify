import { randomInt } from 'crypto';
import Stripe from 'stripe';

/**
 * Founding Member (27/10/2026): US$ 15/mes no MENSAL, 30 vagas, so por link
 * pessoal enviado por e-mail. Nao aparece em nenhuma pagina publica.
 *
 * Como funciona: UM cupom `forever` (percent_off, 30 usos no total) e UM
 * codigo promocional por pessoa (1 uso, validade curta, so quem nunca pagou).
 * O preco fica travado porque a assinatura continua no MESMO price de US$ 29 e
 * o desconto e percentual dele: preco de lista novo = price novo (a Stripe nao
 * edita valor de price), e quem ja assina nao muda de price sozinho.
 * Por isso: NUNCA migrar estas assinaturas para um price novo e nunca editar o
 * cupom, senao a promessa do e-mail deixa de ser verdade.
 *
 * Cada vaga e real: o contador mostrado vem de `times_redeemed` do cupom.
 */
export const FOUNDER_COUPON_ID = 'FOUNDER15';
export const FOUNDER_SEATS = 30;
export const FOUNDER_MONTHLY_USD = 15;
export const FOUNDER_CAMPAIGN = 'founder_2026_10';
export const FOUNDER_CODE_PATTERN = /^FND-[A-Z0-9]{8}$/;
// 29 x (1 - 0,4828) = 14,9988; a Stripe arredonda ao centavo: US$ 15,00.
const FOUNDER_PERCENT_OFF = 48.28;
// Sem I, O, 0 e 1: o codigo viaja em link, mas tambem pode ser lido por gente.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type FounderOffer = {
  active: boolean;
  priceUsd: number;
  seatsLeft: number | null;
  /** Segundos desde 1970 (formato da Stripe). */
  expiresAt: number | null;
};

export const FOUNDER_CLOSED: FounderOffer = {
  active: false,
  priceUsd: FOUNDER_MONTHLY_USD,
  seatsLeft: null,
  expiresAt: null,
};

/** Estado de UM codigo, como a Stripe o ve. Codigo inexistente, usado, expirado ou cupom esgotado: fechada. */
export function founderOfferFromPromotion(promo: Stripe.PromotionCode | null, now = Date.now()): FounderOffer {
  if (!promo) return FOUNDER_CLOSED;
  const coupon = promo.coupon;
  const seatsLeft =
    coupon.max_redemptions != null ? Math.max(coupon.max_redemptions - coupon.times_redeemed, 0) : null;
  const expired = promo.expires_at != null && promo.expires_at * 1000 <= now;
  const used = promo.max_redemptions != null && promo.times_redeemed >= promo.max_redemptions;
  const active =
    promo.active && coupon.id === FOUNDER_COUPON_ID && coupon.valid && !expired && !used && seatsLeft !== 0;
  return active
    ? { active: true, priceUsd: FOUNDER_MONTHLY_USD, seatsLeft, expiresAt: promo.expires_at }
    : FOUNDER_CLOSED;
}

/** Procura o codigo na Stripe. null = nao existe; erro de API sobe (quem chama decide). */
export async function findFounderPromotion(
  stripe: Pick<Stripe, 'promotionCodes'>,
  code: string,
): Promise<Stripe.PromotionCode | null> {
  if (!FOUNDER_CODE_PATTERN.test(code)) return null;
  const found = await stripe.promotionCodes.list({ code, limit: 1 });
  const promo = found.data[0];
  return promo && promo.code.toUpperCase() === code ? promo : null;
}

/** Cria o cupom das 30 vagas se ainda nao existir. */
export async function ensureFounderCoupon(stripe: Pick<Stripe, 'coupons'>): Promise<void> {
  try {
    await stripe.coupons.retrieve(FOUNDER_COUPON_ID);
    return;
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode !== 404) throw error;
  }
  await stripe.coupons.create({
    id: FOUNDER_COUPON_ID,
    name: 'Founding member',
    percent_off: FOUNDER_PERCENT_OFF,
    duration: 'forever',
    max_redemptions: FOUNDER_SEATS,
    metadata: { campaign: FOUNDER_CAMPAIGN },
  });
}

/** Um codigo pessoal: 1 uso, so para quem nunca pagou, vence em `expiresAt` (segundos). */
export async function createFounderPromotionCode(
  stripe: Pick<Stripe, 'promotionCodes'>,
  params: { userId: string; expiresAt: number },
): Promise<{ id: string; code: string }> {
  const suffix = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  const promo = await stripe.promotionCodes.create({
    coupon: FOUNDER_COUPON_ID,
    code: `FND-${suffix}`,
    max_redemptions: 1,
    expires_at: params.expiresAt,
    restrictions: { first_time_transaction: true },
    metadata: { campaign: FOUNDER_CAMPAIGN, userId: params.userId },
  });
  return { id: promo.id, code: promo.code };
}
