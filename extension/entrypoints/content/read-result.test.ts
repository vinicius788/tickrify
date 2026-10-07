import { describe, expect, it } from 'vitest';
import type { Analysis } from '@/lib/api';
import { readResult } from './Panel';

// Recorte da analise real de exemplo EURJPY (lib/sample-analyses.ts do site).
const BUY: Analysis = {
  id: 'cmu6aeuiz000nl407swre06nq',
  status: 'completed',
  recommendation: 'BUY',
  fullResponse: {
    analysis: {
      symbol: 'EURJPY',
      timeframe: '5M',
      entry: 179.25,
      stopLoss: 179.08,
      takeProfit1: 179.5,
      takeProfit2: 179.65,
      entryType: 'limit',
      riskRewardTp1: 1.47,
      riskRewardTp2: 2.35,
      executiveSummary: 'HTF structure is bullish.',
      riskFactorsList: ['Late-stage trend; pullback risk is elevated.'],
      invalidationNote: 'Setup invalidated if price closes below 179.050.',
    },
  },
};

describe('readResult', () => {
  it('mapeia o resultado da API para o painel', () => {
    const r = readResult(BUY, { symbol: 'FX:EURJPY', timeframe: '5m' });
    expect(r.rec).toBe('BUY');
    expect(r.symbol).toBe('EURJPY');
    expect(r.entryLabel).toBe('Buy limit');
    expect(r.prices).toEqual({ entry: '179.25', stop: '179.08', tp1: '179.50', tp2: '179.65' });
    // entryY/stopY da IA nao servem para desenhar (medido em 06/10): sem escala do eixo, sem linhas.
    expect(r.fractions).toBeNull();
    expect(r.rr1).toBe('1.47');
    expect(r.risks).toHaveLength(1);
  });

  it('com a escala do eixo, as linhas saem da conta exata', () => {
    const withAxis: Analysis = {
      ...BUY,
      fullResponse: { analysis: { ...BUY.fullResponse!.analysis, priceAxis: { top: 179.75, bottom: 178.75 } } },
    };
    const r = readResult(withAxis, {});
    expect(r.fractions!.entry).toBeCloseTo(0.5, 5);
    expect(r.fractions!.tp1).toBeCloseTo(0.25, 5);
    expect(r.fractions!.stop).toBeCloseTo(0.67, 5);
  });

  it('HOLD e qualquer coisa fora de BUY/SELL vira WAIT; "Wait for" vem do motor', () => {
    const wait: Analysis = {
      id: 'w',
      status: 'completed',
      recommendation: 'HOLD',
      fullResponse: { analysis: { entryCondition: null, alternativeScenario: 'If price sweeps below 82,600, reassess.' } },
    };
    const r = readResult(wait, { symbol: 'BTCUSDT' });
    expect(r.rec).toBe('WAIT');
    expect(r.symbol).toBe('BTCUSDT');
    expect(r.waitFor).toBe('If price sweeps below 82,600, reassess.');
    expect(r.prices.entry).toBeNull();
  });
});
