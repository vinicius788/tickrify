export type RecommendationCanonical = 'BUY' | 'SELL' | 'HOLD';
export type ScenarioCanonical = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

const SCENARIO_META: Record<ScenarioCanonical, { label: ScenarioCanonical; tone: 'buy' | 'sell' | 'hold'; icon: string }> = {
  BULLISH: { label: 'BULLISH', tone: 'buy', icon: '↑' },
  BEARISH: { label: 'BEARISH', tone: 'sell', icon: '↓' },
  NEUTRAL: { label: 'NEUTRAL', tone: 'hold', icon: '—' },
};

export const RECOMMENDATION_LABELS: Record<
  string,
  { label: RecommendationCanonical; tone: 'buy' | 'sell' | 'hold'; icon: string }
> = {
  COMPRA: { label: 'BUY', tone: 'buy', icon: '↑' },
  VENDA: { label: 'SELL', tone: 'sell', icon: '↓' },
  AGUARDAR: { label: 'HOLD', tone: 'hold', icon: '⏸' },
  BUY: { label: 'BUY', tone: 'buy', icon: '↑' },
  SELL: { label: 'SELL', tone: 'sell', icon: '↓' },
  HOLD: { label: 'HOLD', tone: 'hold', icon: '⏸' },
  WAIT: { label: 'HOLD', tone: 'hold', icon: '⏸' },
};

export function normalizeRecommendationLabel(value: unknown): RecommendationCanonical {
  const key = String(value || '').trim().toUpperCase();
  return RECOMMENDATION_LABELS[key]?.label || 'HOLD';
}

export function getRecommendationMeta(value: unknown) {
  const key = String(value || '').trim().toUpperCase();
  return RECOMMENDATION_LABELS[key] || RECOMMENDATION_LABELS.AGUARDAR;
}

/** Cenário de mercado. A ação WAIT pode coexistir com viés bullish ou bearish. */
export function getScenarioMeta(bias: unknown, recommendation?: unknown) {
  const key = String(bias || '').trim().toUpperCase();
  if (key === 'BULLISH' || key === 'BEARISH' || key === 'NEUTRAL') {
    return SCENARIO_META[key];
  }

  // Compatibilidade com registros antigos sem bias persistido.
  const actionTone = getRecommendationMeta(recommendation).tone;
  return actionTone === 'buy'
    ? SCENARIO_META.BULLISH
    : actionTone === 'sell'
      ? SCENARIO_META.BEARISH
      : SCENARIO_META.NEUTRAL;
}

export function calcStopPercent(entry: number, stop: number): number {
  if (!Number.isFinite(entry) || entry === 0 || !Number.isFinite(stop)) {
    return 0;
  }
  // O stop SEMPRE representa perda — exibe como negativo, seja compra ou venda.
  // (Antes, em vendas o stop ficava acima da entrada e aparecia com "+", parecendo lucro.)
  return -Math.abs(((stop - entry) / Math.abs(entry)) * 100);
}

export function calcTPPercent(entry: number, tp: number): number {
  if (!Number.isFinite(entry) || entry === 0 || !Number.isFinite(tp)) {
    return 0;
  }
  return Math.abs(((tp - entry) / Math.abs(entry)) * 100);
}

/** The analysis contract supplies confluenceScore in percentage points (0..100).
 * factorsPresent is a separate field; do not infer factors or probability units
 * from a small percentage value.
 */
export function normalizeConfluenceScore(score: number): {
  percent: number;
  display: string;
} {
  if (!Number.isFinite(score)) {
    return { percent: 0, display: 'N/A' };
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
