/**
 * Armazem de velas (28/10/2026): a UNICA porta para velas do grafico do
 * usuario no grounding (REAL DATA) de toda analise.
 *
 * Por que existe: a medicao offline de 28/10 mostrou que, sem dados reais, o
 * preco lido do print erra mais de 0,5 ATR em 28% dos casos; com dados reais o
 * erro some. Toda analise passa a receber REAL DATA quando o ativo tem fonte.
 *
 * Regras:
 * - Tabela "MarketCandle", chave (symbol, timeframe, openTime), ate 500 velas
 *   por par. Compartilhada entre todos os usuarios: um par recem-buscado serve
 *   a analise seguinte do mesmo par sem nova chamada.
 * - Um par so e buscado quando aparece numa analise (nada de varredura).
 * - Fontes: cripto pela Binance publica (api.binance.com; bloqueada para IP dos
 *   EUA, onde o Render roda, cai em data-api.binance.vision; OKX por ultimo);
 *   ouro e forex pelo Twelve Data, SO pelo medidor unico (twelve-data.ts, com a
 *   prioridade e o cache dele); B3 pela brapi (BRAPI_TOKEN; sem token, so os
 *   ativos liberados da brapi). As velas sao uso interno: nunca vao a tela.
 * - Sem banco registrado (testes, scripts) busca sem guardar.
 */
import { canonicalFxPair } from '../../common/utils/analysis-normalizer';
import { normalizeToBinancePerp } from './market.service';
import { twelveDataOpenMs, twelveDataTimeSeries, type TwelveDataConsumer, type TwelveDataDenyReason } from './twelve-data';
import { BINANCE_HOSTS, fetchJson } from './candles';

/** [openTime ms, open, high, low, close, volume]; mais antiga primeiro. */
export type StoredCandle = [number, number, number, number, number, number];
export type CandleMarket = 'crypto' | 'fx' | 'b3';

export const CANDLE_STORE = {
  /** Velas guardadas por par (symbol, timeframe). */
  keep: 500,
  /** Velas pedidas a fonte e devolvidas ao grounding. */
  fetchSize: 120,
  /** Minimo para o grounding valer (ATR e swings). */
  minCandles: 30,
  /** Velas guardadas valem ate esta idade da busca; depois busca de novo. */
  freshMs: { '1m': 0, '3m': 30_000, '5m': 60_000 } as Record<string, number>,
  freshDefaultMs: 120_000,
} as const;

const MINUTE = 60_000;
export const TIMEFRAME_MS: Record<string, number> = {
  '1m': MINUTE, '3m': 3 * MINUTE, '5m': 5 * MINUTE, '15m': 15 * MINUTE, '30m': 30 * MINUTE,
  '1h': 60 * MINUTE, '2h': 120 * MINUTE, '4h': 240 * MINUTE, '6h': 360 * MINUTE, '1d': 1440 * MINUTE,
  '1w': 10080 * MINUTE,
};

/** Normaliza o timeframe lido do grafico ("M30", "1H", "4h"...) para o intervalo canonico. */
export function normalizeTimeframe(tf: string): string | null {
  const raw = String(tf || '').trim();
  if (/^\d+\s*M$/.test(raw)) return null; // calendar month must not become minute
  const t = raw.toLowerCase().replace(/\s+/g, '');
  const map: Record<string, string> = {
    '1m': '1m', 'm1': '1m', '3m': '3m', 'm3': '3m', '5m': '5m', 'm5': '5m',
    '15m': '15m', 'm15': '15m', '30m': '30m', 'm30': '30m',
    '1h': '1h', 'h1': '1h', '60m': '1h', '2h': '2h', 'h2': '2h', '120m': '2h',
    '4h': '4h', 'h4': '4h', '240m': '4h', '6h': '6h', 'h6': '6h', '360m': '6h', '1440m': '1d', '1d': '1d', 'd1': '1d', 'd': '1d', 'daily': '1d',
    '1w': '1w', 'w1': '1w', '10080m': '1w', 'w': '1w', 'weekly': '1w',
  };
  return map[t] ?? null;
}

