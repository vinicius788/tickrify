/**
 * B3 SYNTHETIC characterization, not a new scoring methodology.
 * Counterexamples deliberately assert existing behavior and identify its limits.
 * All feeds/database writes below are mocks; no historical record is reprocessed.
 */
import { evaluateTrade, sweepOnce, type TradePlan } from '../../worker/outcome.sweeper';
import { fetchCryptoWindow, fetchFxWindow, type Candle } from '../modules/market/candles';
import { fillCandleRuleOf, splitByFillCandleRule, tally, type FillCandleRule } from '../modules/ai/accuracy.util';

const T = Date.parse('2026-10-01T00:00:00Z');
const M30 = 1800000, H48 = 48 * 3600000;
const buy: TradePlan = { recommendation: 'BUY', symbol: 'BTCUSDT', entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120 };
const bar = (i: number, high: number, low: number, open = low, close = high): Candle => [T + i * M30, open, high, low, close];
const mirror = (p: TradePlan, w: Candle[], sell: boolean): [TradePlan, Candle[]] => sell
  ? [{ ...p, recommendation: 'SELL', stopLoss: 105, takeProfit1: 90, takeProfit2: 80 }, w.map(([t, o, h, l, c]): Candle => [t, 200 - o, 200 - l, 200 - h, 200 - c])]
  : [p, w];
const okx = (w: Candle[]) => ({ data: [...w].reverse().map(c => c.map(String)) });
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

for (const sell of [false, true]) for (const rule of ['legacy', 'stop_only'] as FillCandleRule[]) {
  describe(`B3 synthetic ${sell ? 'SELL' : 'BUY'} / ${rule}`, () => {
    const run = (w: Candle[]) => evaluateTrade(...mirror(buy, w, sell), rule);
    it('does not count TP1 in an earlier candle before entry', () => {
      expect(run([bar(0, 112, 106), bar(1, 101, 99), bar(2, 104, 101)]))
        .toMatchObject({ outcome: 'TIMEOUT', fillIndex: 1, resolvedIndex: null });
    });
    it('does not count stop in an earlier candle before entry', () => {
      expect(run([bar(0, 94, 92), bar(1, 101, 99), bar(2, 104, 101)]))
        .toMatchObject({ outcome: 'TIMEOUT', fillIndex: 1 });
    });
    it('never counts a target without an entry range intersection', () => {
      expect(run([bar(0, 111, 104), bar(1, 114, 105)]))
        .toMatchObject({ outcome: 'NO_FILL', fillIndex: null, resolvedIndex: null, afterTp1: null });
    });
    it('keeps stop-first LOSS when stop and TP occur in one later candle', () => {
      expect(run([bar(0, 101, 99), bar(1, 111, 94)]))
        .toMatchObject({ outcome: 'LOSS', fillIndex: 0, resolvedIndex: 1 });
    });
    it('keeps conservative LOSS when entry and stop share a candle', () => {
      expect(run([bar(0, 101, 94)])).toMatchObject({ outcome: 'LOSS', fillIndex: 0, resolvedIndex: 0 });
    });
    it('distinguishes TP1 only in the fill candle, without claiming its intrabar order', () => {
      expect(run([bar(0, 111, 99), bar(1, 104, 101)]).outcome).toBe(rule === 'legacy' ? 'WIN' : 'TIMEOUT');
    });
    it('finds TP1 and TP2 after entry when the sequence is separated', () => {
      expect(run([bar(0, 101, 99), bar(1, 111, 104), bar(2, 121, 112)]))
        .toMatchObject({ outcome: 'WIN', fillIndex: 0, resolvedIndex: 1, afterTp1: { tp2: 'hit', tp2Index: 2 } });
    });
  });
}

