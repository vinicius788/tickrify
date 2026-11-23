import { assetClassOf, buildEngineReport, entryKindOf, isFilledWatch, reviewDecision, type EngineReportRow } from './engine-report';

const trade = (outcome: 'WIN' | 'LOSS', symbol = 'BTCUSDT', action = 'buy_now'): EngineReportRow => ({
  symbol, action, agreement: '3/3', trackStatus: 'tracked', outcome,
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

  it('tipo de entrada pelo action do resumo', () => {
    expect(entryKindOf('buy_now')).toBe('now');
    expect(entryKindOf('sell_pullback')).toBe('pullback');
    expect(entryKindOf('buy_breakout')).toBe('breakout');
    expect(entryKindOf('wait')).toBe('wait');
    expect(entryKindOf(null)).toBeNull();
    expect(entryKindOf('algo')).toBeNull();
  });

  it('total, por tipo de entrada e por classe, com % de operacao clara', () => {
    const wait: EngineReportRow = { symbol: 'EURUSD', action: 'wait', agreement: '2/3', trackStatus: null, outcome: null, fillPrice: null, stopLoss: null, takeProfit1: null };
    const report = buildEngineReport([trade('WIN'), trade('LOSS', 'XAUUSD', 'sell_pullback'), wait], '2026-11-23T12:00:00.000Z');
    expect(report.total.analyses).toBe(3);
    expect(report.total.clearPct).toBeCloseTo(66.67, 1);
    expect(report.byEntry.map((e) => e.entry)).toEqual(['now', 'pullback', 'wait']);
    expect(report.byClass.map((c) => c.assetClass)).toEqual(['metal', 'forex', 'crypto']);
    expect(report.agreement).toEqual([{ agreement: '3/3', count: 2 }, { agreement: '2/3', count: 1 }]);
  });

  it('aplica a regra do projeto: n >= 30, manter, alertar ou esperar', () => {
    expect(reviewDecision(29, 0.5)).toBe('wait');
    expect(reviewDecision(30, -0.05)).toBe('keep');
    expect(reviewDecision(30, -0.1)).toBe('wait');
    expect(reviewDecision(30, -0.15)).toBe('disable');
    expect(buildEngineReport(many(29, () => trade('WIN'))).total.verdict).toContain('faltam 1 trades');
    expect(buildEngineReport(many(30, () => trade('WIN'))).total.verdict).toBe('Manter.');
    expect(buildEngineReport(many(30, () => trade('LOSS'))).total.decision).toBe('disable');
  });

  it('WATCH preenchido (usado pelo replay)', () => {
    expect(isFilledWatch({ signalState: 'WATCH', touched: true, filled: true })).toBe(true);
    expect(isFilledWatch({ signalState: 'ENTER_NOW', touched: true, filled: true })).toBe(false);
  });
});

describe('analises sem velas, por motivo', () => {
  const row = (coverage: string | null | undefined): EngineReportRow => ({
    symbol: 'XAUUSD', action: 'wait', agreement: null, trackStatus: null, outcome: null,
    fillPrice: null, stopLoss: null, takeProfit1: null, coverage,
  });

  it('conta por motivo, ignora as que tiveram velas e agrupa sem registro', () => {
    const { noCandles } = buildEngineReport([row('provider_quota'), row('provider_quota'), row('injected'), row(undefined), row(null)]);
    expect(noCandles).toEqual([{ reason: 'not_recorded', count: 2 }, { reason: 'provider_quota', count: 2 }]);
  });

  it('sem nenhuma analise, lista vazia', () => {
    expect(buildEngineReport([]).noCandles).toEqual([]);
  });

  it('agrupa por regras (mais novo primeiro, sem registro por ultimo), por decidedBy e por leitor', () => {
    const base = { symbol: 'BTCUSDT', action: 'buy_now', agreement: '2/3', trackStatus: null, outcome: null, fillPrice: null, stopLoss: null, takeProfit1: null } as const;
    const report = buildEngineReport([
      { ...base, rules: null, decidedBy: 'majority' },
      { ...base, rules: 'filter-2026-11-23', decidedBy: 'candle_bias', readers: [{ label: 'B', status: 'failed', error: 'boom' }] },
      { ...base, rules: 'filter-2026-11-30', decidedBy: 'majority' },
    ]);
    expect(report.byRules.map((g) => g.rules)).toEqual(['filter-2026-11-30', 'filter-2026-11-23', null]);
    expect(report.decidedBy).toEqual([{ decidedBy: 'majority', count: 2 }, { decidedBy: 'candle_bias', count: 1 }]);
    expect(report.withoutMajorityPct).toBeCloseTo(100 / 3, 6);
    expect(report.readerFailures).toEqual([{ label: 'B', seen: 1, failures: 1, topError: 'boom' }]);
  });
});
