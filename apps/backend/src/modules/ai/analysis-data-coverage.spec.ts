import { AIAdapter, hasRecentComparableCryptoCandles } from './ai.adapter';
import { classifyCoverageAsset, formatAnalysisDataCoverage } from './analysis-data-coverage';
import { EconomicCalendarService } from '../calendar/calendar.service';

describe('analysis data coverage', () => {
  const originalDeepGuard = process.env.ENABLE_DEEP_CRYPTO_GROUNDING;
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalDeepGuard === undefined) delete process.env.ENABLE_DEEP_CRYPTO_GROUNDING;
    else process.env.ENABLE_DEEP_CRYPTO_GROUNDING = originalDeepGuard;
  });

  const cryptoCandles = (now: number) => Array.from({ length: 30 }, (_, index) => [
    now - (30 - index) * 1_800_000, 100, 102, 98, 100, 1,
  ]);

  it('accepts only recent and comparable crypto candles for a temporal check', () => {
    const now = Date.now();
    const valid = cryptoCandles(now);
    expect(hasRecentComparableCryptoCandles(valid, '30m', now)).toBe(true);
    expect(hasRecentComparableCryptoCandles(valid, 'unknown', now)).toBe(false);
    expect(hasRecentComparableCryptoCandles(cryptoCandles(now - 4 * 3_600_000), '30m', now)).toBe(false);
    expect(hasRecentComparableCryptoCandles(cryptoCandles(now + 40 * 60_000), '30m', now)).toBe(false);
    expect(hasRecentComparableCryptoCandles([...valid.slice(0, -1), [now + 60_000, 100, 102, 98, 100, 1]], '30m', now)).toBe(false);
    expect(hasRecentComparableCryptoCandles([...valid.slice(0, -1), [valid.at(-1)![0], 100, 90, 98, 100, 1]], '30m', now)).toBe(false);
    expect(hasRecentComparableCryptoCandles([[valid[0][0], 100, 90, 98, 100, 1], ...valid.slice(1)], '30m', now)).toBe(false);
  });

  it('records only bounded categories and counts', () => {
    const line = formatAnalysisDataCoverage({
      analysisType: 'quick',
      htfImagesRequested: 7,
      htfImagesDelivered: 1,
      assetClass: 'crypto',
      candles: 'stale_withheld',
      marketContext: 'unavailable',
      calendar: 'not_attempted',
    });
    expect(line).toBe('[AnalysisDataCoverage] ' + JSON.stringify({
      schema: 2,
      analysisType: 'quick',
      htfImagesRequested: 2,
      htfImagesDelivered: 1,
      assetClass: 'crypto',
      candles: 'stale_withheld',
      marketContext: 'unavailable',
      calendar: 'not_attempted',
    }));
  });

  it('groups assets without exposing the extracted ticker', () => {
    expect(classifyCoverageAsset('BTCUSDT', true)).toBe('crypto');
    expect(classifyCoverageAsset('XAUUSD', false)).toBe('metal');
    expect(classifyCoverageAsset('EURUSD', false)).toBe('forex');
    expect(classifyCoverageAsset('NAS100', false)).toBe('index');
  });

  it('does not claim multiple timeframes when every extra image fails', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForOpenAi = jest.fn(async (url: string) => {
      if (url === 'broken-htf') throw new Error('unavailable');
      return url;
    });
    const content = await adapter.buildUserContent('primary-chart', ['broken-htf']);
    expect(content.filter((part: { type: string }) => part.type === 'image_url')).toHaveLength(1);
    expect(content[0].text).not.toContain('MÚLTIPLOS');
  });

  it('retains the top-down instruction when an extra image is delivered', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForOpenAi = jest.fn(async (url: string) => url);
    const content = await adapter.buildUserContent('primary-chart', ['valid-htf']);
    expect(content.filter((part: { type: string }) => part.type === 'image_url')).toHaveLength(2);
    expect(content[0].text).toContain('MÚLTIPLOS');
  });

  it('numbers only delivered HTF images after an earlier image fails', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForOpenAi = jest.fn(async (url: string) => {
      if (url === 'broken-htf') throw new Error('unavailable');
      return url;
    });
    const content = await adapter.buildUserContent('primary-chart', ['broken-htf', 'valid-htf']);
    expect(content.filter((part: { type: string }) => part.type === 'image_url')).toHaveLength(2);
    expect(content[0].text).toContain('MÚLTIPLOS');
    expect(content[2].text).toContain('MAIOR 1');
  });

  it('preserves the deep enrichment block while reporting its asset class', async () => {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue('MARKET BLOCK');
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: null, status: 'no_events_returned' });
    expect(await adapter.buildMarketEnrichment('chart')).toEqual({
      block: 'MARKET BLOCK', assetClass: 'crypto', candles: 'not_attempted', marketContext: 'injected', calendar: 'no_events_returned',
    });
  });

  it('does not count a calendar-only block as market context', async () => {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue(null);
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: 'CALENDAR BLOCK', status: 'events_injected' });
    expect(await adapter.buildMarketEnrichment('chart')).toEqual({
      block: 'CALENDAR BLOCK', assetClass: 'crypto', candles: 'not_attempted', marketContext: 'unavailable', calendar: 'events_injected',
    });
  });

  it('keeps existing deep enrichment and avoids extra candle calls with the guard off', async () => {
    process.env.ENABLE_DEEP_CRYPTO_GROUNDING = 'false';
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.fetchCryptoCandles = jest.fn();
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue('MARKET BLOCK');
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: 'CALENDAR BLOCK', status: 'events_injected' });
    const result = await adapter.buildMarketEnrichment('chart');
    expect(result.block).toBe('MARKET BLOCK\n\nCALENDAR BLOCK');
    expect(adapter.fetchCryptoCandles).not.toHaveBeenCalled();
  });

  it('does not change non-crypto deep enrichment when the crypto guard is on', async () => {
    process.env.ENABLE_DEEP_CRYPTO_GROUNDING = 'true';
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'EURUSD', timeframe: '30m', lastPrice: 1.2 });
    adapter.fetchCryptoCandles = jest.fn();
    adapter.buildFxEnrichment = jest.fn().mockResolvedValue('FX BLOCK');
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: 'CALENDAR BLOCK', status: 'events_injected' });
    expect(await adapter.buildMarketEnrichment('chart')).toEqual({
      block: 'FX BLOCK\n\nCALENDAR BLOCK',
      assetClass: 'forex', candles: 'not_attempted', marketContext: 'injected', calendar: 'events_injected',
    });
    expect(adapter.fetchCryptoCandles).not.toHaveBeenCalled();
  });

  it('withholds current deep crypto context and calendar for stale or unverified charts', async () => {
    process.env.ENABLE_DEEP_CRYPTO_GROUNDING = 'true';
    const adapter = new AIAdapter() as any;
    const now = Date.now();
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.fetchCryptoCandles = jest.fn().mockResolvedValue(cryptoCandles(now));
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue('MARKET BLOCK');
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: 'CALENDAR BLOCK', status: 'events_injected' });

    const current = await adapter.buildMarketEnrichment('chart');
    expect(current.block).toContain('# REAL MARKET DATA');
    expect(current.block).toContain('MARKET BLOCK\n\nCALENDAR BLOCK');
    expect(current.candles).toBe('injected');
    expect(current.marketContext).toBe('injected');
    expect(current.calendar).toBe('events_injected');

    adapter.buildCryptoEnrichment.mockClear();
    adapter.buildCalendarEnrichment.mockClear();
    adapter.extractSymbol.mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 70 });
    const old = await adapter.buildMarketEnrichment('chart');
    expect(old.marketContext).toBe('stale_withheld');
    expect(old.calendar).toBe('stale_withheld');
    expect(old.candles).toBe('stale_withheld');
    expect(old.block).toContain('CURRENT MARKET DATA WITHHELD');
    expect(adapter.buildCryptoEnrichment).not.toHaveBeenCalled();
    expect(adapter.buildCalendarEnrichment).not.toHaveBeenCalled();

    adapter.fetchCryptoCandles.mockClear();
    adapter.extractSymbol.mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: null });
    const unreadable = await adapter.buildMarketEnrichment('chart');
    expect(unreadable.marketContext).toBe('unverified_withheld');
    expect(unreadable.calendar).toBe('unverified_withheld');
    expect(unreadable.candles).toBe('unverified_withheld');
    expect(adapter.fetchCryptoCandles).not.toHaveBeenCalled();

    adapter.extractSymbol.mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.fetchCryptoCandles.mockResolvedValue(cryptoCandles(now - 4 * 3_600_000));
    const staleFeed = await adapter.buildMarketEnrichment('chart');
    expect(staleFeed.marketContext).toBe('unverified_withheld');
    expect(staleFeed.calendar).toBe('unverified_withheld');
    expect(staleFeed.candles).toBe('source_unavailable');
  });

  it('distinguishes calendar events, no returned events and degraded source', async () => {
    const getEvents = jest.spyOn(EconomicCalendarService.prototype, 'getEventsForSymbol');
    const adapter = new AIAdapter() as any;
    getEvents.mockResolvedValueOnce({ events: [], degraded: false });
    expect(await adapter.buildCalendarEnrichment('EURUSD')).toEqual({ block: null, status: 'no_events_returned' });
    getEvents.mockResolvedValueOnce({ events: [], degraded: true });
    expect(await adapter.buildCalendarEnrichment('EURUSD')).toEqual({ block: null, status: 'source_degraded' });
    getEvents.mockResolvedValueOnce({ events: [{ title: 'CPI', country: 'USD', date: '2026-09-23', time: '8:30am', impact: 'High' }], degraded: false });
    const result = await adapter.buildCalendarEnrichment('EURUSD');
    expect(result.status).toBe('events_injected');
    expect(result.block).toContain('CPI');
  });

  it('distinguishes missing candles from a stale chart without network calls', async () => {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.fetchCryptoCandles = jest.fn().mockResolvedValue(null);
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue(null);
    const unavailable = await adapter.buildQuickGrounding('chart');
    expect(unavailable).toEqual({ block: null, candles: 'source_unavailable', marketContext: 'unavailable', assetClass: 'crypto' });

    adapter.fetchCryptoCandles.mockResolvedValue(Array.from({ length: 30 }, (_, i) => [i, 100, 102, 98, 100, 1]));
    adapter.detectStaleChart = jest.fn().mockReturnValue('chart differs from current feed');
    adapter.buildCryptoEnrichment.mockClear().mockResolvedValue('LIVE CONTEXT');
    const stale = await adapter.buildQuickGrounding('chart');
    expect(stale.candles).toBe('stale_withheld');
    expect(stale.marketContext).toBe('stale_withheld');
    expect(stale.block).toContain('# LIVE DATA WITHHELD');
    expect(stale.block).not.toContain('LIVE CONTEXT');
    expect(adapter.buildCryptoEnrichment).not.toHaveBeenCalled();

    adapter.detectStaleChart.mockReturnValue(null);
    const injected = await adapter.buildQuickGrounding('chart');
    expect(injected.candles).toBe('injected');
    expect(injected.marketContext).toBe('injected');
    expect(injected.block).toContain('BTCUSDT');
    expect(injected.block).toContain('LIVE CONTEXT');
  });
});
