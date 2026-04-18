// Configuração do Stripe (lazy/runtime)

export const PLAN_TICKS_PER_MONTH: Record<string, number> = {
  starter: 45,
  pro: 150,
  elite: 400,
};

export function getStripeConfig() {
  return {
    secretKey: String(process.env.STRIPE_SECRET_KEY || '').trim(),
    publishableKey: String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim(),
    webhookSecret: String(process.env.STRIPE_WEBHOOK_SECRET || '').trim(),

    // Planos de assinatura
    plans: {
      starter: {
        name: 'Starter',
        ticksPerMonth: 45,
        prices: {
          monthly: {
            priceId: process.env.STRIPE_PRICE_STARTER_MONTHLY || '',
            price: 57.0,
            interval: 'month' as const,
          },
        },
        currency: 'BRL',
        features: [
          'Até ~15 análises/mês',
          '45 Ticks mensais',
          'Análise rápida',
          'Análise deep (limitada por ticks)',
          'Histórico completo',
        ],
      },
      pro: {
        name: 'Pro',
        ticksPerMonth: 150,
        prices: {
          monthly: {
            priceId: process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_PRICE_PRO || '',
            price: 147.0,
            interval: 'month' as const,
          },
        },
        currency: 'BRL',
        features: [
          'Até ~50 análises/mês',
          '150 Ticks mensais',
          'Análise rápida + deep completa',
          'Melhor eficiência por análise',
          'Histórico completo',
          'Prioridade nas respostas',
        ],
      },
      elite: {
        name: 'Elite',
        ticksPerMonth: 400,
        prices: {
          monthly: {
            priceId: process.env.STRIPE_PRICE_ELITE_MONTHLY || '',
            price: 297.0,
            interval: 'month' as const,
          },
        },
        currency: 'BRL',
        features: [
          'Até ~150 análises/mês',
          '400 Ticks mensais',
          'IA nível institucional',
          'Execução prioritária',
          'Histórico completo',
          'Suporte prioritário',
        ],
      },
    },
  };
}

// Resolve quantos ticks um priceId representa.
// Retorna 0 se o priceId não corresponde a nenhum plano configurado.
export function resolveTicksForPriceId(priceId: string): { ticks: number; planName: string } {
  if (!priceId) return { ticks: 0, planName: '' };
  const config = getStripeConfig();
  for (const [planKey, plan] of Object.entries(config.plans)) {
    for (const priceConfig of Object.values(plan.prices)) {
      if (priceConfig.priceId && priceConfig.priceId === priceId) {
        return { ticks: plan.ticksPerMonth, planName: plan.name };
      }
    }
  }
  return { ticks: 0, planName: '' };
}

// Tipos
export type PlanType = 'starter' | 'pro' | 'elite';
export type BillingCycle = 'monthly';

export interface StripePlanPrice {
  priceId: string;
  price: number;
  interval: 'month' | 'year';
}

export interface StripePlan {
  name: string;
  ticksPerMonth: number;
  prices: Record<BillingCycle, StripePlanPrice>;
  currency: string;
  features: string[];
}
