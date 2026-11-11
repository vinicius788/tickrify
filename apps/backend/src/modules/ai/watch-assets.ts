/**
 * "My assets" (10/11/2026): a lista de ativos que a pessoa opera e os niveis do
 * dia de cada um, calculados SO pelo codigo das velas reais do armazem. Sem IA,
 * sem cota de analise e sem sinal: preco, estrutura do tempo grafico e o
 * suporte e a resistencia mais proximos (swings fractais; o mesmo mapa do
 * NO_TRADE, level-map.ts).
 */
import { atr14Series, closedBars, fractalSwings, type Bar } from '../../common/utils/plan-engine';
import { buildLevelMap } from '../../common/utils/level-map';
import { TIMEFRAME_MS, candleMarketOf } from '../market/candle-store';
import { summarizeHigherTimeframe } from './ai.adapter';
import type { HtfTrend } from './analysis-data-coverage';

export const WATCH_ASSET_RULES = {
  maxAssets: { free: 2, subscriber: 5 },
  timeframes: ['1m', '5m', '15m', '1h', '4h'],
  defaultTimeframe: '15m',
  /** Velas guardadas valem ate isto para os niveis do dia (a analise segue no frescor dela). */
  maxAgeMs: 15 * 60 * 1000,
  /** Ativos oferecidos na tela; a pessoa tambem pode digitar outro com fonte de preco. */
  suggested: ['XAUUSD', 'BTCUSDT', 'EURUSD', 'ETHUSDT', 'GBPUSD', 'USDJPY', 'SOLUSDT', 'EURJPY'],
} as const;

/** O ativo como o armazem de velas o conhece (BTCUSDm -> BTCUSDT); null = sem fonte de preco. */
export function canonicalWatchSymbol(symbol: unknown): string | null {
  const pair = candleMarketOf(String(symbol ?? ''));
  return pair && pair.market !== 'b3' ? pair.key : null;
}

export interface DayLevel {
  price: number;
  /** Distancia do preco, em ATR e em % do preco. */
  atr: number;
  pct: number;
}

export interface DayLevels {
  price: number;
  atr: number;
  /** Estrutura do tempo grafico pelos dois ultimos topos e fundos; null sem swings suficientes. */
  trend: HtfTrend | null;
  above: DayLevel | null;
  below: DayLevel | null;
  /** Abertura da ultima vela usada. */
  candleAt: number;
}

/** null com menos de 30 velas fechadas ou sem ATR. */
export function dayLevels(candles: readonly Bar[], interval: string, nowMs: number): DayLevels | null {
  const step = TIMEFRAME_MS[interval];
  if (!step || !candles.length) return null;
  const closed = closedBars(candles, step, nowMs);
  const atr = atr14Series(closed)[closed.length - 1];
  if (closed.length < 30 || !(atr > 0)) return null;
  const last = candles[candles.length - 1];
  const price = last[4];
  const swings = fractalSwings(closed).map(({ kind, price: p }) => ({ kind, price: p }));
  const at = (p: number) => ({ price: p, atr: Math.abs(price - p) / atr });
  const lows = swings.filter((s) => s.kind === 'low' && s.price < price).map((s) => s.price);
  const highs = swings.filter((s) => s.kind === 'high' && s.price > price).map((s) => s.price);
  const map = buildLevelMap(
    {
      price, atr, rangePosPct: null, htfTrend: null, invalidation: null, planLevel: null,
      support: lows.length ? at(Math.max(...lows)) : null,
      resistance: highs.length ? at(Math.min(...highs)) : null,
    },
    { swings, windowHigh: Math.max(...closed.map((b) => b[2])), windowLow: Math.min(...closed.map((b) => b[3])) },
  );
  const side = (s: { level: number; atr: number } | null | undefined): DayLevel | null =>
    s ? { price: s.level, atr: s.atr, pct: (100 * Math.abs(s.level - price)) / price } : null;
  return {
    price, atr,
    trend: summarizeHigherTimeframe(closed)?.trend ?? null,
    above: side(map?.above),
    below: side(map?.below),
    candleAt: last[0],
  };
}
