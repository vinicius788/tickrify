export type RecommendationCanonical = 'BUY' | 'SELL' | 'HOLD';
export type ScenarioCanonical = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

const SCENARIO_META: Record<ScenarioCanonical, { label: ScenarioCanonical; tone: 'buy' | 'sell' | 'hold'; icon: string }> = {
  BULLISH: { label: 'BULLISH', tone: 'buy', icon: '↑' },
  BEARISH: { label: 'BEARISH', tone: 'sell', icon: '↓' },
  NEUTRAL: { label: 'NEUTRAL', tone: 'hold', icon: '→' },
};

export const RECOMMENDATION_LABELS: Record<
  string,
  { label: RecommendationCanonical; tone: 'buy' | 'sell' | 'hold' }
> = {
  COMPRA: { label: 'BUY', tone: 'buy' },
  VENDA: { label: 'SELL', tone: 'sell' },
  AGUARDAR: { label: 'HOLD', tone: 'hold' },
  BUY: { label: 'BUY', tone: 'buy' },
  SELL: { label: 'SELL', tone: 'sell' },
  HOLD: { label: 'HOLD', tone: 'hold' },
  WAIT: { label: 'HOLD', tone: 'hold' },
};

export function getRecommendationMeta(value: unknown) {
  const key = String(value || '').trim().toUpperCase();
  return RECOMMENDATION_LABELS[key] || RECOMMENDATION_LABELS.AGUARDAR;
}

export type SignalStateCanonical = 'NO_TRADE' | 'WATCH' | 'ARMED' | 'ENTER_NOW';
const SIGNAL_STATES: readonly SignalStateCanonical[] = ['NO_TRADE', 'WATCH', 'ARMED', 'ENTER_NOW'];

/**
 * Estado do copiloto: o rotulo principal de todo resultado. O servidor
 * manda o campo em toda resposta (analise, lista, setup); sem ele, a mesma
 * regra de leitura do historico do backend (`deriveSignalState`).
 */
export function resolveSignalState(
  signalState: unknown,
  recommendation: unknown,
  entryType?: unknown,
  alternativeScenario?: unknown,
): SignalStateCanonical {
  const stored = SIGNAL_STATES.find((s) => s === signalState);
  if (stored) return stored;
  if (getRecommendationMeta(recommendation).tone !== 'hold') {
    return String(entryType ?? '').trim().toLowerCase() === 'market' ? 'ENTER_NOW' : 'ARMED';
  }
  return String(alternativeScenario ?? '').trim() ? 'WATCH' : 'NO_TRADE';
}

/** So ENTER_NOW e ARMED levam a cor da direcao: WATCH e NO_TRADE nunca parecem sinal ativo. */
export function signalStateTone(state: SignalStateCanonical, recommendation: unknown): 'buy' | 'sell' | 'hold' {
  return state === 'ENTER_NOW' || state === 'ARMED' ? getRecommendationMeta(recommendation).tone : 'hold';
}

/** Lado de uma entrada: a direcao do plano; sem plano, a da recomendacao (nunca o cenario solto). */
export function entrySide(watchPlan: unknown, recommendation: unknown): 'buy' | 'sell' | null {
  const direction = (watchPlan as { direction?: unknown } | null | undefined)?.direction;
  if (direction === 'long') return 'buy';
  if (direction === 'short') return 'sell';
  const tone = getRecommendationMeta(recommendation).tone;
  return tone === 'hold' ? null : tone;
}

/** Rotulo do estado; no ENTER_NOW, com a direcao ("Buy now" / "Sell now"). */
export function signalStateLabel(
  labels: { states: Record<SignalStateCanonical, string>; buyNow: string; sellNow: string },
  state: SignalStateCanonical,
  side: 'buy' | 'sell' | null,
): string {
  if (state === 'ENTER_NOW' && side) return side === 'buy' ? labels.buyNow : labels.sellNow;
  return labels.states[state];
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
