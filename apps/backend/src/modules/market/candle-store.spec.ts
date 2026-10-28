/**
 * Armazem de velas (28/10/2026): fontes, intervalos sem mapa, cache do medidor
 * do Twelve Data e o banco compartilhado (fresco serve, velho busca e guarda).
 */
import {
  CANDLE_STORE,
  __resetCandleStoreForTests,
  candleMarketOf,
  candleStoreStatus,
  recentCandles,
  registerCandleStore,
  type CandleDb,
} from './candle-store';
import { __setTwelveDataForTests } from './twelve-data';

const NOW = new Date('2026-10-27T12:00:00Z');
const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as unknown as Response;
const klines = (n: number, last = 100) =>
  Array.from({ length: n }, (_, i) => [NOW.getTime() - (n - i) * 300_000, last, last + 1, last - 1, last, 5]);

/** Banco falso: guarda as linhas do upsert e responde o SELECT pelo que tem. */
function fakeDb() {
  const rows = new Map<string, { openTime: Date; open: number; high: number; low: number; close: number; volume: number | null; source: string; fetchedAt: Date }>();
  const calls: string[] = [];
  const db: CandleDb = {
    $executeRawUnsafe: async (sql: string, ...v: unknown[]) => {
      calls.push(sql.trim().split(/\s+/)[0]);
      if (sql.includes('INSERT INTO')) {
        const [symbol, timeframe, source, times, o, h, l, c, vol] = v as [string, string, string, string[], ...Array<Array<number | null>>];
        times.forEach((iso, i) => {
          const openTime = new Date(iso);
          rows.set(`${symbol}|${timeframe}|${openTime.getTime()}`, {
            openTime, open: o[i] as number, high: h[i] as number, low: l[i] as number, close: c[i] as number,
            volume: vol[i], source, fetchedAt: new Date(Date.now()),
          });
        });
      }
      return 1;
    },
    $queryRawUnsafe: (async (_sql: string, symbol: string, timeframe: string, limit: number) =>
      [...rows.entries()]
        .filter(([k]) => k.startsWith(`${symbol}|${timeframe}|`))
        .map(([, r]) => r)
        .sort((a, b) => b.openTime.getTime() - a.openTime.getTime())
        .slice(0, limit)) as CandleDb['$queryRawUnsafe'],
  };
  return { db, rows, calls };
}

describe('candleMarketOf', () => {
  it.each([
    ['BTCUSDT', 'crypto', 'BTCUSDT'],
    ['BTC/USDT', 'crypto', 'BTCUSDT'],
    ['XAUUSD.s', 'fx', 'XAUUSD'],
    ['EURUSD', 'fx', 'EURUSD'],
    ['PETR4', 'b3', 'PETR4'],
    ['BMFBOVESPA:VALE3', 'b3', 'VALE3'],
    ['BOVA11', 'b3', 'BOVA11'],
  ])('%s -> %s %s', (symbol, market, key) => {
    expect(candleMarketOf(symbol)).toEqual({ market, key });
  });

  it.each(['NAS100', 'Volatility 75 Index', 'AAPL', ''])('sem fonte: %p', (symbol) => {
    expect(candleMarketOf(symbol)).toBeNull();
  });
});

