import { validateTradePlan, type TradePlanInput } from './trade-plan-validator';

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