export function analysisInterval(groundingInterval: string | null | undefined, chartTimeframe: unknown): string | null {
  return groundingInterval ?? normalizeTimeframe(String(chartTimeframe ?? ''));
}

/** O pedaco do Prisma que o armazem usa (PrismaClient do worker ou PrismaService). */
export interface CandleDb {
  $executeRawUnsafe(query: string, ...values: unknown[]): PromiseLike<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): PromiseLike<T>;
}

export const CANDLE_STORE_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."MarketCandle" (
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "openTime" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketCandle_pkey" PRIMARY KEY ("symbol", "timeframe", "openTime")
  )`,
];

let db: CandleDb | null = null;

/** Worker e API registram o banco no boot (depois de criar a tabela). */
export async function registerCandleStore(client: CandleDb, log: (message: string) => void): Promise<boolean> {
  try {
    for (const sql of CANDLE_STORE_SQL) await client.$executeRawUnsafe(sql);
    db = client;
    log('[candles] Armazem de velas pronto.');
    return true;
  } catch (error) {
    db = null;
    log(`[candles] Armazem indisponivel (busca direta, sem guardar): ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/** Para o /health: store = guarda e compartilha; direct = busca sem guardar. */
export function candleStoreStatus(): 'store' | 'direct' {
  return db ? 'store' : 'direct';
}

/** Testes: zera o banco registrado. */
export function __resetCandleStoreForTests(): void {
  db = null;
}

/** Mercado e chave do par no armazem; null = ativo sem fonte. */
export function candleMarketOf(symbol: string): { market: CandleMarket; key: string } | null {
  const { isCrypto, base } = normalizeToBinancePerp(symbol);
  if (isCrypto && base) return { market: 'crypto', key: `${base}USDT` };
  const pair = canonicalFxPair(symbol);
  if (pair) return { market: 'fx', key: pair };
  const ticker = String(symbol || '').toUpperCase().replace(/^(BMFBOVESPA|BOVESPA|B3):/, '').replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{4}\d{1,2}F?$/.test(ticker)) return { market: 'b3', key: ticker.replace(/F$/, '') };
  return null;
}

export type CandleFetch = { candles: StoredCandle[] | null; source: string | null; denied: TwelveDataDenyReason | null };

const volumeOf = (raw: unknown) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const finite = (c: StoredCandle) => c.every((v) => Number.isFinite(v));

const OKX_BAR: Record<string, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H', '1d': '1D',
};

async function fetchCrypto(key: string, interval: string): Promise<CandleFetch> {
  for (const host of BINANCE_HOSTS) {
    const rows = await fetchJson<Array<Array<string | number>>>(`${host}/api/v3/klines?symbol=${key}&interval=${interval}&limit=${CANDLE_STORE.fetchSize}`, 4_000);
    if (!Array.isArray(rows) || rows.length < CANDLE_STORE.minCandles) continue;
    const candles = rows.map((r): StoredCandle => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), volumeOf(r[5])]);
    if (candles.every(finite)) return { candles, source: host.includes('vision') ? 'binance_vision' : 'binance', denied: null };
  }
  const bar = OKX_BAR[interval];
  if (bar) {
    const okx = await fetchJson<{ data?: string[][] }>(
      `https://www.okx.com/api/v5/market/candles?instId=${key.replace(/USDT$/, '')}-USDT&bar=${bar}&limit=${CANDLE_STORE.fetchSize}`,
      4_000,
    );
    const rows = okx?.data;
    if (Array.isArray(rows) && rows.length >= CANDLE_STORE.minCandles) {
      // OKX devolve a mais recente primeiro.
      const candles = rows.map((r): StoredCandle => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), volumeOf(r[5])]).reverse();
      if (candles.every(finite)) return { candles, source: 'okx', denied: null };
    }
  }
  return { candles: null, source: null, denied: null };
}

