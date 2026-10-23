import { describe, expect, it } from 'vitest';
import { getScenarioMeta, normalizeConfluenceScore } from '@/lib/trading-ui';

// Estes casos impedem que uma mudança visual converta WAIT em NEUTRAL ou em um sinal de compra/venda.
describe('cenário separado da ação', () => {
  it('preserva o viés direcional mesmo quando a ação é aguardar', () => {
    expect(getScenarioMeta('bullish', 'WAIT').label).toBe('BULLISH');
    expect(getScenarioMeta('bearish', 'WAIT').label).toBe('BEARISH');
  });

  it('usa o viés explícito, mesmo quando difere da ação', () => {
    expect(getScenarioMeta('neutral', 'BUY').label).toBe('NEUTRAL');
  });

  it('mantém compatibilidade com análises antigas sem viés persistido', () => {
    expect(getScenarioMeta(null, 'BUY').label).toBe('BULLISH');
    expect(getScenarioMeta(null, 'SELL').label).toBe('BEARISH');
    expect(getScenarioMeta(null, 'WAIT').label).toBe('NEUTRAL');
  });
});


// Synthetic contract cases: confluenceScore is percentage points (0..100),
// not factorsPresent and not a probability on a second scale.
describe('v7.7 Lote A — percentage presentation', () => {
  it.each([[0, 0], [0.85, 1], [1, 1], [7, 7], [8, 8], [10, 10], [71.43, 71], [100, 100]])(
    'displays confluenceScore=%s as %s/100 without inferring another unit', (score, percent) => {
      expect(normalizeConfluenceScore(score)).toEqual({ percent, display: `${percent}/100` });
    },
  );
  it.each([NaN, Infinity, -Infinity])('keeps non-finite scores unavailable: %s', score => {
    expect(normalizeConfluenceScore(score)).toEqual({ percent: 0, display: 'N/A' });
  });
});
