import { Logger } from '@nestjs/common';
import { AIAdapter, eurUsdContextLine } from './ai.adapter';
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

  it('calendar never fetched (quick, context off) is not_attached, not "not confirmed"', () => {
    const quick = {
      analysisType: 'quick' as const, htfImagesRequested: 0, htfImagesDelivered: 0,
      assetClass: 'crypto' as const, candles: 'injected' as const, marketContext: 'injected' as const,
    };
    expect(toAnalysisEvidence({ ...quick, calendar: 'not_attempted' }).calendar).toBe('not_attached');
    expect(toAnalysisEvidence({ ...quick, analysisType: 'deep', calendar: 'disabled' }).calendar).toBe('not_attached');
    for (const failed of ['source_degraded', 'timeout', 'error', 'symbol_unreadable'] as const) {
      expect(toAnalysisEvidence({ ...quick, analysisType: 'deep', calendar: failed }).calendar).toBe('not_confirmed');
    }
    expect(toAnalysisEvidence({ ...quick, analysisType: 'deep', calendar: 'events_injected' }).calendar).toBe('events_attached');
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
    adapter.resolveImageUrlForModel = jest.fn(async (url: string) => {
      if (url === 'broken-htf') throw new Error('unavailable');
      return url;
    });
    const content = await adapter.buildUserContent('primary-chart', ['broken-htf']);
    expect(content.filter((part: { type: string }) => part.type === 'image')).toHaveLength(1);
    expect(content[0].text).not.toContain('several charts');
  });

  it('retains the top-down instruction when an extra image is delivered', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForModel = jest.fn(async (url: string) => url);
    const content = await adapter.buildUserContent('primary-chart', ['valid-htf']);
    expect(content.filter((part: { type: string }) => part.type === 'image')).toHaveLength(2);
    expect(content[0].text).toContain('several charts');
  });

  it('numbers only delivered HTF images after an earlier image fails', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForModel = jest.fn(async (url: string) => {
      if (url === 'broken-htf') throw new Error('unavailable');
      return url;
    });
    const content = await adapter.buildUserContent('primary-chart', ['broken-htf', 'valid-htf']);
    expect(content.filter((part: { type: string }) => part.type === 'image')).toHaveLength(2);
    expect(content[0].text).toContain('several charts');
    expect(content[2].text).toContain('Higher timeframe chart 1');
  });

  it('preserves the deep enrichment block while reporting its asset class', async () => {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.fetchCandles = jest.fn().mockResolvedValue({ candles: null, source: 'binance', denied: null });
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue('MARKET BLOCK');
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: null, status: 'no_events_returned' });
    expect(await adapter.buildMarketEnrichment('chart')).toEqual({
      block: 'MARKET BLOCK', assetClass: 'crypto', marketContext: 'injected', calendar: 'no_events_returned',
      candles: 'source_unavailable',
      stats: { v: 1, symbol: 'BTCUSDT', interval: '30m', coverage: 'source_unavailable', numbers: null },
    });
  });

  it('does not count a calendar-only block as market context', async () => {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.fetchCandles = jest.fn().mockResolvedValue({ candles: null, source: 'binance', denied: null });
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue(null);
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: 'CALENDAR BLOCK', status: 'events_injected' });
    expect(await adapter.buildMarketEnrichment('chart')).toMatchObject({
      block: 'CALENDAR BLOCK', assetClass: 'crypto', marketContext: 'unavailable', calendar: 'events_injected',
    });
  });

  // 26/10/2026: a deep passou a receber os mesmos candles reais do quick.
  const candles = (last: number) => Array.from({ length: 40 }, (_, i) => [i * 1800000, last - 1, last + 1, last - 2, last, 10]);

  it('deep com print atual recebe os candles reais, o contexto e o calendario numa leitura so', async () => {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 100 });
    adapter.fetchCandles = jest.fn().mockResolvedValue({ candles: candles(100), source: 'binance', denied: null });
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue('MARKET BLOCK');
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: 'CALENDAR BLOCK', status: 'events_injected' });
    const deep = await adapter.buildMarketEnrichment('chart');
    expect(deep.block).toContain('# REAL DATA (');
    expect(deep.block).toContain('MARKET BLOCK');
    expect(deep.block).toContain('CALENDAR BLOCK');
    expect(deep).toMatchObject({ candles: 'injected', marketContext: 'injected', stats: { coverage: 'injected', numbers: { candles: 40, lastClose: 100 } } });
    expect(adapter.extractSymbol).toHaveBeenCalledTimes(1);
  });

  it('deep com print velho retem candles e contexto de agora, e avisa', async () => {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '30m', lastPrice: 150 });
    adapter.fetchCandles = jest.fn().mockResolvedValue({ candles: candles(100), source: 'binance', denied: null });
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue('MARKET BLOCK');
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue({ block: null, status: 'no_events_returned' });
    const deep = await adapter.buildMarketEnrichment('chart');
    expect(deep.block).toContain('# LIVE DATA WITHHELD');
    expect(deep.block).not.toContain('# REAL DATA (');
    expect(deep.block).not.toContain('MARKET BLOCK');
    expect(adapter.buildCryptoEnrichment).not.toHaveBeenCalled();
    expect(deep).toMatchObject({ candles: 'stale_withheld', marketContext: 'stale_withheld', stats: { numbers: null } });
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
    adapter.fetchCandles = jest.fn().mockResolvedValue({ candles: null, source: 'binance', denied: null });
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue(null);
    const unavailable = await adapter.buildQuickGrounding('chart');
    expect(unavailable).toEqual({
      block: null, candles: 'source_unavailable', marketContext: 'unavailable', assetClass: 'crypto',
      stats: { v: 1, symbol: 'BTCUSDT', interval: '30m', coverage: 'source_unavailable', numbers: null },
      calendar: 'not_attempted',
    });

    adapter.fetchCandles.mockResolvedValue({ candles: Array.from({ length: 30 }, (_, i) => [i, 100, 102, 98, 100, 1]), source: 'binance', denied: null });
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

