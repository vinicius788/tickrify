// Stripe billing configuration — plans, prices, and helpers

export type PlanType = 'starter' | 'pro' | 'elite';
export type BillingCycle = 'monthly' | 'yearly' | 'weekly';
/** Ciclos que existem para todos os planos. O semanal e so do starter em USD. */
type PlanCycle = 'monthly' | 'yearly';
export type Currency = 'brl' | 'usd' | 'eur';

// Monthly ticks per plan. Yearly invoices fire once, so we credit 12× upfront.
//
// PLANO ÚNICO: a vitrine vende a chave `starter` por US$29/mês ou US$290/ano,
// com 200 ticks mensais. O Stripe manteve os mesmos price IDs quando o valor
// mudou; por isso o código não deve inferir preço pelo comentário ou pelo ID.
//
// `pro` e `elite` continuam aqui de propósito: são LEGADO. Não aparecem mais na
// vitrine, mas assinaturas antigas ainda resolvem por estes price IDs e
// precisam continuar creditando os ticks certos. Não apagar.
export const PLAN_TICKS_PER_MONTH: Record<PlanType, number> = {
  starter: 200,
  pro: 150,
  elite: 400,
};

// All Stripe price IDs — one per plan × interval × currency
export const PRICES: Record<PlanType, Record<PlanCycle, Record<Currency, string>>> = {
  starter: {
    monthly: {
      brl: 'price_1TRv2fB1hl0IoocUolv3jJkh',
      usd: 'price_1TRvEJB1hl0IoocUvbCyxkt5',
      eur: 'price_1TRvG0B1hl0IoocUKA6heI68',
    },
    yearly: {
      brl: 'price_1TRvHnB1hl0IoocUq8N8ovfv',
      usd: 'price_1TRvKHB1hl0IoocU3N7MMGcG',
      eur: 'price_1TRvM8B1hl0IoocUwcyW6U7d',
    },
  },
  pro: {
    monthly: {
      brl: 'price_1TRv5zB1hl0IoocU2Yj9jifa',
      usd: 'price_1TRvEsB1hl0IoocUfoDgdHkD',
      eur: 'price_1TRvGQB1hl0IoocUW7feV7IY',
    },
    yearly: {
      brl: 'price_1TRvIFB1hl0IoocUxl5udssL',
      usd: 'price_1TRvKvB1hl0IoocUeyKzAxFn',
      eur: 'price_1TRvMeB1hl0IoocU2UpTYf9w',
    },
  },
  elite: {
    monthly: {
      brl: 'price_1TRv6yB1hl0IoocU77HZPR1a',
      usd: 'price_1TRvFCB1hl0IoocU2NlE5m2I',
      eur: 'price_1TRvGoB1hl0IoocUk1ojbWdf',
    },
    yearly: {
      brl: 'price_1TRvIeB1hl0IoocUWcspSfuo',
      usd: 'price_1TRvLbB1hl0IoocU8iMAMuwl',
      eur: 'price_1TRvN7B1hl0IoocUu20gafjg',
    },
  },
};

/**
 * Plano SEMANAL (28/09/2026): US$ 7,99 por semana, saldo de 25 ticks a cada
 * semana (mesma regra do mensal: volta para o teto, nao acumula). Mesmo produto
 * e mesmos recursos do starter; muda so o ciclo e o tamanho do pacote. Existe
 * para baixar a entrada de quem nao consegue pagar US$ 29 de uma vez. So USD
 * (a moeda e fixa no servidor) e sem o cupom EARLY35, que e do primeiro MES.
 */
export const WEEKLY_PRICE_ID = 'price_1UKeWPB1hl0IoocUjsQNv9BG';
export const WEEKLY_TICKS = 25;

export function isWeeklyPriceId(priceId: string | null | undefined): boolean {
  return priceId === WEEKLY_PRICE_ID;
}

/** String vazia = combinacao sem preco (o checkout responde price_not_configured). */
export function getPriceId(plan: PlanType, interval: BillingCycle, currency: Currency): string {
  if (interval === 'weekly') return plan === 'starter' && currency === 'usd' ? WEEKLY_PRICE_ID : '';
  return PRICES[plan][interval][currency];
}

