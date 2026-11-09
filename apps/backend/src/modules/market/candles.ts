/**
 * Candles reais por janela de tempo, compartilhados pelo outcome sweeper
 * (30m, a regua do motor) e pelo monitor de alertas de nivel (1m cripto, 5m
 * forex/metal).
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
export type CandleInterval = '1m' | '5m' | '30m';
export type CandleSource = 'crypto' | 'fx';

const TWELVE_INTERVAL: Record<CandleInterval, string> = { '1m': '1min', '5m': '5min', '30m': '30min' };
export const INTERVAL_MS: Record<CandleInterval, number> = { '1m': 60 * 1000, '5m': 5 * 60 * 1000, '30m': 30 * 60 * 1000 };

export const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'] as const;

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

const BINANCE_PRIMARY_RETRY_MS = 10 * 60 * 1000;
let binancePrimarySkipUntil = 0;

/** Testes: volta a tentar api.binance.com primeiro. */
export function __resetCrypto1mForTests(): void {
  binancePrimarySkipUntil = 0;
}

/**
 * Velas de 1m de cripto cobrindo [startMs, endMs], para o monitor de alertas:
 * Binance, data-api.binance.vision e OKX por ultimo. A vela em formacao vem
 * junto (a maxima e a minima dela ja valem). Um pedido por ativo por volta:
 * api.binance.com recusa IP dos EUA, entao depois de uma recusa fica 10 min sem
 * ser tentada.
 */
export async function fetchCrypto1m(symbol: string, startMs: number, endMs: number): Promise<Candle[] | null> {
  const { isCrypto, base } = normalizeToBinancePerp(symbol);
  if (!isCrypto || !base) return null;
  const limit = Math.min(1000, Math.ceil((endMs - startMs) / INTERVAL_MS['1m']) + 2);
  const parse = (rows: Array<Array<string | number>>): Candle[] =>
    rows
      .map((r): Candle => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])])
      .filter((c) => c.every((v) => Number.isFinite(v)) && c[0] >= startMs && c[0] <= endMs)
      .sort((a, b) => a[0] - b[0]);
  for (const host of BINANCE_HOSTS) {
    const primary = host === BINANCE_HOSTS[0];
    if (primary && Date.now() < binancePrimarySkipUntil) continue;
    const rows = await fetchJson<Array<Array<string | number>>>(`${host}/api/v3/klines?symbol=${base}USDT&interval=1m&startTime=${startMs}&limit=${limit}`);
    if (Array.isArray(rows) && rows.length > 0) {
      const candles = parse(rows);
      if (candles.length > 0) return candles;
    } else if (primary) {
      binancePrimarySkipUntil = Date.now() + BINANCE_PRIMARY_RETRY_MS;
    }
  }
  const okx = await fetchJson<{ data?: string[][] }>(
    `https://www.okx.com/api/v5/market/candles?instId=${base}-USDT&bar=1m&limit=${Math.min(300, limit)}`,
  );
  if (!Array.isArray(okx?.data) || okx.data.length === 0) return null;
  const candles = parse(okx.data);
  return candles.length > 0 ? candles : null;
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

export type SymbolClass = 'crypto' | 'forex' | 'metal';

/** Chave do ativo para preco e cache: BTCUSDT, XAUUSD. null = sem fonte (sem alerta de nivel). */
export function priceSymbolOf(symbol: string | null | undefined): { priceSymbol: string; source: CandleSource; symbolClass: SymbolClass } | null {
  if (!symbol) return null;
  const source = candleSourceFor(symbol);
  if (source === 'crypto') {
    const { binanceSymbol } = normalizeToBinancePerp(symbol);
    return binanceSymbol ? { priceSymbol: binanceSymbol, source, symbolClass: 'crypto' } : null;
  }
  if (source === 'fx') {
    const pair = canonicalFxPair(symbol);
    if (!pair) return null;
    return { priceSymbol: pair, source, symbolClass: /^X(AU|AG|PT|PD)/.test(pair) ? 'metal' : 'forex' };
  }
  return null;
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
