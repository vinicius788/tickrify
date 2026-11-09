/**
 * Mapa de niveis do NO_TRADE (03/11/2026): sem plano, a tela mostra os dois
 * lados do preco, montados pelo codigo a partir das velas reais que ja entraram
 * na analise. Nada de IA e nada de sinal: so niveis e distancia em ATR.
 *
 * Cada lado parte do nivel mais proximo (o mesmo suporte/resistencia do
 * `location`, swings fractais) e o proximo nivel depois dele: a proxima swing
 * fractal; sem ela, as swings do resumo do grounding; sem elas, a maxima ou a
 * minima da janela. Niveis a menos de `mergeAtr` um do outro contam como um so.
 * Arquivo proprio: o motor (signal-decision, plan-engine) nao muda por isto.
 */
import { nearEdge, type WatchPlan } from './plan-engine';
import type { PriceLocation, SignalState, ValidatorNote, ValidatorReason } from './signal-decision';

export const LEVEL_MAP_RULES = {
  /** Dois niveis mais perto que isto (em ATR) sao o mesmo nivel. */
  mergeAtr: 0.25,
} as const;

export interface LevelMapSide {
  /** Suporte ou resistencia mais proximo. */
  level: number;
  atr: number;
  /** O nivel seguinte depois dele; null = nada alem dele nas velas da analise. */
  next: number | null;
  /** Distancia do preco ate `next`, em ATR. */
  nextAtr: number | null;
}

export interface LevelMap {
  price: number;
  atr: number;
  above: LevelMapSide | null;
  below: LevelMapSide | null;
}

export interface LevelMapCandles {
  swings?: readonly { kind: 'high' | 'low'; price: number }[] | null;
  swingHighs?: readonly number[] | null;
  swingLows?: readonly number[] | null;
  windowHigh?: number | null;
  windowLow?: number | null;
}

const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function side(location: PriceLocation, candles: LevelMapCandles, up: boolean): LevelMapSide | null {
  const { price, atr } = location;
  const swing = up ? location.resistance : location.support;
  const edge = up ? candles.windowHigh : candles.windowLow;
  const level = swing?.price ?? edge;
  if (!finitePositive(level) || (up ? level <= price : level >= price)) return null;
  const gap = LEVEL_MAP_RULES.mergeAtr * atr;
  const beyond = (v: unknown): v is number => finitePositive(v) && (up ? v - level > gap : level - v > gap);
  const closest = (values: readonly unknown[]): number | null => {
    const list = values.filter(beyond);
    if (!list.length) return null;
    return up ? Math.min(...list) : Math.max(...list);
  };
  const fractal = (candles.swings ?? []).filter((s) => s.kind === (up ? 'high' : 'low')).map((s) => s.price);
  const next =
    closest(fractal) ??
    closest((up ? candles.swingHighs : candles.swingLows) ?? []) ??
    closest([up ? candles.windowHigh : candles.windowLow]);
  return {
    level,
    atr: Math.abs(level - price) / atr,
    next,
    nextAtr: next === null ? null : Math.abs(next - price) / atr,
  };
}

/** null sem preco/ATR reais ou sem nenhum nivel dos dois lados. */
export function buildLevelMap(location: PriceLocation | null, candles: LevelMapCandles | null): LevelMap | null {
  if (!location || !finitePositive(location.price) || !finitePositive(location.atr)) return null;
  const c = candles ?? {};
  const above = side(location, c, true);
  const below = side(location, c, false);
  if (!above && !below) return null;
  return { price: location.price, atr: location.atr, above, below };
}

/** Motivos em que o plano do modelo nao serve nem como preco de referencia. */
const AI_LEVEL_UNUSABLE: readonly ValidatorReason[] = [
  'implausible_price', 'state_mismatch', 'watch_plan_invalid', 'plan_invalidated', 'levels_unverified',
];

export interface AiLevel {
  price: number;
}

/**
 * O validador recusou um plano coerente do modelo (09/11/2026): o estado segue
 * NO_TRADE e o preco que a IA marcou fica guardado so para a tela. Nunca vira
 * alerta automatico nem entra em decisao, acerto ou estatistica.
 */
export function aiLevelOf(plan: WatchPlan | null, decision: { state: SignalState; validatorNotes: ValidatorNote[] }): AiLevel | null {
  if (decision.state !== 'NO_TRADE' || !plan) return null;
  const note = decision.validatorNotes.find((n) => n.to === 'NO_TRADE');
  if (!note || note.from === 'NO_TRADE' || AI_LEVEL_UNUSABLE.includes(note.reason)) return null;
  return { price: nearEdge(plan) };
}
