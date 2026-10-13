import { validateTradePlan, type TradePlanInput } from './trade-plan-validator';
import { decideSignal } from './signal-decision';

const buy: TradePlanInput = {
  side: 'BUY',
  entry: 100,
  stopLoss: 95,
  takeProfit1: 110,
  takeProfit2: 120,
  invalidationLevel: 96,
  currentPrice: 101,
};
const sell: TradePlanInput = {
  side: 'SELL',
  entry: 100,
  stopLoss: 105,
  takeProfit1: 90,
  takeProfit2: 80,
  invalidationLevel: 104,
  currentPrice: 99,
};

describe('validateTradePlan', () => {
  it('passes coherent BUY and SELL plans', () => {
    expect(validateTradePlan(buy)).toEqual([]);
    expect(validateTradePlan(sell)).toEqual([]);
  });

  it('never checks a WAIT (there is no plan)', () => {
    expect(validateTradePlan({ ...buy, side: 'WAIT', stopLoss: 500, currentPrice: 1 })).toEqual([]);
  });

  describe('incomplete', () => {
    it('flags a BUY/SELL without entry, stop or any target', () => {
      expect(validateTradePlan({ ...buy, entry: null })).toContain('incomplete');
      expect(validateTradePlan({ ...sell, stopLoss: undefined })).toContain('incomplete');
      expect(validateTradePlan({ ...buy, takeProfit1: null, takeProfit2: null })).toContain('incomplete');
      expect(validateTradePlan({ ...buy, entry: Number.NaN })).toContain('incomplete');
      expect(validateTradePlan({ ...buy, stopLoss: 0 })).toContain('incomplete');
    });

    it('accepts a plan with only one of the two targets', () => {
      expect(validateTradePlan({ ...buy, takeProfit2: null })).toEqual([]);
    });
  });

  describe('direction', () => {
    it('BUY: stop must be below entry', () => {
      expect(validateTradePlan({ ...buy, stopLoss: 101 })).toContain('direction');
      expect(validateTradePlan({ ...buy, stopLoss: 100 })).toContain('direction');
    });
    it('BUY: targets must be above entry', () => {
      expect(validateTradePlan({ ...buy, takeProfit1: 99 })).toContain('direction');
      expect(validateTradePlan({ ...buy, takeProfit2: 98 })).toContain('direction');
    });
    it('SELL: stop must be above entry', () => {
      expect(validateTradePlan({ ...sell, stopLoss: 99 })).toContain('direction');
    });
    it('SELL: targets must be below entry', () => {
      expect(validateTradePlan({ ...sell, takeProfit1: 101 })).toContain('direction');
    });
  });

  describe('stop beyond invalidation', () => {
    it('BUY: a stop above the invalidation level fails', () => {
      expect(validateTradePlan({ ...buy, invalidationLevel: 94 })).toEqual(['stop_inside_invalidation']);
    });
    it('SELL: a stop below the invalidation level fails', () => {
      expect(validateTradePlan({ ...sell, invalidationLevel: 106 })).toEqual(['stop_inside_invalidation']);
    });
    it('a stop exactly at the invalidation level passes', () => {
      expect(validateTradePlan({ ...buy, invalidationLevel: 95 })).toEqual([]);
      expect(validateTradePlan({ ...sell, invalidationLevel: 105 })).toEqual([]);
    });
    it('is skipped when the model gave no invalidation level', () => {
      expect(validateTradePlan({ ...buy, invalidationLevel: null })).toEqual([]);
      expect(validateTradePlan({ ...buy, invalidationLevel: 0 })).toEqual([]);
    });
  });

  describe('plausible price range', () => {
    it('rejects a level far above the chart price (extra digit)', () => {
      expect(validateTradePlan({ ...buy, takeProfit2: 1200 })).toEqual(['implausible_price']);
    });
    it('rejects a level far below the chart price', () => {
      expect(validateTradePlan({ ...sell, takeProfit2: 8 })).toEqual(['implausible_price']);
    });
    it('accepts levels within half and double the chart price', () => {
      expect(validateTradePlan({ ...buy, takeProfit2: 200 })).toEqual([]);
      expect(validateTradePlan({ ...sell, takeProfit2: 50, takeProfit1: 60 })).toEqual([]);
    });
    it('is skipped when the chart price was not read', () => {
      expect(validateTradePlan({ ...buy, takeProfit2: 1200, currentPrice: 0 })).toEqual([]);
      expect(validateTradePlan({ ...buy, takeProfit2: 1200, currentPrice: null })).toEqual([]);
    });
  });
});

