import { Currency } from '../../config/stripe.config';

export interface TickPackage {
  id: string;
  name: string;
  ticks: number;
  /** @deprecated BRL price kept for backward compatibility — prefer pricesInCents */
  priceInCents: number;
  pricesInCents: Record<Currency, number>;
  highlight?: boolean;
  discountLabel?: string;
}

export const TICK_PACKAGES: TickPackage[] = [
  {
    id: 'ticks_starter',
    name: 'Starter',
    ticks: 20,
    priceInCents: 1990,
    pricesInCents: { brl: 1990, usd: 399, eur: 379 },
  },
  {
    id: 'ticks_trader',
    name: 'Trader',
    ticks: 50,
    priceInCents: 4990,
    pricesInCents: { brl: 4990, usd: 999, eur: 929 },
    highlight: true,
  },
  {
    id: 'ticks_pro',
    name: 'Pro',
    ticks: 150,
    priceInCents: 12990,
    pricesInCents: { brl: 12990, usd: 2599, eur: 2399 },
    discountLabel: '-13%',
  },
];

export const TICK_COSTS = {
  ANALYSIS_QUICK: 1,
  ANALYSIS_DEEP: 3,
  EXPORT_PDF: 2,
} as const;

export type AnalysisType = 'quick' | 'deep';
