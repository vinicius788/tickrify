import { AIAdapter } from './ai.adapter';
import { classifyCoverageAsset, formatAnalysisDataCoverage } from './analysis-data-coverage';

describe('analysis data coverage', () => {
  it('records only bounded categories and counts', () => {
    const line = formatAnalysisDataCoverage({
      analysisType: 'quick',
      htfImagesRequested: 7,
      htfImagesDelivered: 1,
      assetClass: 'crypto',
      candles: 'stale_withheld',
      marketContext: 'unavailable',
    });
    expect(line).toBe('[AnalysisDataCoverage] ' + JSON.stringify({
      schema: 1,
      analysisType: 'quick',
      htfImagesRequested: 2,
      htfImagesDelivered: 1,
      assetClass: 'crypto',
      candles: 'stale_withheld',
      marketContext: 'unavailable',
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
    adapter.buildCalendarEnrichment = jest.fn().mockResolvedValue(null);
    expect(await adapter.buildMarketEnrichment('chart')).toEqual({
      block: 'MARKET BLOCK', assetClass: 'crypto',
    });
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