const TWELVE_INTERVAL: Record<string, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1day',
};

async function fetchFx(pair: string, interval: string, consumer: TwelveDataConsumer): Promise<CandleFetch> {
  const itv = TWELVE_INTERVAL[interval];
  if (!itv) return { candles: null, source: null, denied: null };
  // Ultimos 120 em UTC: o cache do medidor continua compartilhado com o monitor de alertas.
  const res = await twelveDataTimeSeries({
    consumer,
    pair,
    interval: itv,
    outputsize: CANDLE_STORE.fetchSize,
    cacheMaxAgeMs: CANDLE_STORE.freshMs[interval] ?? CANDLE_STORE.freshDefaultMs,
    timeoutMs: 6_000,
  });
  if (!res.ok) return { candles: null, source: null, denied: res.reason === 'error' || res.reason === 'no_key' ? null : res.reason };
  const values = res.series.values;
  if (!Array.isArray(values) || values.length < CANDLE_STORE.minCandles) return { candles: null, source: null, denied: null };
  // Mais recente primeiro. Forex spot nao tem volume centralizado: 0, nunca inventado.
  const candles = values
    .map((v): StoredCandle => [twelveDataOpenMs(v.datetime), Number(v.open), Number(v.high), Number(v.low), Number(v.close), volumeOf(v.volume)])
    .reverse();
  return { candles: candles.every(finite) ? candles : null, source: 'twelvedata', denied: null };
}

/** brapi: intervalo e janela que dao ao menos ~100 velas. Sem 4h na brapi. */
const BRAPI: Record<string, { interval: string; range: string }> = {
  '1m': { interval: '1m', range: '1d' },
  '5m': { interval: '5m', range: '5d' },
  '15m': { interval: '15m', range: '5d' },
  '30m': { interval: '30m', range: '1mo' },
  '1h': { interval: '1h', range: '1mo' },
  '1d': { interval: '1d', range: '6mo' },
};

async function fetchB3(ticker: string, interval: string): Promise<CandleFetch> {
  const cfg = BRAPI[interval];
  if (!cfg) return { candles: null, source: null, denied: null };
  const token = process.env.BRAPI_TOKEN?.trim();
  const body = await fetchJson<{ results?: Array<{ historicalDataPrice?: Array<{ date: number; open: number; high: number; low: number; close: number; volume?: number }> }> }>(
    `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?range=${cfg.range}&interval=${cfg.interval}${token ? `&token=${encodeURIComponent(token)}` : ''}`,
    6_000,
  );
  const rows = body?.results?.[0]?.historicalDataPrice;
  if (!Array.isArray(rows) || rows.length < CANDLE_STORE.minCandles) return { candles: null, source: null, denied: null };
  const candles = rows
    .map((r): StoredCandle => [Number(r.date) * 1000, Number(r.open), Number(r.high), Number(r.low), Number(r.close), volumeOf(r.volume)])
    .filter(finite)
    .sort((a, b) => a[0] - b[0])
    .slice(-CANDLE_STORE.fetchSize);
  return { candles: candles.length >= CANDLE_STORE.minCandles ? candles : null, source: 'brapi', denied: null };
}

function fetchFromSource(market: CandleMarket, key: string, interval: string, consumer: TwelveDataConsumer): Promise<CandleFetch> {
  if (market === 'crypto') return fetchCrypto(key, interval);
  if (market === 'fx') return fetchFx(key, interval, consumer);
  return fetchB3(key, interval);
}

/**
 * Velas de uma janela fechada [fromMs, toMs] (rastreador e replay): o mesmo
 * fornecedor de cada mercado, paginado. Nao passa pelo banco (janela de dias
 * em 1m nao cabe nas 500 do armazem). `paceMs` espaca as chamadas do Twelve
 * Data nos scripts (8 por minuto); em producao o medidor recusa e o
 * rastreador tenta na volta seguinte.
 */