describe('leitura do ativo que estoura o tempo (09/11/2026)', () => {
  const build = (complete: jest.Mock) => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForModel = jest.fn(async () => 'data:image/png;base64,AAAA');
    adapter.visionModel = { complete };
    return adapter;
  };
  const timedOut = () => jest.fn(async () => { throw new Error('AI request timed out after 20s'); });

  it('pede a leitura com teto de 20 s', async () => {
    const complete = jest.fn(async () => ({ content: '{"symbol":"XAUUSD","timeframe":"5m"}' }));
    await build(complete).extractSymbol('chart');
    expect((complete.mock.calls[0] as any[])[0].timeoutMs).toBe(20_000);
  });

  it('loga o estouro e grava o motivo no groundingStats, no quick', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const result = await build(timedOut()).buildQuickGrounding('chart');
    expect(result.candles).toBe('symbol_timeout');
    expect(result.stats).toEqual({ v: 1, symbol: '', interval: null, coverage: 'symbol_timeout', numbers: null });
    expect((warn.mock.calls as unknown[][]).some(([m]) => /^\[grounding\] extractSymbol timeout ms=\d+$/.test(String(m)))).toBe(true);
    warn.mockRestore();
  });

  it('grava o mesmo motivo no deep', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const result = await build(timedOut()).buildMarketEnrichment('chart');
    expect(result.candles).toBe('symbol_timeout');
    expect(result.stats?.coverage).toBe('symbol_timeout');
    warn.mockRestore();
  });

  it('erro que nao e tempo continua como ilegivel e sem log de timeout', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const result = await build(jest.fn(async () => { throw new Error('bad json'); })).buildQuickGrounding('chart');
    expect(result.candles).toBe('symbol_unreadable');
    expect(result.stats?.coverage).toBe('symbol_unreadable');
    expect((warn.mock.calls as unknown[][]).some(([m]) => String(m).includes('[grounding]'))).toBe(false);
    warn.mockRestore();
  });

  it('a tela sabe que foi o tempo; os outros motivos seguem como antes', () => {
    const base = { analysisType: 'quick', htfImagesRequested: 0, htfImagesDelivered: 0, assetClass: 'unknown', marketContext: 'unavailable', calendar: 'not_attempted' } as const;
    expect(toAnalysisEvidence({ ...base, candles: 'symbol_timeout' }).candleFailure).toBe('read_timeout');
    expect(toAnalysisEvidence({ ...base, candles: 'timeout' }).candleFailure).toBe('read_timeout');
    expect(toAnalysisEvidence({ ...base, candles: 'provider_quota' })).not.toHaveProperty('candleFailure');
  });
});

