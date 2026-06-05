import {
  computeRiskReward,
  formatRiskReward,
  harmonizeConfidenceWithTrend,
} from './analysis-normalizer';

describe('computeRiskReward', () => {
  it('computes R/R for a SELL setup (TP < entry < SL)', () => {
    // Caso real do print: entry 62088.68, SL 62336, TP2 61470
    // risco = 247.32, reward = 618.68 → ~2.5
    expect(computeRiskReward(62088.68, 62336, 61470)).toBeCloseTo(2.5, 1);
  });

  it('computes R/R to TP1 for the same SELL setup', () => {
    // reward até TP1 (61730) = 358.68 → ~1.45
    expect(computeRiskReward(62088.68, 62336, 61730)).toBeCloseTo(1.45, 2);
  });

  it('computes R/R for a BUY setup (TP > entry > SL)', () => {
    // entry 100, SL 95 (risco 5), TP 110 (reward 10) → 2.0
    expect(computeRiskReward(100, 95, 110)).toBe(2);
  });

  it('returns null when any level is missing', () => {
    expect(computeRiskReward(null, 95, 110)).toBeNull();
    expect(computeRiskReward(100, null, 110)).toBeNull();
    expect(computeRiskReward(100, 95, null)).toBeNull();
    expect(computeRiskReward(undefined, undefined, undefined)).toBeNull();
  });

  it('returns null when risk is zero (entry === stopLoss)', () => {
    expect(computeRiskReward(100, 100, 110)).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(computeRiskReward(NaN, 95, 110)).toBeNull();
    expect(computeRiskReward(Infinity, 95, 110)).toBeNull();
  });
});

describe('harmonizeConfidenceWithTrend', () => {
  it('caps confidence at 74 when trend is moderate (resolve "75% Alta" vs "Moderada")', () => {
    expect(harmonizeConfidenceWithTrend(75, 'moderate')).toBe(74);
    expect(harmonizeConfidenceWithTrend(90, 'moderate')).toBe(74);
  });

  it('caps confidence at 60 when trend is weak', () => {
    expect(harmonizeConfidenceWithTrend(85, 'weak')).toBe(60);
  });

  it('does not change confidence when trend is strong', () => {
    expect(harmonizeConfidenceWithTrend(88, 'strong')).toBe(88);
  });

  it('does not raise confidence already below the cap', () => {
    expect(harmonizeConfidenceWithTrend(40, 'moderate')).toBe(40);
    expect(harmonizeConfidenceWithTrend(55, 'weak')).toBe(55);
  });

  it('handles Portuguese / partial strings and unknown values', () => {
    expect(harmonizeConfidenceWithTrend(80, 'Moderada')).toBe(74);
    expect(harmonizeConfidenceWithTrend(80, 'fraca')).toBe(60);
    expect(harmonizeConfidenceWithTrend(80, null)).toBe(80);
    expect(harmonizeConfidenceWithTrend(80, undefined)).toBe(80);
  });
});

describe('formatRiskReward', () => {
  it('formats a numeric ratio as 1:X.X', () => {
    expect(formatRiskReward(2.5)).toBe('1:2.5');
    expect(formatRiskReward(1.4)).toBe('1:1.4');
  });

  it('returns null for null/invalid input', () => {
    expect(formatRiskReward(null)).toBeNull();
    expect(formatRiskReward(undefined)).toBeNull();
    expect(formatRiskReward(NaN)).toBeNull();
  });
});