// Reverse-lookup: priceId → plan name (or null if not found)
export function resolvePlanForPriceId(priceId: string): PlanType | null {
  if (!priceId) return null;
  if (isWeeklyPriceId(priceId)) return 'starter';

  for (const [planKey, intervals] of Object.entries(PRICES) as [PlanType, typeof PRICES[PlanType]][]) {
    for (const currencies of Object.values(intervals)) {
      if (Object.values(currencies).includes(priceId)) {
        return planKey;
      }
    }
  }

  return null;
}

/** Ciclo de cobranca de um preco nosso, ou null (acesso manual, preco desconhecido). */
export function billingCycleForPriceId(priceId: string | null | undefined): BillingCycle | null {
  if (!priceId) return null;
  if (isWeeklyPriceId(priceId)) return 'weekly';
  for (const intervals of Object.values(PRICES)) {
    for (const [cycle, currencies] of Object.entries(intervals) as [PlanCycle, Record<Currency, string>][]) {
      if (Object.values(currencies).includes(priceId)) return cycle;
    }
  }
  return null;
}

export function getStripeConfig() {
  return {
    secretKey: String(process.env.STRIPE_SECRET_KEY || '').trim(),
    publishableKey: String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim(),
    webhookSecret: String(process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
  };
}

export type StripeKeyMode = 'live' | 'test' | 'unknown';

/**
 * Modo da chave secreta, lido do prefixo (`sk_live_`/`rk_live_` vs
 * `sk_test_`/`rk_test_`). A Stripe nao expoe isso de outro jeito sem uma
 * chamada de rede, e o prefixo e contrato estavel da propria Stripe.
 */
export function stripeKeyMode(secretKey: string): StripeKeyMode {
  if (/^(sk|rk)_live_/.test(secretKey)) return 'live';
  if (/^(sk|rk)_test_/.test(secretKey)) return 'test';
  return 'unknown';
}

/**
 * Pacote de cada janela (mesmo no anual: o anual recebe 200 por mes, nao
 * 2400 de uma vez; no semanal, 25 por semana). E o teto do saldo: o assinante
 * nunca passa disto.
 */
export function allowanceForPriceId(priceId: string | null | undefined): number {
  if (isWeeklyPriceId(priceId)) return WEEKLY_TICKS;
  const plan = priceId ? resolvePlanForPriceId(priceId) : null;
  return plan ? PLAN_TICKS_PER_MONTH[plan] : 0;
}

/** `pass`: passe pre-pago em cripto, UMA janela que comeca na compra (07/10/2026). */
export type AllowanceCadence = 'month' | 'week' | 'pass';

export function allowanceCadenceForPriceId(priceId: string | null | undefined): AllowanceCadence {
  return isWeeklyPriceId(priceId) ? 'week' : 'month';
}

function addMonthsUTC(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1,
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
  // Dia 31 + 1 mes vira o ultimo dia do mes seguinte, como faz a Stripe.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Inicio da janela de ticks em que `now` cai.
 * Com periodo de cobranca: meses contados a partir do inicio do periodo (no
 * mensal a janela E o periodo; no anual sao 12 janelas). No semanal, blocos de
 * 7 dias a partir do inicio do periodo, igual ao mes contado no anual. Sem
 * periodo (acesso manual): mes-calendario UTC. Passe em cripto: o proprio
 * inicio do passe (uma janela so, o passe acaba antes da proxima).
 */
export function allowanceWindowStart(
  periodStart: Date | null | undefined,
  now: Date,
  cadence: AllowanceCadence = 'month',
): Date {
  if (cadence === 'pass' && periodStart) return periodStart;
  if (cadence === 'week' && periodStart) {
    const weeks = Math.max(0, Math.floor((now.getTime() - periodStart.getTime()) / WEEK_MS));
    return new Date(periodStart.getTime() + weeks * WEEK_MS);
  }
  if (!periodStart) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let start = periodStart;
  for (let i = 1; i <= 24; i++) {
    const next = addMonthsUTC(periodStart, i);
    if (next.getTime() > now.getTime()) break;
    start = next;
  }
  return start;
}