describe('extractSymbol: le o print do Storage privado (26/10/2026)', () => {
  const storageUrl = 'https://proj.supabase.co/storage/v1/object/analysis-images/analyses/u1/original/x.png';

  it('manda ao modelo a imagem resolvida, nunca a URL crua do Storage', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForModel = jest.fn(async () => 'data:image/png;base64,AAAA');
    const complete = jest.fn(async () => ({ content: '{"symbol":"XAUUSD","timeframe":"15m","lastPrice":2400.5}' }));
    adapter.visionModel = { complete };
    await expect(adapter.extractSymbol(storageUrl)).resolves.toEqual({ symbol: 'XAUUSD', timeframe: '15m', lastPrice: 2400.5 });
    expect(adapter.resolveImageUrlForModel).toHaveBeenCalledWith(storageUrl);
    const sent = (complete.mock.calls[0] as any[])[0].userContent.find((p: { type: string }) => p.type === 'image');
    expect(sent.url).toBe('data:image/png;base64,AAAA');
  });

  it('le com o modelo do quick e a imagem em detalhe alto (26/10/2026: o mini low errava 36 de 97)', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForModel = jest.fn(async () => 'data:image/png;base64,AAAA');
    const complete = jest.fn(async () => ({ content: '{"symbol":"XAUUSD","timeframe":"5m","lastPrice":4012.05}' }));
    adapter.visionModel = { complete };
    await adapter.extractSymbol(storageUrl);
    const req = (complete.mock.calls[0] as any[])[0];
    expect(req.tier).toBe('quick');
    expect(req.imageDetail ?? 'high').toBe('high');
    expect(req.reasoningEffort).toBeUndefined();
    expect(req.maxTokens).toBeGreaterThanOrEqual(2000);
  });

  it.each(['GOLD', 'GOLD#', 'gold', 'GOLDm', 'GOLD.pro', 'GOLD-P'])('nome de corretora do ouro %s vira XAUUSD', async (read) => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForModel = jest.fn(async () => 'data:image/png;base64,AAAA');
    adapter.visionModel = { complete: jest.fn(async () => ({ content: JSON.stringify({ symbol: read, timeframe: '1h', lastPrice: 4100 }) })) };
    await expect(adapter.extractSymbol(storageUrl)).resolves.toEqual({ symbol: 'XAUUSD', timeframe: '1h', lastPrice: 4100 });
  });

  it.each(['GOLDUSDT', 'GOLDEN', 'XAUUSDm', 'BTCUSDT'])('%s nao passa pelo alias do ouro', async (read) => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForModel = jest.fn(async () => 'data:image/png;base64,AAAA');
    adapter.visionModel = { complete: jest.fn(async () => ({ content: JSON.stringify({ symbol: read, timeframe: '1h', lastPrice: 1 }) })) };
    await expect(adapter.extractSymbol(storageUrl)).resolves.toMatchObject({ symbol: read });
  });

  it('falha ao baixar a imagem vira null (analise segue sem candles), sem lancar', async () => {
    const adapter = new AIAdapter() as any;
    adapter.resolveImageUrlForModel = jest.fn(async () => { throw new Error('Failed to download image from Supabase'); });
    adapter.visionModel = { complete: jest.fn() };
    await expect(adapter.extractSymbol(storageUrl)).resolves.toBeNull();
    expect(adapter.visionModel.complete).not.toHaveBeenCalled();
  });
});

describe('bloco de forex/metais: EUR/USD com a direcao certa do dolar', () => {
  it('EUR/USD subindo = dolar enfraquecendo; caindo = fortalecendo; perto de zero = estavel', () => {
    expect(eurUsdContextLine({ eurusd: 1.1216, changePct: 0.5919 })).toBe('EUR/USD 1.1216, up 0.59% in 7 days: dollar weakening');
    expect(eurUsdContextLine({ eurusd: 1.115, changePct: -0.5884 })).toBe('EUR/USD 1.1150, down 0.59% in 7 days: dollar strengthening');
    expect(eurUsdContextLine({ eurusd: 1.12, changePct: 0.1 })).toBe('EUR/USD 1.1200, up 0.10% in 7 days: dollar roughly flat');
  });

  const adapterWith = (usd: { eurusd: number; changePct: number } | null, dgs10: number | null) => {
    const adapter = new AIAdapter() as any;
    adapter.fetchUsdContext = jest.fn(async () => usd);
    adapter.fetchFredLatest = jest.fn(async () => dgs10);
    return adapter;
  };

  it('ouro recebe a linha do EUR/USD pelo nome, nunca "dollar" sozinho nem a direcao antiga', async () => {
    const adapter = adapterWith({ eurusd: 1.1216, changePct: 0.5919 }, 4.94);
    const block: string = await adapter.buildFxEnrichment('XAUUSD');
    expect(block).toContain('- EUR/USD 1.1216, up 0.59% in 7 days: dollar weakening');
    expect(block).not.toContain('proxy EUR/USD');
    expect(block).not.toContain('fortalecendo');
    expect(block).toContain('4.94%');
  });

  it('o proprio EURUSD (com ou sem sufixo de corretora) nao recebe o EUR/USD como contexto', async () => {
    for (const symbol of ['EURUSD', 'EURUSDm', 'EURUSD.pro']) {
      const adapter = adapterWith({ eurusd: 1.1216, changePct: 0.5919 }, 4.94);
      const block: string = await adapter.buildFxEnrichment(symbol);
      expect(adapter.fetchUsdContext).not.toHaveBeenCalled();
      expect(block).not.toContain('EUR/USD 1.1216');
      expect(block).toContain('4.94%');
    }
    expect(await adapterWith(null, null).buildFxEnrichment('EURUSD')).toBeNull();
  });

  it('outros pares seguem recebendo o EUR/USD (nao sao o proprio ativo)', async () => {
    for (const symbol of ['GBPUSD', 'EURJPY', 'USDJPY']) {
      const block: string = await adapterWith({ eurusd: 1.115, changePct: -0.5884 }, null).buildFxEnrichment(symbol);
      expect(block).toContain('EUR/USD 1.1150, down 0.59% in 7 days: dollar strengthening');
    }
  });
});

