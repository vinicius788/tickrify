import { createHash } from 'crypto';
import { AIAdapter, buildRealDataBlock } from './ai.adapter';

const responseFor = (takeProfit1: number) => ({
  model: 'gpt-5.6-luna',
  choices: [{
    finish_reason: 'stop',
    message: { content: JSON.stringify({
      is_financial_chart: true,
      recommendation: 'BUY',
      confidence: 70,
      analysis: {
        symbol: 'TEST', timeframe: '30m', currentPrice: 100,
        entry: 100, stopLoss: 95, takeProfit1, takeProfit2: 120,
        marketStructure: { bias: 'bullish' },
        trendStrength: 'moderate', factorsPresent: 6,
      },
    }) },
  }],
});

describe('AIAdapter trade-plan integrity', () => {
  const oldGrounding = process.env.ENABLE_QUICK_GROUNDING;
  const oldNews = process.env.ENABLE_NEWS_GUARD;

  beforeEach(() => {
    process.env.ENABLE_QUICK_GROUNDING = 'false';
    process.env.ENABLE_NEWS_GUARD = 'false';
  });
  afterAll(() => {
    if (oldGrounding === undefined) delete process.env.ENABLE_QUICK_GROUNDING;
    else process.env.ENABLE_QUICK_GROUNDING = oldGrounding;
    if (oldNews === undefined) delete process.env.ENABLE_NEWS_GUARD;
    else process.env.ENABLE_NEWS_GUARD = oldNews;
  });

  it('rejects a BUY whose TP1 is below entry, even when TP2 looks attractive', async () => {
    const adapter = new AIAdapter();
    const create = jest.fn().mockResolvedValue(responseFor(90));
    (adapter as any).openai = { chat: { completions: { create } } };

    await expect(adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick'))
      .rejects.toMatchObject({ code: 'invalid_trade_plan', retriable: false });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('preserves a coherent BUY plan', async () => {
    const adapter = new AIAdapter();
    (adapter as any).openai = { chat: { completions: { create: jest.fn().mockResolvedValue(responseFor(110)) } } };

    const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
    expect(result.recommendation).toBe('BUY');
    expect(result.analysis?.riskRewardTp1).toBe(2);
    expect(result.analysis?.riskRewardTp2).toBe(4);
  });

  it('reports the model that actually answered and no grounding when it is off', async () => {
    const adapter = new AIAdapter();
    (adapter as any).openai = { chat: { completions: { create: jest.fn().mockResolvedValue(responseFor(110)) } } };

    const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
    expect(result.respondedModel).toBe('gpt-5.6-luna');
    expect(result.groundingStats).toBeNull();
  });
});

// Candles deterministicos (130 de 1h). Com volume, um pico no candle 125.
function fixedCandles(withVolume: boolean): number[][] {
  const out: number[][] = [];
  let p = 2650;
  for (let i = 0; i < 130; i++) {
    const o = p;
    const c = o + Math.sin(i / 5) * 4 + (i % 7) - 3;
    const h = Math.max(o, c) + 1.5 + (i % 3);
    const l = Math.min(o, c) - 1.2 - (i % 4) * 0.5;
    out.push([1_790_000_000_000 + i * 3_600_000, o, h, l, c, withVolume ? 100 + ((i * 37) % 90) + (i === 125 ? 600 : 0) : 0]);
    p = c;
  }
  return out;
}

describe('buildRealDataBlock', () => {
  // Impressao digital do texto que vai ao prompt, tirada ANTES de a funcao
  // passar a devolver os numeros (12/10/2026). O backtest-runner usa este mesmo
  // texto: se mudar, o prompt de producao mudou junto. Mudanca de proposito
  // atualiza o hash aqui no mesmo commit.
  it('keeps the prompt text byte-identical', () => {
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    const vol = buildRealDataBlock('XAUUSD', '1h', fixedCandles(true))!;
    const noVol = buildRealDataBlock('EURUSD', '1h', fixedCandles(false))!;
    expect(vol.block).toHaveLength(2437);
    expect(sha(vol.block)).toBe('11911f57b3850ab02308978d3ff1590e5334e44baf5773e9633b02594ccc7b13');
    expect(noVol.block).toHaveLength(2061);
    expect(sha(noVol.block)).toBe('9185ee81d30b5d0973e1fb167e1bb18e8b2184e19af9d165e68f81282568d21c');
  });

  it('returns the same numbers the text shows', () => {
    const { block, numbers } = buildRealDataBlock('XAUUSD', '1h', fixedCandles(true))!;
    const fmt = (n: number) => String(Number(n.toPrecision(6)));
    expect(numbers.candles).toBe(120);
    expect(block).toContain(`current price (last close): ${fmt(numbers.lastClose!)}`);
    expect(block).toContain(`Average candle range (ATR14): ${fmt(numbers.atr14!)}`);
    expect(block).toContain(`Momentum (RSI14): ${Math.round(numbers.rsi14!)}`);
    expect(block).toContain(`Price sits at ${Math.round(numbers.rangePosPct!)}% of the visible range`);
    expect(block).toContain(`Recent swing highs: ${numbers.swingHighs.map(fmt).join(', ')}`);
    expect(block).toContain(`Recent swing lows: ${numbers.swingLows.map(fmt).join(', ')}`);
    expect(numbers.volumeProfile).not.toBeNull();
    expect(numbers.relVolumeLast).not.toBeNull();

    const fx = buildRealDataBlock('EURUSD', '1h', fixedCandles(false))!.numbers;
    expect(fx.volumeProfile).toBeNull();
    expect(fx.relVolumeLast).toBeNull();
  });

  it('returns null below 20 candles', () => {
    expect(buildRealDataBlock('XAUUSD', '1h', fixedCandles(true).slice(0, 19))).toBeNull();
  });
});

describe('AIAdapter quick grounding stats', () => {
  const oldKey = process.env.TWELVE_DATA_API_KEY;
  afterAll(() => {
    if (oldKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
    else process.env.TWELVE_DATA_API_KEY = oldKey;
  });

  function adapterWith(candles: number[][] | null, lastPrice: number | null) {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', timeframe: '1H', lastPrice });
    adapter.fetchCryptoCandles = jest.fn().mockResolvedValue(candles);
    adapter.buildCryptoEnrichment = jest.fn().mockResolvedValue(null);
    return adapter;
  }

  it('carries the numbers that went into the prompt', async () => {
    const candles = fixedCandles(true);
    const adapter = adapterWith(candles, candles[candles.length - 1][4]);
    const g = await adapter.buildQuickGrounding('data:image/png;base64,AA==');
    expect(g.candles).toBe('injected');
    expect(g.stats).toMatchObject({ v: 1, symbol: 'BTCUSDT', interval: '1h', coverage: 'injected' });
    expect(g.stats.numbers).toEqual(buildRealDataBlock('BTCUSDT', '1h', candles)!.numbers);
  });

  it('keeps no numbers when a stale screenshot withholds the candles', async () => {
    const adapter = adapterWith(fixedCandles(true), 1);
    const g = await adapter.buildQuickGrounding('data:image/png;base64,AA==');
    expect(g.candles).toBe('stale_withheld');
    expect(g.stats).toMatchObject({ v: 1, coverage: 'stale_withheld', numbers: null });
  });

  it('has no stats when the symbol cannot be read', async () => {
    const adapter = new AIAdapter() as any;
    adapter.extractSymbol = jest.fn().mockResolvedValue(null);
    const g = await adapter.buildQuickGrounding('data:image/png;base64,AA==');
    expect(g.stats).toBeNull();
  });
});
