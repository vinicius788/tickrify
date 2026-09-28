import {
  normalizeSymbol,
  computeRiskReward,
  hasInvalidTradePlanLevels,
  formatRiskReward,
  harmonizeConfidenceWithTrend,
  correctPriceMagnitude,
  deriveMarketRegime,
  normalizeTargetProbabilities,
} from './analysis-normalizer';

describe('normalizeTargetProbabilities', () => {
  const absent = { probabilityTp1: null, probabilityTp2: null, probabilityStop: null };

  it('keeps a complete model estimate without forcing three nested events to sum to 100', () => {
    expect(normalizeTargetProbabilities({ tp1: 58, tp2: 43, stop: 42 }, { hasTradePlan: true })).toEqual({
      probabilityTp1: 58, probabilityTp2: 43, probabilityStop: 42,
    });
  });

  it('does not invent probabilities when the model omits a field or has no trade plan', () => {
    expect(normalizeTargetProbabilities({ tp1: 58, stop: 42 }, { hasTradePlan: true })).toEqual(absent);
    expect(normalizeTargetProbabilities({ tp1: 58, tp2: 43, stop: 42 }, { hasTradePlan: false })).toEqual(absent);
  });

  it('does not silently repair a TP2 estimate above TP1', () => {
    expect(normalizeTargetProbabilities({ tp1: 40, tp2: 65, stop: 60 }, { hasTradePlan: true })).toEqual(absent);
    expect(normalizeTargetProbabilities({ tp1: 70, tp2: 30, stop: 50 }, { hasTradePlan: true })).toEqual(absent);
  });
});

describe('deriveMarketRegime', () => {
  it('tendência de baixa moderada → "trending" (nunca "lateral")', () => {
    expect(deriveMarketRegime('ranging', 'bearish', 'moderate')).toBe('trending');
    expect(deriveMarketRegime('lateral', 'bullish', 'strong')).toBe('trending');
  });

  it('respeita "volatile" detectado pela IA', () => {
    expect(deriveMarketRegime('volatile', 'bullish', 'moderate')).toBe('volatile');
  });

  it('bias neutro ou força fraca → "ranging"', () => {
    expect(deriveMarketRegime('trending', 'neutral', 'moderate')).toBe('ranging');
    expect(deriveMarketRegime('trending', 'bearish', 'weak')).toBe('ranging');
  });
});

describe('correctPriceMagnitude', () => {
  it('corrige BTC lido 10x menor (6356 -> 63560) escalando todos os níveis', () => {
    const out = correctPriceMagnitude('BTCUSD', {
      currentPrice: 6356,
      entry: 6360,
      stopLoss: 6300,
      takeProfit1: 6400,
      takeProfit2: 6450,
      invalidationLevel: 6300,
    });
    expect(out.currentPrice).toBe(63560);
    expect(out.entry).toBe(63600);
    expect(out.stopLoss).toBe(63000);
    expect(out.takeProfit2).toBe(64500);
    expect(out.invalidationLevel).toBe(63000);
  });

  it('não altera quando o preço já está na faixa correta', () => {
    const levels = { currentPrice: 63560, entry: 63600, stopLoss: 63000, takeProfit1: 64000, takeProfit2: 64500, invalidationLevel: 63000 };
    expect(correctPriceMagnitude('BTCUSD', levels)).toEqual(levels);
  });

  it('não mexe em ativos sem faixa conhecida (ex: forex)', () => {
    const levels = { currentPrice: 1.0852, entry: 1.086, stopLoss: 1.082, takeProfit1: 1.09, takeProfit2: 1.095, invalidationLevel: 1.082 };
    expect(correctPriceMagnitude('EURUSD', levels)).toEqual(levels);
  });

  it('corrige ouro (XAUUSD) lido 10x menor', () => {
    const out = correctPriceMagnitude('XAUUSD', {
      currentPrice: 331, entry: 332, stopLoss: 329, takeProfit1: 335, takeProfit2: 338, invalidationLevel: 329,
    });
    expect(out.currentPrice).toBe(3310);
    expect(out.stopLoss).toBe(3290);
  });

  it('distingue índices globais pelos dígitos (NAS100 vs US30)', () => {
    // NAS100 lido 10x menor (1850 -> 18500)
    const nas = correctPriceMagnitude('NAS100', {
      currentPrice: 1850, entry: 1850, stopLoss: 1840, takeProfit1: 1870, takeProfit2: 1890, invalidationLevel: 1840,
    });
    expect(nas.currentPrice).toBe(18500);
    // US30 já na faixa não muda
    const us30 = { currentPrice: 42000, entry: 42000, stopLoss: 41800, takeProfit1: 42300, takeProfit2: 42600, invalidationLevel: 41800 };
    expect(correctPriceMagnitude('US30', us30)).toEqual(us30);
  });

  it('corrige WIN (mini índice B3) lido 10x menor', () => {
    const win = correctPriceMagnitude('WIN', {
      currentPrice: 12800, entry: 12810, stopLoss: 12750, takeProfit1: 12900, takeProfit2: 12950, invalidationLevel: 12750,
    });
    expect(win.currentPrice).toBe(128000);
  });
});

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
    expect(computeRiskReward(100, 95, -110, 'BUY')).toBeNull();
  });

  it('does not turn an inverted stop or target into positive reward', () => {
    expect(computeRiskReward(100, 95, 90, 'BUY')).toBeNull();
    expect(computeRiskReward(100, 105, 110, 'SELL')).toBeNull();
    expect(computeRiskReward(100, 105, 90, 'BUY')).toBeNull();
    expect(computeRiskReward(100, 95, 110, 'SELL')).toBeNull();
    expect(computeRiskReward(100, 95, 110, 'BUY')).toBe(2);
    expect(computeRiskReward(100, 105, 90, 'SELL')).toBe(2);
  });

  it('rejects a plan if either supplied target contradicts its direction', () => {
    expect(hasInvalidTradePlanLevels('BUY', 100, 95, 110, 90)).toBe(true);
    expect(hasInvalidTradePlanLevels('SELL', 100, 105, 90, 110)).toBe(true);
    expect(hasInvalidTradePlanLevels('BUY', 100, 95, 110, null)).toBe(false);
    expect(hasInvalidTradePlanLevels('WAIT', 100, 95, 90, 110)).toBe(false);
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

describe('normalizeSymbol', () => {
  it('traduz simbolo legado em portugues para o ticker padrao', () => {
    expect(normalizeSymbol('Ouro/Dólar')).toBe('XAUUSD');
  });

  it('ignora acento e caixa — o dado antigo nao e consistente', () => {
    expect(normalizeSymbol('ouro/dolar')).toBe('XAUUSD');
    expect(normalizeSymbol('  OURO/DÓLAR  ')).toBe('XAUUSD');
  });

  it('deixa ticker padrao intacto', () => {
    expect(normalizeSymbol('XAUUSD')).toBe('XAUUSD');
    expect(normalizeSymbol('NAS100')).toBe('NAS100');
  });

  it('simbolo desconhecido passa intacto em vez de virar N/A', () => {
    expect(normalizeSymbol('FOOBAR')).toBe('FOOBAR');
  });

  it('vazio ou nulo vira N/A', () => {
    expect(normalizeSymbol('')).toBe('N/A');
    expect(normalizeSymbol(null)).toBe('N/A');
    expect(normalizeSymbol(undefined)).toBe('N/A');
  });
});