describe('B3 synthetic intrabar uncertainty and diagnostic limits', () => {
  it('identical M30 range admits two finer sequences with opposite results', () => {
    const coarse = [bar(0, 111, 99, 105, 101), bar(1, 104, 94)];
    const entryFirst: Candle[] = [[T, 105, 106, 99, 100], [T + 60000, 100, 111, 100, 101], coarse[1]];
    const targetFirst: Candle[] = [[T, 105, 111, 105, 106], [T + 60000, 106, 106, 99, 101], coarse[1]];
    expect(evaluateTrade(buy, entryFirst, 'stop_only').outcome).toBe('WIN');
    expect(evaluateTrade(buy, targetFirst, 'stop_only').outcome).toBe('LOSS');
    expect(evaluateTrade(buy, coarse, 'legacy').outcome).toBe('WIN');
    expect(evaluateTrade(buy, coarse, 'stop_only').outcome).toBe('LOSS');
  });
  it('stop_only cannot determine that an intrabar stop price happened before a stop-entry fill', () => {
    // BUY STOP100: the 95 level was visited before activation in this synthetic finer path.
    const coarse = [bar(0, 111, 94, 96, 111)];
    const finer: Candle[] = [[T, 96, 97, 94, 96], [T + 60000, 96, 101, 96, 100], [T + 120000, 100, 111, 100, 111]];
    expect(evaluateTrade(buy, finer, 'stop_only').outcome).toBe('WIN');
    for (const rule of ['legacy', 'stop_only'] as const) expect(evaluateTrade(buy, coarse, rule).outcome).toBe('LOSS');
  });
  it('entryRetouchIndex may occur after the original stop: not proof of an executable break-even', () => {
    const r = evaluateTrade(buy, [bar(0, 101, 99), bar(1, 111, 104), bar(2, 96, 94), bar(3, 101, 99)]);
    expect(r).toMatchObject({ outcome: 'WIN', afterTp1: { tp2: 'stop', tp2Index: 2, entryRetouchIndex: 3 } });
  });
});

