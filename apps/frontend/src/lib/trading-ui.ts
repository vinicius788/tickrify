export type RecommendationCanonical = 'COMPRA' | 'VENDA' | 'AGUARDAR';

export const RECOMMENDATION_LABELS: Record<
  string,
  { label: RecommendationCanonical; tone: 'buy' | 'sell' | 'hold'; icon: string }
> = {
  COMPRA: { label: 'COMPRA', tone: 'buy', icon: '↑' },
  VENDA: { label: 'VENDA', tone: 'sell', icon: '↓' },
  AGUARDAR: { label: 'AGUARDAR', tone: 'hold', icon: '⏸' },
  BUY: { label: 'COMPRA', tone: 'buy', icon: '↑' },
  SELL: { label: 'VENDA', tone: 'sell', icon: '↓' },
  HOLD: { label: 'AGUARDAR', tone: 'hold', icon: '⏸' },
  WAIT: { label: 'AGUARDAR', tone: 'hold', icon: '⏸' },
};

export function normalizeRecommendationLabel(value: unknown): RecommendationCanonical {
  const key = String(value || '').trim().toUpperCase();
  return RECOMMENDATION_LABELS[key]?.label || 'AGUARDAR';
}

export function getRecommendationMeta(value: unknown) {
  const key = String(value || '').trim().toUpperCase();
  return RECOMMENDATION_LABELS[key] || RECOMMENDATION_LABELS.AGUARDAR;
}

export function confidenceToPercent(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (numeric >= 0 && numeric <= 1) {
    return Math.round(numeric * 100);
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function calcStopPercent(entry: number, stop: number): number {
  if (!Number.isFinite(entry) || entry === 0 || !Number.isFinite(stop)) {
    return 0;
  }
  return ((stop - entry) / entry) * 100;
}

export function calcTPPercent(entry: number, tp: number): number {
  if (!Number.isFinite(entry) || entry === 0 || !Number.isFinite(tp)) {
    return 0;
  }
  return Math.abs(((tp - entry) / Math.abs(entry)) * 100);
}

export function normalizeConfluenceScore(score: number, maxFactors = 8): {
  percent: number;
  display: string;
} {
  if (!Number.isFinite(score)) {
    return { percent: 0, display: 'N/A' };
  }

  if (score >= 0 && score <= 1) {
    const percent = Math.round(score * 100);
    return { percent, display: `${percent}/100` };
  }

  if (score <= 10) {
    const factors = Math.max(0, Math.round(score));
    const percent = Math.round((factors / maxFactors) * 100);
    return { percent, display: `${factors}/${maxFactors} fatores` };
  }

  const percent = Math.max(0, Math.min(100, Math.round(score)));
  return { percent, display: `${percent}/100` };
}

export function signalToneClass(value: unknown): string {
  const tone = getRecommendationMeta(value).tone;
  if (tone === 'buy') return 'text-[var(--signal-buy)]';
  if (tone === 'sell') return 'text-[var(--signal-sell)]';
  return 'text-[var(--signal-hold)]';
}
