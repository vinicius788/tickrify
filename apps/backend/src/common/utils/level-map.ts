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
import type { PriceLocation } from './signal-decision';

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
  const first = up ? location.resistance : location.support;
  if (!first) return null;
  const { price, atr } = location;
  const gap = LEVEL_MAP_RULES.mergeAtr * atr;
  const beyond = (v: unknown): v is number => finitePositive(v) && (up ? v - first.price > gap : first.price - v > gap);
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
    level: first.price,
    atr: first.atr,
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