describe('B3 synthetic source/window counterexamples; existing outcomes intentionally unchanged', () => {
  const key = process.env.TWELVE_DATA_API_KEY;
  afterEach(() => { jest.restoreAllMocks(); if (key === undefined) delete process.env.TWELVE_DATA_API_KEY; else process.env.TWELVE_DATA_API_KEY = key; });
  const flat = (n: number, from = 0) => Array.from({ length: n }, (_, i) => bar(from + i, 104, 101, 102, 103));
  it('accepts a candle opening at T+48h whose target occurs strictly after the horizon', async () => {
    const w = flat(97); w[0] = bar(0, 101, 99); w[96] = bar(96, 111, 101, 102, 109);
    jest.spyOn(global, 'fetch').mockResolvedValue(response(okx(w)));
    const actual = (await fetchCryptoWindow('BTC', T, T + H48))!;
    expect(actual.at(-1)?.[0]).toBe(T + H48);
    for (const rule of ['legacy', 'stop_only'] as const) {
      expect(evaluateTrade(buy, actual, rule).outcome).toBe('WIN');
      // Full bars strictly inside the horizon have no TP. This is a counterexample, not a proposed new rule.
      expect(evaluateTrade(buy, actual.filter(c => c[0] < T + H48), rule).outcome).toBe('TIMEOUT');
    }
  });
  it('omits the leading partial M30 candle for an unaligned creation time', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(okx(flat(97))));
    const w = (await fetchCryptoWindow('BTC', T + M30 / 2, T + M30 / 2 + H48))!;
    expect(w[0][0]).toBe(T + M30); // first15 minutes unavailable to evaluator
    expect(w.at(-1)![0] + M30).toBeGreaterThan(T + M30 / 2 + H48);
  });
  it('24 trailing candles suffice for NO_FILL, despite no data for the first36 hours', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(okx(flat(24, 72))));
    const w = (await fetchCryptoWindow('BTC', T, T + H48))!;
    expect(w).toHaveLength(24); expect(w[0][0]).toBe(T + 36 * 3600000);
    expect(evaluateTrade(buy, w).outcome).toBe('NO_FILL');
  });
  it('24 noncontiguous bars suffice for TIMEOUT despite chronological gaps', async () => {
    const w = Array.from({ length: 24 }, (_, i) => bar(i * 4, 104, 101)); w[0] = bar(0, 101, 99);
    jest.spyOn(global, 'fetch').mockResolvedValue(response(okx(w)));
    const actual = (await fetchCryptoWindow('BTC', T, T + H48))!;
    expect(evaluateTrade(buy, actual).outcome).toBe('TIMEOUT');
    expect(actual[1][0] - actual[0][0]).toBe(4 * M30);
  });
  it('counts duplicate rows toward the24 threshold without unique coverage', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(okx(Array.from({ length: 24 }, () => bar(0, 104, 101)))));
    const w = (await fetchCryptoWindow('BTC', T, T + H48))!;
    expect(w).toHaveLength(24); expect(new Set(w.map(c => c[0])).size).toBe(1);
  });
  it('Binance fallback trusts feed order: malformed response can resolve before fill timestamp', async () => {
    const w = [bar(2, 101, 99), bar(1, 111, 104), ...flat(22, 3)];
    jest.spyOn(global, 'fetch').mockImplementation(async url => response(String(url).includes('okx.com') ? { data: [] } : w));
    const actual = (await fetchCryptoWindow('BTC', T, T + H48))!; const r = evaluateTrade(buy, actual);
    expect(r.outcome).toBe('WIN'); expect(actual[r.resolvedIndex!][0]).toBeLessThan(actual[r.fillIndex!][0]);
  });
  it('Twelve Data trusts requested bounds and accepts an out-of-window response', async () => {
    process.env.TWELVE_DATA_API_KEY = 'synthetic-key';
    const w = flat(24); w[0] = bar(0, 101, 99); w.push(bar(97, 111, 104));
    const values = w.map(([ts, o, h, l, c]) => ({ datetime: new Date(ts).toISOString().slice(0, 19).replace('T', ' '), open: String(o), high: String(h), low: String(l), close: String(c) })).reverse();
    jest.spyOn(global, 'fetch').mockResolvedValue(response({ values }));
    const actual = (await fetchFxWindow('XAUUSD', T, T + H48))!;
    expect(actual.at(-1)![0]).toBeGreaterThan(T + H48);
    expect(evaluateTrade({ ...buy, symbol: 'XAUUSD' }, actual).outcome).toBe('WIN');
  });
  it('no feed stays unavailable, not a fabricated NO_FILL window', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);
    expect(await fetchCryptoWindow('BTC', T, T + H48)).toBeNull();
  });
  it('maturity and persisted window are anchored to createdAt, independent of original chart TF', async () => {
    jest.useFakeTimers().setSystemTime(new Date(T + H48 + 1));
    try {
      const w = flat(96); w[0] = bar(0, 101, 99); w[1] = bar(1, 111, 104);
      const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(response(okx(w)));
      const update = jest.fn().mockResolvedValue({});
      const findMany = jest.fn(async (q: any) => q.where.recommendation === 'WAIT' ? [] : [{ id: 'synthetic', createdAt: new Date(T), recommendation: 'BUY', isDemo: false, result: { analysis: { ...buy, timeframe: '4h' } } }]);
      await sweepOnce({ analysis: { findMany, update } } as any);
      expect(findMany.mock.calls[0][0].where).toMatchObject({ outcome: null, status: 'completed', createdAt: { lt: new Date(T + 1) } });
      expect(String(fetch.mock.calls[0][0])).toContain('bar=30m');
      expect(update.mock.calls[0][0].data).toMatchObject({ outcome: 'WIN', outcomeDetail: { evaluatedOn: '30m', windowHours: 48, fillCandleRule: 'stop_only', fillIndex: 0, resolvedIndex: 1 } });
    } finally { jest.useRealTimers(); }
  });
});

describe('B3 synthetic series identity', () => {
  it('nested WAIT shadow rule does not label the root ABSTAIN series or add a decided trade', () => {
    const w = { outcome: 'ABSTAIN', confidence: 50, createdAt: new Date(T), outcomeDetail: { shadow: { fillCandleRule: 'stop_only', outcome: 'WIN' } } };
    expect(fillCandleRuleOf(w.outcomeDetail)).toBe('legacy');
    const split = splitByFillCandleRule([w]);
    expect(split.legacy).toEqual([w]); expect(split.stop_only).toEqual([]);
    expect(tally(split.legacy)).toMatchObject({ n: 0, wins: 0, losses: 0 });
  });
});