describe('recentCandles sem banco (testes, scripts): busca direto', () => {
  let fetchSpy: jest.SpyInstance;
  const oldKey = process.env.TWELVE_DATA_API_KEY;
  beforeEach(() => {
    __resetCandleStoreForTests();
    __setTwelveDataForTests({ now: () => NOW });
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    if (oldKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
    else process.env.TWELVE_DATA_API_KEY = oldKey;
  });

  it('intervalo sem mapa nao chama fonte nenhuma', async () => {
    expect(await recentCandles('BTCUSDT', '7h')).toEqual({ candles: null, source: null, denied: null });
    process.env.TWELVE_DATA_API_KEY = 'synthetic-not-a-credential';
    expect((await recentCandles('EURUSD', '6h')).candles).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cripto: Binance primeiro; bloqueada, data-api.binance.vision', async () => {
    fetchSpy.mockResolvedValueOnce(json(null, false, 451)).mockResolvedValueOnce(json(klines(120)));
    const out = await recentCandles('BTCUSDT', '5m');
    expect(out).toMatchObject({ source: 'binance_vision', denied: null });
    expect(out.candles).toHaveLength(120);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=120');
    expect(String(fetchSpy.mock.calls[1][0])).toContain('https://data-api.binance.vision/api/v3/klines');
  });

  it('6h na cripto: as duas Binance e nada de inventar um 6H na OKX', async () => {
    fetchSpy.mockResolvedValue(json(null, false, 451));
    expect((await recentCandles('BTCUSDT', '6h')).candles).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.every(([url]) => String(url).includes('binance'))).toBe(true);
  });

  describe('forex/metal pelo medidor do Twelve Data', () => {
    const tdValues = Array.from({ length: 120 }, (_, i) => {
      const t = new Date(NOW.getTime() - (i + 1) * 5 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
      const p = 4000 + Math.sin(i / 5) * 10;
      return { datetime: t, open: String(p), high: String(p + 3), low: String(p - 3), close: String(p + 1), volume: '0' };
    });
    beforeEach(() => {
      process.env.TWELVE_DATA_API_KEY = 'synthetic-not-a-credential';
      fetchSpy.mockResolvedValue(json({ values: tdValues, meta: { exchange_timezone: 'UTC' } }));
    });

    it('a mesma requisicao de sempre e o cache do medidor: uma chamada para dois pedidos', async () => {
      const first = await recentCandles('XAUUSD', '5m');
      const second = await recentCandles('XAUUSD', '5m');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0][0])).toBe(
        'https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=120&apikey=synthetic-not-a-credential',
      );
      expect(second.candles).toEqual(first.candles);
      // Mais antiga primeiro, volume zerado.
      expect(first.candles?.[119][4]).toBeCloseTo(Number(tdValues[0].close));
    });

    it('1m nunca reaproveita', async () => {
      await recentCandles('XAUUSD', '1m');
      await recentCandles('XAUUSD', '1m');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('cota acabou: sem velas e o motivo vai junto', async () => {
      fetchSpy.mockResolvedValue(json({ code: 429, status: 'error', message: 'You have run out of API credits for the day.' }, false, 429));
      expect(await recentCandles('XAUUSD', '15m')).toEqual({ candles: null, source: null, denied: 'quota_exhausted' });
    });
  });

  it('B3 pela brapi: segundos viram ms, ordem cronologica, so as ultimas 120', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ date: 1_790_000_000 + (150 - i) * 900, open: 30, high: 31, low: 29, close: 30.5, volume: 1000 }));
    fetchSpy.mockResolvedValue(json({ results: [{ historicalDataPrice: rows }] }));
    const out = await recentCandles('PETR4', '15m');
    expect(out.source).toBe('brapi');
    expect(out.candles).toHaveLength(CANDLE_STORE.fetchSize);
    expect(out.candles?.[0][0]).toBeLessThan(out.candles?.[119][0] as number);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('https://brapi.dev/api/quote/PETR4?range=5d&interval=15m');
  });
});

describe('recentCandles com o banco: compartilhado entre usuarios', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    __resetCandleStoreForTests();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(json(klines(120)));
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    __resetCandleStoreForTests();
  });

  it('cria a tabela no registro e diz no /health se guarda ou busca direto', async () => {
    const { db, calls } = fakeDb();
    expect(candleStoreStatus()).toBe('direct');
    expect(await registerCandleStore(db, () => undefined)).toBe(true);
    expect(calls[0]).toBe('CREATE');
    expect(candleStoreStatus()).toBe('store');
  });

  it('tabela indisponivel: segue buscando direto', async () => {
    const broken: CandleDb = { $executeRawUnsafe: async () => { throw new Error('denied'); }, $queryRawUnsafe: (async () => []) as CandleDb['$queryRawUnsafe'] };
    expect(await registerCandleStore(broken, () => undefined)).toBe(false);
    expect(candleStoreStatus()).toBe('direct');
  });

  it('busca, guarda e prune; o pedido seguinte, ainda fresco, sai do banco sem chamar a fonte', async () => {
    const { db, rows, calls } = fakeDb();
    await registerCandleStore(db, () => undefined);
    const first = await recentCandles('BTCUSDT', '5m');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(120);
    expect(calls).toEqual(['CREATE', 'INSERT', 'DELETE']);
    const second = await recentCandles('BTC/USDT', '5m');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second.candles).toEqual(first.candles);
    expect(second.source).toBe('binance');
  });

  it('velas guardadas velhas: busca de novo', async () => {
    const { db } = fakeDb();
    await registerCandleStore(db, () => undefined);
    await recentCandles('BTCUSDT', '5m');
    await recentCandles('BTCUSDT', '5m', 'analysis', Date.now() + CANDLE_STORE.freshMs['5m'] + 1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
