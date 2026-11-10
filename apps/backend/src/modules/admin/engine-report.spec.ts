import { assetClassOf, buildEngineReport, type EngineReportRow } from './engine-report';

const trade = (variant: 'A' | 'B', outcome: 'WIN' | 'LOSS', symbol = 'BTCUSDT', state = 'WATCH'): EngineReportRow => ({
  symbol, variant, signalState: state, trackStatus: 'tracked', touched: true, outcome,
  fillPrice: 100, stopLoss: 99, takeProfit1: outcome === 'WIN' ? 101.5 : 101,
});
const many = (n: number, make: () => EngineReportRow) => Array.from({ length: n }, make);

describe('engine-report', () => {
  it('classifica os ativos', () => {
    expect(assetClassOf('XAUUSD')).toBe('metal');
    expect(assetClassOf('EURUSD')).toBe('forex');
    expect(assetClassOf('BTCUSDT')).toBe('crypto');
    expect(assetClassOf('Some Stock plc')).toBe('other');
  });

  it('sem B, mostra so A e diz que nao ha teste', () => {
    const report = buildEngineReport([trade('A', 'WIN'), { ...trade('A', 'WIN'), variant: null }]);
    expect(report.hasVariantB).toBe(false);
    expect(report.variants.map((v) => v.variant)).toEqual(['A']);
    expect(report.variants[0].total.analyses).toBe(2);
    expect(report.verdict).toContain('So existe a variante A');
  });

  it('conta o que falta para decidir', () => {
    const report = buildEngineReport([...many(10, () => trade('A', 'WIN')), ...many(25, () => trade('B', 'WIN'))]);
    expect(report.verdict).toBe('Manter e esperar mais dados: faltam 20 trades fechados na A e 5 na B.');
  });

  it('liga a B com R maior e nenhuma classe pior', () => {
    const rows = [...many(15, () => trade('A', 'WIN')), ...many(15, () => trade('A', 'LOSS')), ...many(25, () => trade('B', 'WIN')), ...many(5, () => trade('B', 'LOSS'))];
    expect(buildEngineReport(rows).verdict).toContain('Ligar a B para todos');
  });

  it('nao liga a B se ela perde numa classe com 10 ou mais trades', () => {
    const rows = [
      ...many(20, () => trade('A', 'LOSS')), ...many(12, () => trade('A', 'WIN', 'XAUUSD')),
      ...many(20, () => trade('B', 'WIN')), ...many(6, () => trade('B', 'WIN', 'XAUUSD')), ...many(6, () => trade('B', 'LOSS', 'XAUUSD')),
    ];
    const verdict = buildEngineReport(rows).verdict;
    expect(verdict).toContain('Manter e esperar mais dados');
    expect(verdict).toContain('perde em alguma classe');
  });

  it('desliga a B quando o R cai 0,10 ou mais', () => {
    const rows = [...many(25, () => trade('A', 'WIN')), ...many(5, () => trade('A', 'LOSS')), ...many(5, () => trade('B', 'WIN')), ...many(25, () => trade('B', 'LOSS'))];
    expect(buildEngineReport(rows).verdict).toContain('Desligar a B');
  });

  it('% de WATCH tocado usa so janelas fechadas, e sem desfecho nao vira trade', () => {
    const open: EngineReportRow = { symbol: 'BTCUSDT', variant: 'A', signalState: 'WATCH', trackStatus: null, touched: null, outcome: null, fillPrice: null, stopLoss: null, takeProfit1: null };
    const untouched: EngineReportRow = { ...open, trackStatus: 'tracked', touched: false, outcome: 'EXPIRED' };
    const { total } = buildEngineReport([open, untouched, trade('A', 'WIN')]).variants[0];
    expect(total).toMatchObject({ analyses: 3, watchTracked: 2, watchTouched: 1, watchTouchedPct: 50, closedTrades: 1 });
  });

  it('aplica a regra da revisao mensal ao ENTER_NOW da A', () => {
    const enter = (outcome: 'WIN' | 'LOSS') => trade('A', outcome, 'BTCUSDT', 'ENTER_NOW');
    expect(buildEngineReport(many(29, () => enter('WIN'))).enterNow.verdict).toContain('faltam 1 trades');
    expect(buildEngineReport(many(30, () => enter('WIN'))).enterNow.verdict).toBe('Manter o ENTER_NOW.');
    expect(buildEngineReport(many(30, () => enter('LOSS'))).enterNow.verdict).toContain('Desligar o ENTER_NOW');
  });
});

describe('analises sem velas, por motivo', () => {
  const row = (coverage: string | null | undefined): EngineReportRow => ({
    symbol: 'XAUUSD', variant: 'A', signalState: 'NO_TRADE', trackStatus: null, touched: null, outcome: null,
    fillPrice: null, stopLoss: null, takeProfit1: null, coverage,
  });

  it('conta so quem veio sem velas, do mais comum para o menos comum', () => {
    const report = buildEngineReport([row('injected'), row('symbol_timeout'), row('symbol_timeout'), row('provider_quota'), row(null)]);
    expect(report.noCandles).toEqual([
      { reason: 'symbol_timeout', count: 2 },
      { reason: 'not_recorded', count: 1 },
      { reason: 'provider_quota', count: 1 },
    ]);
  });
});
