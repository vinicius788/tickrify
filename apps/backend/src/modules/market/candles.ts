/**
 * Candles reais por janela de tempo, compartilhados pelo outcome sweeper
 * (30m, a regua do motor) e pelo monitor de alertas de nivel (5m).
 *
 * Fontes: OKX primeiro (Binance bloqueia IPs dos EUA, onde o Render roda),
 * Binance spot de reserva; forex/metais via Twelve Data (twelve-data.ts, o
 * unico caminho para la). Sem fonte devolve null: nunca se inventa preco.
 */
import { normalizeToBinancePerp } from './market.service';
import { canonicalFxPair } from '../../common/utils/analysis-normalizer';
import {
  TwelveDataUnavailableError,
  twelveDataApiKey,
  twelveDataTimeSeries,
  type TwelveDataConsumer,
  type TwelveDataValue,
} from './twelve-data';

export type Candle = [number, number, number, number, number]; // [ts, o, h, l, c]
export type CandleInterval = '5m' | '30m';
export type CandleSource = 'crypto' | 'fx';

const TWELVE_INTERVAL: Record<CandleInterval, string> = { '5m': '5min', '30m': '30min' };
export const INTERVAL_MS: Record<CandleInterval, number> = { '5m': 5 * 60 * 1000, '30m': 30 * 60 * 1000 };

/** GET de JSON publico com teto de tempo; qualquer falha vira null. Tambem usado pelo armazem de velas. */
export async function fetchJson<T>(url: string, timeoutMs = 6_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'tickrify/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Candles de CRIPTO cobrindo [startMs, endMs].
 * OKX history-candles aceita `after` (retorna candles ANTERIORES ao ts) — um
 * pedido ancorado no fim da janela cobre os 96 candles de 48h em qualquer idade.
 * `minCandles` 24 (>=12h em 30m) ja decide a maioria dos casos do sweeper.
 */
export async function fetchCryptoWindow(
  base: string,
  startMs: number,
  endMs: number,
  interval: CandleInterval = '30m',
  minCandles = 24,
): Promise<Candle[] | null> {
  const okx = await fetchJson<{ data?: string[][] }>(
    `https://www.okx.com/api/v5/market/history-candles?instId=${base}-USDT&bar=${interval}&after=${endMs + 1}&limit=100`,
  );
  const rows = okx?.data;
  if (Array.isArray(rows) && rows.length > 0) {
    const candles = rows
      .map((r): Candle => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])])
      .filter((c) => c.every((v) => Number.isFinite(v)) && c[0] >= startMs && c[0] <= endMs)
      .sort((a, b) => a[0] - b[0]);
    if (candles.length >= minCandles) return candles;
  }
  const bin = await fetchJson<Array<Array<string | number>>>(
    `https://api.binance.com/api/v3/klines?symbol=${base}USDT&interval=${interval}&startTime=${startMs}&limit=100`,
  );
  if (Array.isArray(bin) && bin.length > 0) {
    const candles = bin
      .map((r): Candle => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])])
      .filter((c) => c.every((v) => Number.isFinite(v)) && c[0] <= endMs);
    if (candles.length >= minCandles) return candles;
  }
  return null;
}

const toCandles = (values: TwelveDataValue[]): Candle[] =>
  values
    .map((v): Candle => [
      Date.parse(`${v.datetime.replace(' ', 'T')}Z`),
      Number(v.open),
      Number(v.high),
      Number(v.low),
      Number(v.close),
    ])
    .filter((c) => c.every((n) => Number.isFinite(n)))
    .sort((a, b) => a[0] - b[0]);

/**
 * Candles de FOREX/METAIS via Twelve Data (twelve-data.ts: medidor, orcamento e
 * fim de semana). Recusa por cota, orcamento ou mercado fechado LANCA
 * `TwelveDataUnavailableError`: quem chama deixa para depois, nunca conclui
 * "nao ha candles" (o sweeper marcava UNTRACKABLE para sempre). `consumer`
 * padrao = sweeper, o dono original desta janela.
 */
export async function fetchFxWindow(
  symbol: string,
  startMs: number,
  endMs: number,
  interval: CandleInterval = '30m',
  minCandles = 24,
  consumer: TwelveDataConsumer = 'sweeper',
): Promise<Candle[] | null> {
  // Aceita o sufixo da corretora (XAUUSDm): antes virava UNTRACKABLE.
  const pair = canonicalFxPair(symbol);
  if (!pair) return null;
  const res = await twelveDataTimeSeries({
    consumer,
    pair,
    interval: TWELVE_INTERVAL[interval],
    outputsize: 120,
    window: { startMs, endMs },
  });
  if (!res.ok) {
    if (res.reason === 'no_key' || res.reason === 'error') return null;
    throw new TwelveDataUnavailableError(res.reason);
  }
  if (res.series.values.length === 0) return null;
  const candles = toCandles(res.series.values);
  // Forex fecha no fim de semana — 24 candles (12h em 30m) bastam pra decidir a maioria.
  return candles.length >= minCandles ? candles : null;
}

/**
 * Ultimos 120 candles de 5m de forex/metal: a MESMA requisicao do grounding de
 * um grafico de 5m, entao monitor e analise dividem o cache. So reaproveita se
 * o Twelve Data disser que o horario vem em UTC; senao pede com fuso UTC.
 */
export async function fetchFxLatest5m(symbol: string, consumer: TwelveDataConsumer, maxAgeMs: number): Promise<Candle[] | null> {
  const pair = canonicalFxPair(symbol);
  if (!pair) return null;
  const base = { consumer, pair, interval: TWELVE_INTERVAL['5m'], outputsize: 120, cacheMaxAgeMs: maxAgeMs };
  let res = await twelveDataTimeSeries(base);
  if (res.ok && res.series.exchangeTimezone && res.series.exchangeTimezone !== 'UTC') {
    res = await twelveDataTimeSeries({ ...base, timezoneUtc: true });
  }
  if (!res.ok) {
    if (res.reason === 'no_key' || res.reason === 'error') return null;
    throw new TwelveDataUnavailableError(res.reason);
  }
  const candles = toCandles(res.series.values);
  return candles.length ? candles : null;
}

/** De onde viria o preco deste ativo. null = sem fonte (sinteticos, acoes, ETF, ou forex sem chave). */
export function candleSourceFor(symbol: string): CandleSource | null {
  const { isCrypto, base } = normalizeToBinancePerp(symbol);
  if (isCrypto && base) return 'crypto';
  return canonicalFxPair(symbol) && twelveDataApiKey() ? 'fx' : null;
}

export function fetchWindowFor(
  symbol: string,
  startMs: number,
  endMs: number,
  interval: CandleInterval = '30m',
  minCandles = 24,
  consumer: TwelveDataConsumer = 'sweeper',
): Promise<Candle[] | null> {
  const { isCrypto, base } = normalizeToBinancePerp(symbol);
  return isCrypto && base
    ? fetchCryptoWindow(base, startMs, endMs, interval, minCandles)
    : fetchFxWindow(symbol, startMs, endMs, interval, minCandles, consumer);
}