describe('decideSignal with the plan validator', () => {
  const oldNews = process.env.ENABLE_NEWS_GUARD;
  beforeAll(() => { process.env.ENABLE_NEWS_GUARD = 'false'; });
  afterAll(() => {
    if (oldNews === undefined) delete process.env.ENABLE_NEWS_GUARD;
    else process.env.ENABLE_NEWS_GUARD = oldNews;
  });

  const base = {
    recommendation: 'BUY' as const,
    flooredConfidence: 70,
    trendStrength: 'strong',
    factorsPresent: 6,
    riskRewardTp1: 2,
    riskRewardTp2: 4,
    symbol: 'TEST',
  };

  it('leaves a clean plan alone: validator_action none', async () => {
    const d = await decideSignal({ ...base, planFailures: [] });
    expect(d).toMatchObject({ recommendation: 'BUY', validatorAction: 'none', validatorReasons: [] });
  });

  it('marks a price-magnitude correction as fixed', async () => {
    const d = await decideSignal({ ...base, planFailures: [], priceFixed: true });
    expect(d).toMatchObject({ recommendation: 'BUY', validatorAction: 'fixed' });
  });

  it('downgrades a failing plan to WAIT with confidence at most 45', async () => {
    const d = await decideSignal({ ...base, planFailures: ['implausible_price'], priceFixed: true });
    expect(d.recommendation).toBe('WAIT');
    expect(d.confidence).toBeLessThanOrEqual(45);
    expect(d).toMatchObject({ validatorAction: 'downgraded', validatorReasons: ['implausible_price'] });
  });

  it('counts the existing R/R guard (best target below 1.2) as a downgrade', async () => {
    const d = await decideSignal({ ...base, riskRewardTp1: 0.8, riskRewardTp2: 1.1, planFailures: [] });
    expect(d).toMatchObject({ recommendation: 'WAIT', validatorAction: 'downgraded', validatorReasons: ['rr_below_min'] });
  });

  it('keeps the current R/R rule: TP1 below 1.5 with a good TP2 stays a trade', async () => {
    const d = await decideSignal({ ...base, riskRewardTp1: 1.1, riskRewardTp2: 2.3, planFailures: [] });
    expect(d.recommendation).toBe('BUY');
  });

  it('stop before invalidation only measures: the trade stays, the flag is recorded', async () => {
    const d = await decideSignal({ ...base, planFailures: ['stop_inside_invalidation'] });
    expect(d).toMatchObject({
      recommendation: 'BUY',
      validatorAction: 'none',
      validatorReasons: [],
      validatorFlags: ['stop_inside_invalidation'],
    });
  });

  it('a measure-only flag does not hide a real downgrade', async () => {
    const d = await decideSignal({ ...base, planFailures: ['stop_inside_invalidation', 'implausible_price'] });
    expect(d).toMatchObject({
      recommendation: 'WAIT',
      validatorAction: 'downgraded',
      validatorReasons: ['implausible_price'],
      validatorFlags: ['stop_inside_invalidation'],
    });
  });

  it('never downgrades a WAIT again', async () => {
    const d = await decideSignal({ ...base, recommendation: 'WAIT', planFailures: ['implausible_price'] });
    expect(d).toMatchObject({ recommendation: 'WAIT', validatorAction: 'none', validatorFlags: [] });
  });
});