export async function fetchWindow(
  symbol: string,
  interval: string,
  fromMs: number,
  toMs: number,
  consumer: TwelveDataConsumer = 'sweeper',
  paceMs = 0,
): Promise<CandleFetch> {
  const pair = candleMarketOf(symbol);
  const step = TIMEFRAME_MS[interval];
  if (!pair || !step || toMs <= fromMs) return { candles: null, source: null, denied: null };
  const out = new Map<number, StoredCandle>();
  if (pair.market === 'crypto') {
    for (const host of BINANCE_HOSTS) {
      out.clear();
      let start = fromMs;
      let ok = true;
      while (start < toMs) {
        const rows = await fetchJson<Array<Array<string | number>>>(
          `${host}/api/v3/klines?symbol=${pair.key}&interval=${interval}&startTime=${start}&endTime=${toMs}&limit=1000`, 15_000,
        );
        if (!Array.isArray(rows)) { ok = false; break; }
        for (const r of rows) out.set(Number(r[0]), [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), volumeOf(r[5])]);
        if (rows.length < 1000) break;
        start = Number(rows[rows.length - 1][0]) + 1;
      }
      if (ok && out.size) return { candles: [...out.values()].sort((a, b) => a[0] - b[0]), source: host.includes('vision') ? 'binance_vision' : 'binance', denied: null };
    }
    return { candles: null, source: null, denied: null };
  }
  if (pair.market === 'fx') {
    const itv = TWELVE_INTERVAL[interval];
    if (!itv) return { candles: null, source: null, denied: null };
    // O Twelve Data devolve no maximo 5000 velas, as MAIS RECENTES da janela.
    const chunk = 4500 * step;
    for (let start = fromMs; start < toMs; start += chunk) {
      if (paceMs) await new Promise((r) => setTimeout(r, paceMs));
      const res = await twelveDataTimeSeries({
        consumer, pair: pair.key, interval: itv, outputsize: 5000, timeoutMs: 20_000,
        window: { startMs: start, endMs: Math.min(start + chunk, toMs) },
      });
      if (!res.ok) return { candles: null, source: null, denied: res.reason === 'error' || res.reason === 'no_key' ? null : res.reason };
      for (const v of res.series.values) {
        const t = twelveDataOpenMs(v.datetime);
        out.set(t, [t, Number(v.open), Number(v.high), Number(v.low), Number(v.close), volumeOf(v.volume)]);
      }
    }
    return { candles: out.size ? [...out.values()].sort((a, b) => a[0] - b[0]) : null, source: 'twelvedata', denied: null };
  }
  const recent = await fetchB3(pair.key, interval);
  const inWindow = (recent.candles ?? []).filter((c) => c[0] >= fromMs && c[0] <= toMs);
  return { candles: inWindow.length ? inWindow : null, source: inWindow.length ? 'brapi' : null, denied: null };
}

type CandleRow = { openTime: Date; open: number; high: number; low: number; close: number; volume: number | null; source: string; fetchedAt: Date };

async function readStored(client: CandleDb, key: string, interval: string): Promise<CandleRow[]> {
  const rows = await client.$queryRawUnsafe<CandleRow[]>(
    `SELECT "openTime", "open", "high", "low", "close", "volume", "source", "fetchedAt"
     FROM "tickrify"."MarketCandle" WHERE "symbol" = $1 AND "timeframe" = $2
     ORDER BY "openTime" DESC LIMIT $3`,
    key, interval, CANDLE_STORE.fetchSize,
  );
  return [...rows].reverse();
}

