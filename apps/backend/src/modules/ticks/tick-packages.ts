export interface TickPackage {
  id: string;
  name: string;
  ticks: number;
  priceInCents: number;
  highlight?: boolean;
  discountLabel?: string;
}

export const TICK_PACKAGES: TickPackage[] = [
  {
    id: 'ticks_starter',
    name: 'Starter',
    ticks: 20,
    priceInCents: 1990,
  },
  {
    id: 'ticks_trader',
    name: 'Trader',
    ticks: 50,
    priceInCents: 4990,
    highlight: true,
  },
  {
    id: 'ticks_pro',
    name: 'Pro',
    ticks: 150,
    priceInCents: 12990,
    discountLabel: '-13%',
  },
];

export const TICK_COSTS = {
  ANALYSIS_QUICK: 1,
  ANALYSIS_DEEP: 3,
  EXPORT_PDF: 2,
} as const;

export type AnalysisType = 'quick' | 'deep';
