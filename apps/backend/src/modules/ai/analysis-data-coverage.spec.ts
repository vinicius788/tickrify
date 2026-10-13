import { AIAdapter } from './ai.adapter';
import {
  classifyCoverageAsset,
  formatAnalysisDataCoverage,
  saveAnalysisTelemetry,
  telemetryFromAiSource,
  toAnalysisEvidence,
  type GroundingStats,
} from './analysis-data-coverage';
import { EconomicCalendarService } from '../calendar/calendar.service';
import { buildPersistedAnalysisPayload, normalizeStoredAnalysis } from '../../common/utils/analysis-payload';

describe('analysis data coverage', () => {
  afterEach(() => jest.restoreAllMocks());

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

  it('persists only delivered evidence and distinguishes no events from no confirmation', () => {
    const base = {
      analysisType: 'deep' as const,
      htfImagesRequested: 2,
      htfImagesDelivered: 1,
      assetClass: 'crypto' as const,
      candles: 'not_attempted' as const,
      marketContext: 'injected' as const,
      calendar: 'no_events_returned' as const,
    };
    expect(toAnalysisEvidence(base)).toEqual({
      version: 1, additionalChartsDelivered: 1, candleFeedAttached: false,
      marketContextAttached: true, calendar: 'no_events_returned',
    });
    expect(toAnalysisEvidence({ ...base, marketContext: 'timeout', calendar: 'source_degraded' })).toEqual({
      version: 1, additionalChartsDelivered: 1, candleFeedAttached: false,
      marketContextAttached: false, calendar: 'not_confirmed',
    });
  });

  it('keeps the evidence summary through persisted analysis normalization', () => {
    const evidence = toAnalysisEvidence({
      analysisType: 'quick', htfImagesRequested: 1, htfImagesDelivered: 0,
      assetClass: 'crypto', candles: 'injected', marketContext: 'timeout', calendar: 'not_attempted',
    });
    const persisted = buildPersistedAnalysisPayload({
      source: { evidence }, recommendation: 'WAIT', bias: 'neutral',
      confidence: 50, reasoning: 'Sem entrada confirmada',
    });
    const readBack = normalizeStoredAnalysis({ result: persisted.fullResponse });
    expect(readBack.fullResponse.evidence).toEqual(evidence);
    expect(readBack.recommendation).toBe('WAIT');
  });

  it('does not claim multiple timeframes when every extra image fails', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForOpenAi = jest.fn(async (url: string) => {
      if (url === 'broken-htf') throw new Error('unavailable');
      return url;
    });
    const content = await adapter.buildUserContent('primary-chart', ['broken-htf']);
    expect(content.filter((part: { type: string }) => part.type === 'image')).toHaveLength(1);
    expect(content[0].text).not.toContain('MÚLTIPLOS');
  });

  it('retains the top-down instruction when an extra image is delivered', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForOpenAi = jest.fn(async (url: string) => url);
    const content = await adapter.buildUserContent('primary-chart', ['valid-htf']);
    expect(content.filter((part: { type: string }) => part.type === 'image')).toHaveLength(2);
    expect(content[0].text).toContain('MÚLTIPLOS');
  });

  it('numbers only delivered HTF images after an earlier image fails', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForOpenAi = jest.fn(async (url: string) => {
      if (url === 'broken-htf') throw new Error('unavailable');
      return url;
    });
    const content = await adapter.buildUserContent('primary-chart', ['broken-htf', 'valid-htf']);
    expect(content.filter((part: { type: string }) => part.type === 'image')).toHaveLength(2);
    expect(content[0].text).toContain('MÚLTIPLOS');
    expect(content[2].text).toContain('MAIOR 1');
  });

  it('preserves the deep enrichment block while reporting its asset class', async () => {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue('MARKET BLOCK');
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: null, status: 'no_events_returned' });
    expect(await adapter.buildMarketEnrichment('chart')).toEqual({
      block: 'MARKET BLOCK', assetClass: 'crypto', marketContext: 'injected', calendar: 'no_events_returned',
    });
  });

  it('does not count a calendar-only block as market context', async () => {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue(null);
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: 'CALENDAR BLOCK', status: 'events_injected' });
    expect(await adapter.buildMarketEnrichment('chart')).toEqual({
      block: 'CALENDAR BLOCK', assetClass: 'crypto', marketContext: 'unavailable', calendar: 'events_injected',
    });
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
    expect(unavailable).toEqual({
      block: null, candles: 'source_unavailable', marketContext: 'unavailable', assetClass: 'crypto',
      stats: { v: 1, symbol: 'BTCUSDT', interval: '30m', coverage: 'source_unavailable', numbers: null },
    });

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

describe('analysis telemetry', () => {
  const stats: GroundingStats = {
    v: 1, symbol: 'XAUUSD', interval: '15m', coverage: 'injected',
    numbers: {
      candles: 120, lastClose: 4150, windowHigh: 4200, windowLow: 4100, atr14: 6.5, rsi14: 55,
      rangePosPct: 50, momentumPct: 0.1, momentumLookback: 6, swingHighs: [4190], swingLows: [4110],
      relVolumeLast: null, volumeProfile: null,
    },
  };

  it('reads only well-formed telemetry from the adapter response', () => {
    expect(telemetryFromAiSource({ respondedModel: ' gpt-5.6-luna-2026-09-01 ', groundingStats: stats }))
      .toEqual({ respondedModel: 'gpt-5.6-luna-2026-09-01', groundingStats: stats });
    expect(telemetryFromAiSource({ respondedModel: 42, groundingStats: { v: 2 } }))
      .toEqual({ respondedModel: null, groundingStats: null });
    expect(telemetryFromAiSource(null)).toEqual({ respondedModel: null, groundingStats: null });
    expect(telemetryFromAiSource({ respondedModel: 'x'.repeat(300) }).respondedModel).toHaveLength(100);
  });

  it('writes both columns by SQL for the analysis id', async () => {
    const db = { $executeRaw: jest.fn().mockResolvedValue(1) };
    await saveAnalysisTelemetry(db as any, 'analysis-1', { respondedModel: 'gpt-5.6-luna', groundingStats: stats }, jest.fn());
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = db.$executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain('"responseModel" =');
    expect(strings.join('?')).toContain('"groundingStats" =');
    expect(values).toEqual(['gpt-5.6-luna', JSON.stringify(stats), 'analysis-1']);
  });

  it('skips the write when there is nothing to record', async () => {
    const db = { $executeRaw: jest.fn() };
    await saveAnalysisTelemetry(db as any, 'analysis-1', { respondedModel: null, groundingStats: null }, jest.fn());
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('never throws when the column is missing and warns only once', async () => {
    const db = { $executeRaw: jest.fn().mockRejectedValue(new Error('column "responseModel" does not exist')) };
    const warn = jest.fn();
    await expect(saveAnalysisTelemetry(db as any, 'a', { respondedModel: 'm', groundingStats: null }, warn)).resolves.toBeUndefined();
    await expect(saveAnalysisTelemetry(db as any, 'b', { respondedModel: 'm', groundingStats: null }, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
