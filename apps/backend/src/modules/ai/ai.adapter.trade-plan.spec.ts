import { AIAdapter } from './ai.adapter';

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
});
