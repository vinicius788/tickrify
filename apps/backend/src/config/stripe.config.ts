// Configuração do Stripe (lazy/runtime)
export function getStripeConfig() {
  return {
    secretKey: String(process.env.STRIPE_SECRET_KEY || '').trim(),
    publishableKey: String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim(),
    webhookSecret: String(process.env.STRIPE_WEBHOOK_SECRET || '').trim(),

    // Planos de assinatura
    plans: {
      pro: {
        name: 'Pro',
        prices: {
          monthly: {
            priceId: process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_PRICE_PRO || '',
            price: 80.0,
            interval: 'month',
          },
          annual: {
            priceId: process.env.STRIPE_PRICE_PRO_ANNUAL || '',
            price: 960.0,
            interval: 'year',
          },
        },
        currency: 'BRL',
        features: [
          'Análises ilimitadas',
          'Análise avançada de IA',
          'Histórico ilimitado',
          'Indicadores personalizados',
          'Alertas em tempo real',
          'API de acesso',
          'Suporte prioritário 24/7',
        ],
        limits: {
          dailyAnalyses: -1, // ilimitado
          historyDays: -1, // ilimitado
        },
      },
    },
  };
}

// Tipos
export type PlanType = 'pro';
export type BillingCycle = 'monthly' | 'annual';

export interface StripePlan {
  name: string;
  prices: Record<
    BillingCycle,
    {
      priceId: string;
      price: number;
      interval: 'month' | 'year';
    }
  >;
  currency: string;
  features: string[];
  limits: {
    dailyAnalyses: number;
    historyDays: number;
  };
}
