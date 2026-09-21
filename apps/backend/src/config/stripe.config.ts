// Stripe billing configuration — plans, prices, and helpers

export type PlanType = 'starter' | 'pro' | 'elite';
export type BillingCycle = 'monthly' | 'yearly';
export type Currency = 'brl' | 'usd' | 'eur';

// Monthly ticks per plan. Yearly invoices fire once, so we credit 12× upfront.
//
// PLANO ÚNICO (27/07/2026, Fase 2 da auditoria): a vitrine passou a vender UM
// plano só — a chave `starter`, cujo preço no Stripe foi editado de $12 para
// $19/mês (o price ID NÃO mudou, o Stripe manteve o mesmo objeto). Os ticks
// subiram de 45 para 200 → $0,095 por análise rápida, metade do pacote avulso
// mais barato ($0,173). Antes disso assinar era pior negócio que comprar solto.
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
export const PRICES: Record<PlanType, Record<BillingCycle, Record<Currency, string>>> = {
  starter: {
    monthly: {
      brl: 'price_1TRv2fB1hl0IoocUolv3jJkh', // R$57
      usd: 'price_1TRvEJB1hl0IoocUvbCyxkt5', // $12
      eur: 'price_1TRvG0B1hl0IoocUKA6heI68', // €11
    },
    yearly: {
      brl: 'price_1TRvHnB1hl0IoocUq8N8ovfv', // R$570
      usd: 'price_1TRvKHB1hl0IoocU3N7MMGcG', // $120
      eur: 'price_1TRvM8B1hl0IoocUwcyW6U7d', // €110
    },
  },
  pro: {
    monthly: {
      brl: 'price_1TRv5zB1hl0IoocU2Yj9jifa', // R$147
      usd: 'price_1TRvEsB1hl0IoocUfoDgdHkD', // $29
      eur: 'price_1TRvGQB1hl0IoocUW7feV7IY', // €27
    },
    yearly: {
      brl: 'price_1TRvIFB1hl0IoocUxl5udssL', // R$1470
      usd: 'price_1TRvKvB1hl0IoocUeyKzAxFn', // $290
      eur: 'price_1TRvMeB1hl0IoocU2UpTYf9w', // €270
    },
  },
  elite: {
    monthly: {
      brl: 'price_1TRv6yB1hl0IoocU77HZPR1a', // R$297
      usd: 'price_1TRvFCB1hl0IoocU2NlE5m2I', // $59
      eur: 'price_1TRvGoB1hl0IoocUk1ojbWdf', // €55
    },
    yearly: {
      brl: 'price_1TRvIeB1hl0IoocUWcspSfuo', // R$2970
      usd: 'price_1TRvLbB1hl0IoocU8iMAMuwl', // $590
      eur: 'price_1TRvN7B1hl0IoocUu20gafjg', // €550
    },
  },
};

export function getPriceId(plan: PlanType, interval: BillingCycle, currency: Currency): string {
  return PRICES[plan][interval][currency];
}

// Maps locale string to Stripe currency code.
// Site is global/English-first → USD is the default. BRL only for Brazilian
// locale; EUR only for eurozone locales. Everything else (US, UK, CA, AU, …) → USD.
const EURO_LOCALE_PREFIXES = ['de', 'fr', 'es', 'it', 'nl', 'fi', 'el', 'et', 'lv', 'lt', 'sk', 'sl', 'ga', 'mt'];

export function detectCurrency(locale: string): Currency {
  const normalized = String(locale || '').toLowerCase();
  if (normalized === 'pt-br' || normalized === 'pt') return 'brl';
  if (normalized === 'pt-pt') return 'eur';
  if (EURO_LOCALE_PREFIXES.some((l) => normalized === l || normalized.startsWith(`${l}-`))) return 'eur';
  return 'usd';
}

// Reverse-lookup: priceId → { plan, interval, ticks, planName }
// Yearly invoices fire once per year, so we credit the full 12-month allocation upfront.
export function resolveTicksForPriceId(priceId: string): { ticks: number; planName: string } {
  if (!priceId) return { ticks: 0, planName: '' };

  for (const [planKey, intervals] of Object.entries(PRICES) as [PlanType, typeof PRICES[PlanType]][]) {
    for (const [interval, currencies] of Object.entries(intervals) as [BillingCycle, Record<Currency, string>][]) {
      for (const id of Object.values(currencies)) {
        if (id === priceId) {
          const monthly = PLAN_TICKS_PER_MONTH[planKey];
          const ticks = interval === 'yearly' ? monthly * 12 : monthly;
          const planName = planKey.charAt(0).toUpperCase() + planKey.slice(1);
          return { ticks, planName };
        }
      }
    }
  }

  return { ticks: 0, planName: '' };
}

// Reverse-lookup: priceId → plan name (or null if not found)
export function resolvePlanForPriceId(priceId: string): PlanType | null {
  if (!priceId) return null;

  for (const [planKey, intervals] of Object.entries(PRICES) as [PlanType, typeof PRICES[PlanType]][]) {
    for (const currencies of Object.values(intervals)) {
      if (Object.values(currencies).includes(priceId)) {
        return planKey;
      }
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
 * Pacote MENSAL do plano (mesmo no anual: o anual recebe 200 por mes, nao
 * 2400 de uma vez). E o teto do saldo: o assinante nunca passa disto.
 */
export function monthlyTicksForPriceId(priceId: string | null | undefined): number {
  const plan = priceId ? resolvePlanForPriceId(priceId) : null;
  return plan ? PLAN_TICKS_PER_MONTH[plan] : 0;
}

function addMonthsUTC(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1,
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
  // Dia 31 + 1 mes vira o ultimo dia do mes seguinte, como faz a Stripe.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

/**
 * Inicio da janela mensal de ticks em que `now` cai.
 * Com periodo de cobranca: meses contados a partir do inicio do periodo (no
 * mensal a janela E o periodo; no anual sao 12 janelas). Sem periodo (acesso
 * manual): mes-calendario UTC.
 */
export function allowanceWindowStart(periodStart: Date | null | undefined, now: Date): Date {
  if (!periodStart) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let start = periodStart;
  for (let i = 1; i <= 24; i++) {
    const next = addMonthsUTC(periodStart, i);
    if (next.getTime() > now.getTime()) break;
    start = next;
  }
  return start;
}