async function store(client: CandleDb, key: string, interval: string, fetched: CandleFetch): Promise<void> {
  const candles = fetched.candles ?? [];
  if (!candles.length) return;
  // Um INSERT por lote, por colunas (unnest): nada interpolado no SQL. Hora em
  // ISO UTC como texto e `fetchedAt` em UTC: o Prisma le timestamp sem fuso
  // como UTC, e o frescor nao pode depender do fuso da sessao do banco.
  // A vela em formacao chega de novo na busca seguinte: atualiza no lugar.
  await client.$executeRawUnsafe(
    `INSERT INTO "tickrify"."MarketCandle" ("symbol", "timeframe", "openTime", "open", "high", "low", "close", "volume", "source", "fetchedAt")
     SELECT $1, $2, t::timestamp(3), o, h, l, c, v, $3, now() AT TIME ZONE 'UTC'
     FROM unnest($4::text[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::float8[]) AS x(t, o, h, l, c, v)
     ON CONFLICT ("symbol", "timeframe", "openTime") DO UPDATE SET
       "open" = EXCLUDED."open", "high" = EXCLUDED."high", "low" = EXCLUDED."low", "close" = EXCLUDED."close",
       "volume" = EXCLUDED."volume", "source" = EXCLUDED."source", "fetchedAt" = EXCLUDED."fetchedAt"`,
    key, interval, fetched.source,
    candles.map((c) => new Date(c[0]).toISOString()), candles.map((c) => c[1]), candles.map((c) => c[2]),
    candles.map((c) => c[3]), candles.map((c) => c[4]), candles.map((c) => c[5] || null),
  );
  // O Twelve Data manda a janela inteira a cada busca: o que nao veio nela e vela
  // gravada no fuso errado ate 09/11/2026 (ate 11h no futuro ou no meio do fim de semana).
  if (fetched.source === 'twelvedata') {
    await client.$executeRawUnsafe(
      `DELETE FROM "tickrify"."MarketCandle" WHERE "symbol" = $1 AND "timeframe" = $2 AND "openTime" <> ALL(SELECT t::timestamp(3) FROM unnest($3::text[]) AS x(t))`,
      key, interval, candles.map((c) => new Date(c[0]).toISOString()),
    );
  }
  await client.$executeRawUnsafe(
    `DELETE FROM "tickrify"."MarketCandle" WHERE "symbol" = $1 AND "timeframe" = $2 AND "openTime" < (
       SELECT "openTime" FROM "tickrify"."MarketCandle" WHERE "symbol" = $1 AND "timeframe" = $2
       ORDER BY "openTime" DESC OFFSET $3 LIMIT 1)`,
    key, interval, CANDLE_STORE.keep - 1,
  );
}

/**
 * Ultimas velas do par (ate 120, mais antiga primeiro). Usa as guardadas
 * enquanto estao frescas; senao busca na fonte, guarda e devolve. `denied`
 * diz que o Twelve Data recusou (cota): a analise segue so com a imagem.
 */
export async function recentCandles(
  symbol: string,
  interval: string,
  consumer: TwelveDataConsumer = 'analysis',
  nowMs: number = Date.now(),
): Promise<CandleFetch> {
  const pair = candleMarketOf(symbol);
  if (!pair || !TIMEFRAME_MS[interval]) return { candles: null, source: null, denied: null };
  const client = db;
  if (client) {
    try {
      const rows = await readStored(client, pair.key, interval);
      const freshMs = CANDLE_STORE.freshMs[interval] ?? CANDLE_STORE.freshDefaultMs;
      const newest = rows[rows.length - 1];
      if (rows.length >= CANDLE_STORE.minCandles && newest && nowMs - newest.fetchedAt.getTime() <= freshMs) {
        return {
          candles: rows.map((r): StoredCandle => [r.openTime.getTime(), r.open, r.high, r.low, r.close, r.volume ?? 0]),
          source: newest.source,
          denied: null,
        };
      }
    } catch {
      /* leitura falhou: busca direto */
    }
  }
  const fetched = await fetchFromSource(pair.market, pair.key, interval, consumer);
  if (client && fetched.candles) await store(client, pair.key, interval, fetched).catch(() => undefined);
  return fetched;
}
