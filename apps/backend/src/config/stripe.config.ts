// Stripe billing configuration — plans, prices, and helpers

export type PlanType = 'starter' | 'pro' | 'elite';
export type BillingCycle = 'monthly' | 'yearly';
export type Currency = 'brl' | 'usd' | 'eur';

// Monthly ticks per plan. Yearly invoices fire once, so we credit 12× upfront.
export const PLAN_TICKS_PER_MONTH: Record<PlanType, number> = {
  starter: 45,
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

// Maps locale string to Stripe currency code
export function detectCurrency(locale: string): Currency {
  if (locale === 'pt-BR') return 'brl';
  if (locale === 'en-US') return 'usd';
  return 'eur';
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

