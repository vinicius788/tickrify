import { createHash } from 'crypto';
import { AIAdapter, buildRealDataBlock } from './ai.adapter';
import { FallbackVisionModel, OpenAiVisionModel, type VisionModel } from './vision-model';

// A analise chama o modelo so pela interface do provedor; o fake fica no
// cliente da OpenAI para exercitar a implementacao real (mensagens, parse).
function withFakeOpenAi(adapter: AIAdapter, create: jest.Mock): void {
  (adapter as any).visionModel = new FallbackVisionModel(
    new OpenAiVisionModel({ chat: { completions: { create } } } as any),
    null,
  );
}

const responseFor = (takeProfit1: number, extra: Record<string, unknown> = {}) => ({
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
        ...extra,
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

  it('rejects a BUY whose TP1 is below entry after ONE retry, even when TP2 looks attractive', async () => {
    const adapter = new AIAdapter();
    const create = jest.fn().mockResolvedValue(responseFor(90));
    withFakeOpenAi(adapter, create);

    await expect(adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick'))
      .rejects.toMatchObject({ code: 'invalid_trade_plan', retriable: false });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('keeps the retry answer when the second plan is coherent', async () => {
    const adapter = new AIAdapter();
    const create = jest.fn()
      .mockResolvedValueOnce(responseFor(90))
      .mockResolvedValueOnce(responseFor(110));
    withFakeOpenAi(adapter, create);

    const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.recommendation).toBe('BUY');
    expect(result.analysis?.takeProfit1).toBe(110);
    expect(result.engineMeta?.provider).toBe('openai');
  });

  it('treats a BUY without a stop as a broken plan (retry, then fail)', async () => {
    const adapter = new AIAdapter();
    const create = jest.fn().mockResolvedValue(responseFor(110, { stopLoss: null }));
    withFakeOpenAi(adapter, create);

    await expect(adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick'))
      .rejects.toMatchObject({ code: 'invalid_trade_plan' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('retries once when the answer is not valid JSON', async () => {
    const adapter = new AIAdapter();
    const broken = { model: 'gpt-5.6-luna', choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] };
    const create = jest.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(responseFor(110));
    withFakeOpenAi(adapter, create);

    const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.recommendation).toBe('BUY');
  });

  it.each([
    [15533.4, 1.67, 'BUY', true],
    [15532.4, 1.11, 'WAIT', true],
    [15532.56, 1.2, 'BUY', true],
    [15532.4, 1.11, 'BUY', false],
  ] as const)('keeps scaled R and the existing guard: TP2=%s, R2=%s, decision=%s, guard=%s', async (takeProfit2, r2, decision, enabled) => {
    const oldRr = process.env.ENABLE_RR_GUARD;
    process.env.ENABLE_RR_GUARD = String(enabled);
    try {
      const adapter = new AIAdapter();
      const create = jest.fn().mockResolvedValue(responseFor(15531.6, {
        symbol: 'USDJPY', currentPrice: 15531.8, entry: 15530.4, stopLoss: 15528.6, takeProfit2,
      }));
      withFakeOpenAi(adapter, create);
      const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
      expect(create).toHaveBeenCalledTimes(1);
      expect(result.analysis?.entry).toBe(15530.4 * 0.01);
      expect(result.analysis?.stopLoss).toBe(15528.6 * 0.01);
      expect(result.analysis?.riskRewardTp1).toBe(0.67);
      expect(result.analysis?.riskRewardTp2).toBe(r2);
      expect(result.recommendation).toBe(decision);
      if (decision === 'WAIT') expect(result.confidence).toBeLessThanOrEqual(45);
    } finally {
      if (oldRr === undefined) delete process.env.ENABLE_RR_GUARD;
      else process.env.ENABLE_RR_GUARD = oldRr;
    }
  });

  it.each(['HOLD', 'BUY', 'BROKEN_BUY'])('rejects a non-chart %s before confidence floors or plan retries', async (kind) => {
    const response = responseFor(kind === 'BROKEN_BUY' ? 90 : 110);
    const body = JSON.parse(response.choices[0].message.content);
    body.is_financial_chart = false;
    body.confidence = 0;
    if (kind === 'HOLD') {
      body.recommendation = 'HOLD';
      for (const key of ['entry', 'stopLoss', 'takeProfit1', 'takeProfit2']) body.analysis[key] = null;
    }
    response.choices[0].message.content = JSON.stringify(body);
    const adapter = new AIAdapter();
    const create = jest.fn().mockResolvedValue(response);
    withFakeOpenAi(adapter, create);
    await expect(adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick'))
      .rejects.toMatchObject({ code: 'non_chart_image', retriable: false });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([true, undefined, null, 'false'])('preserves only a boolean chart classification: %s', async (value) => {
    const response = responseFor(110);
    const body = JSON.parse(response.choices[0].message.content);
    if (value === undefined) delete body.is_financial_chart;
    else body.is_financial_chart = value;
    response.choices[0].message.content = JSON.stringify(body);
    const adapter = new AIAdapter();
    const create = jest.fn().mockResolvedValue(response);
    withFakeOpenAi(adapter, create);
    const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.recommendation).toBe('BUY');
    expect(result.analysis?.entry).toBe(100);
    expect(result.analysis?.riskRewardTp2).toBe(4);
    if (value === true) expect(result.rawResponse).toHaveProperty('is_financial_chart', true);
    else expect(result.rawResponse).not.toHaveProperty('is_financial_chart');
  });

  it('preserves a coherent BUY plan', async () => {
    const adapter = new AIAdapter();
    withFakeOpenAi(adapter, jest.fn().mockResolvedValue(responseFor(110)));

    const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
    expect(result.recommendation).toBe('BUY');
    expect(result.analysis?.riskRewardTp1).toBe(2);
    expect(result.analysis?.riskRewardTp2).toBe(4);
    expect(result.engineMeta?.validatorAction).toBe('none');
    expect(result.engineMeta?.modelMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps a BUY whose stop sits before the invalidation level and only flags it (measure-only rule)', async () => {
    const adapter = new AIAdapter();
    withFakeOpenAi(adapter, jest.fn().mockResolvedValue(responseFor(110, { invalidationLevel: 94 })));

    const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
    expect(result.recommendation).toBe('BUY');
    expect(result.engineMeta).toMatchObject({
      validatorAction: 'none',
      validatorReasons: [],
      validatorFlags: ['stop_inside_invalidation'],
    });
  });

  it('turns a BUY with an absurd target (extra digit) into WAIT, keeping the levels', async () => {
    const adapter = new AIAdapter();
    withFakeOpenAi(adapter, jest.fn().mockResolvedValue(responseFor(110, { takeProfit2: 1200 })));

    const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
    expect(result.recommendation).toBe('WAIT');
    expect(result.confidence).toBeLessThanOrEqual(45);
    expect(result.analysis?.takeProfit2).toBe(1200);
    expect(result.engineMeta).toMatchObject({
      validatorAction: 'downgraded',
      validatorReasons: ['implausible_price'],
    });
  });

  it('sends fixed instructions first, then the variable blocks, then the image (same messages as before)', async () => {
    const adapter = new AIAdapter();
    const create = jest.fn().mockResolvedValue(responseFor(110));
    withFakeOpenAi(adapter, create);

    await adapter.analyzeImage('data:image/png;base64,AA==', 'FIXED PROMPT', 'quick', [], {
      timeframes: [], sessions: [], instruments: [], setups: [], direction: 'both', minRiskReward: 2,
    } as any);
    const body = create.mock.calls[0][0];
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toMatch(/^FIXED PROMPT\n\n## TRADER STRATEGY PROFILE/);
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AA==', detail: 'high' },
    });
    expect(body.response_format.json_schema).toMatchObject({ name: 'trading_analysis', strict: true });
  });

  it('reports the model that actually answered and no grounding when it is off', async () => {
    const adapter = new AIAdapter();
    withFakeOpenAi(adapter, jest.fn().mockResolvedValue(responseFor(110)));

    const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
    expect(result.respondedModel).toBe('gpt-5.6-luna');
    expect(result.groundingStats).toBeNull();
  });
});

describe('AIAdapter provider comparison (AI_COMPARE_PROVIDERS)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.ENABLE_QUICK_GROUNDING = 'false';
    process.env.ENABLE_NEWS_GUARD = 'false';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  function secondaryAnswering(recommendation: string): VisionModel {
    const body = JSON.parse(responseFor(110).choices[0].message.content);
    return {
      provider: 'fake-second',
      complete: jest.fn().mockResolvedValue({
        provider: 'fake-second', model: 'fake-model', content: JSON.stringify({ ...body, recommendation }),
        finishReason: 'stop', refusal: '', respondedModel: 'fake-model', modelMs: 5,
        usage: { promptTokens: 10, cachedTokens: 0, completionTokens: 20, reasoningTokens: 0, totalTokens: 30 },
      }),
    };
  }

  it('runs the second provider only when the flag is on AND the caller records it', async () => {
    const adapter = new AIAdapter();
    withFakeOpenAi(adapter, jest.fn().mockResolvedValue(responseFor(110)));
    const second = secondaryAnswering('SELL');
    (adapter as any).secondaryModel = second;

    process.env.AI_COMPARE_PROVIDERS = 'false';
    const off = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick', [], null, { compareProviders: true });
    expect(off.providerComparison).toBeUndefined();

    process.env.AI_COMPARE_PROVIDERS = 'true';
    const demo = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick');
    expect(demo.providerComparison).toBeUndefined();
    expect(second.complete).not.toHaveBeenCalled();

    const on = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick', [], null, { compareProviders: true });
    // O usuario ve so o ativo.
    expect(on.recommendation).toBe('BUY');
    const comparison = await on.providerComparison;
    expect(comparison).toMatchObject({
      agree: false,
      primary: { provider: 'openai', recommendation: 'BUY', entry: 100 },
      secondary: { provider: 'fake-second', recommendation: 'SELL', modelMs: 5, error: null },
    });
  });

  it('records a failing second provider without touching the analysis', async () => {
    process.env.AI_COMPARE_PROVIDERS = 'true';
    const adapter = new AIAdapter();
    withFakeOpenAi(adapter, jest.fn().mockResolvedValue(responseFor(110)));
    (adapter as any).secondaryModel = { provider: 'x', complete: jest.fn().mockRejectedValue(new Error('down')) };

    const result = await adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'quick', [], null, { compareProviders: true });
    expect(result.recommendation).toBe('BUY');
    await expect(result.providerComparison).resolves.toMatchObject({ agree: null, secondary: { error: 'down' } });
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


describe('AIAdapter Deep P1 regressions', () => {
  const keys = ['ENABLE_RR_GUARD', 'ENABLE_NEWS_GUARD', 'ENABLE_MARKET_ENRICHMENT'] as const;
  let saved: Array<string | undefined>;
  beforeEach(() => {
    saved = keys.map((key) => process.env[key]);
    process.env.ENABLE_RR_GUARD = 'true';
    process.env.ENABLE_NEWS_GUARD = 'false';
  });
  afterEach(() => keys.forEach((key, i) => {
    if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
  }));

  it.each(['injected', 'unavailable', 'error', 'disabled'] as const)(
    'preserves scaled prices and rejects non-charts in Deep with enrichment %s', async (mode) => {
      process.env.ENABLE_MARKET_ENRICHMENT = String(mode !== 'disabled');
      for (const isChart of [true, false]) {
        const adapter = new AIAdapter();
        const enrichment = jest.fn();
        if (mode === 'error') enrichment.mockRejectedValue(new Error('synthetic enrichment failure'));
        else enrichment.mockResolvedValue({
          block: mode === 'injected' ? 'SYNTHETIC MARKET CONTEXT' : null,
          assetClass: 'forex', marketContext: mode === 'injected' ? 'injected' : 'unavailable', calendar: 'no_events_returned',
        });
        (adapter as any).buildMarketEnrichment = enrichment;
        const response = responseFor(108.02, {
          symbol: 'EURUSD', currentPrice: 107.983, entry: 107.855, stopLoss: 107.7,
          takeProfit2: 108.12, invalidationLevel: 107.72,
        });
        const body = JSON.parse(response.choices[0].message.content);
        body.is_financial_chart = isChart;
        response.choices[0].message.content = JSON.stringify(body);
        const create = jest.fn().mockResolvedValue(response);
        withFakeOpenAi(adapter, create);
        const pending = adapter.analyzeImage('data:image/png;base64,AA==', 'prompt', 'deep');
        if (isChart) {
          const result = await pending;
          expect(result.recommendation).toBe('BUY');
          expect(result.analysis).toMatchObject({
            currentPrice: 107.983 * 0.01, entry: 107.855 * 0.01, stopLoss: 107.7 * 0.01,
            takeProfit1: 108.02 * 0.01, takeProfit2: 108.12 * 0.01, invalidationLevel: 107.72 * 0.01,
            riskRewardTp1: 1.06, riskRewardTp2: 1.71,
          });
          expect(result.rawResponse).toHaveProperty('is_financial_chart', true);
        } else {
          await expect(pending).rejects.toMatchObject({ code: 'non_chart_image', retriable: false });
        }
        expect(create).toHaveBeenCalledTimes(1);
        expect(enrichment).toHaveBeenCalledTimes(mode === 'disabled' ? 0 : 1);
        if (mode === 'injected') expect(JSON.stringify(create.mock.calls[0][0].messages)).toContain('SYNTHETIC MARKET CONTEXT');
      }
    },
  );
});
