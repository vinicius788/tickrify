import { describe, expect, it } from 'vitest';
import { getScenarioMeta } from '@/lib/trading-ui';

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
