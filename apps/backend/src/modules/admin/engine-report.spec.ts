import { assetClassOf, buildEngineReport, buildProfileReport, isFilledWatch, reviewDecision, type EngineReportRow } from './engine-report';

const trade = (outcome: 'WIN' | 'LOSS', symbol = 'BTCUSDT', state = 'WATCH'): EngineReportRow => ({
  symbol, signalState: state, trackStatus: 'tracked', touched: true, outcome,
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

  it('total e por classe de ativo, sem variantes', () => {
    const report = buildEngineReport([trade('WIN'), trade('LOSS', 'XAUUSD')]);
    expect(report.total.analyses).toBe(2);
    expect(report.classes.map((c) => c.assetClass)).toEqual(['metal', 'crypto']);
  });

  it('% de WATCH tocado usa so janelas fechadas, e sem desfecho nao vira trade', () => {
    const open: EngineReportRow = { symbol: 'BTCUSDT', signalState: 'WATCH', trackStatus: null, touched: null, outcome: null, fillPrice: null, stopLoss: null, takeProfit1: null };
    const untouched: EngineReportRow = { ...open, trackStatus: 'tracked', touched: false, outcome: 'EXPIRED' };
    const { total } = buildEngineReport([open, untouched, trade('WIN')]);
    expect(total).toMatchObject({ analyses: 3, watchTracked: 2, watchTouched: 1, watchTouchedPct: 50, closedTrades: 1 });
  });

  it('aplica a regra da revisao mensal ao ENTER_NOW', () => {
    const enter = (outcome: 'WIN' | 'LOSS') => trade(outcome, 'BTCUSDT', 'ENTER_NOW');
    expect(buildEngineReport(many(29, () => enter('WIN'))).enterNow.verdict).toContain('faltam 1 trades');
    expect(buildEngineReport(many(30, () => enter('WIN'))).enterNow.verdict).toBe('Manter o ENTER_NOW.');
    expect(buildEngineReport(many(30, () => enter('LOSS'))).enterNow.verdict).toContain('Desligar o ENTER_NOW');
  });
});

describe('analises sem velas, por motivo', () => {
  const row = (coverage: string | null | undefined): EngineReportRow => ({
    symbol: 'XAUUSD', signalState: 'NO_TRADE', trackStatus: null, touched: null, outcome: null,
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

describe('regra da revisao mensal (ENTER_NOW e WATCH preenchido)', () => {
  it('mantem, desliga e espera nos mesmos limites', () => {
    expect(reviewDecision(30, -0.05)).toBe('keep');
    expect(reviewDecision(30, -0.15)).toBe('disable');
    expect(reviewDecision(30, -0.1)).toBe('wait');
    expect(reviewDecision(29, 1)).toBe('wait');
    expect(reviewDecision(30, null)).toBe('wait');
  });

  it('WATCH so conta quando tocou o nivel e foi preenchido', () => {
    expect(isFilledWatch({ signalState: 'WATCH', touched: true, filled: true })).toBe(true);
    expect(isFilledWatch({ signalState: 'WATCH', touched: true, filled: false })).toBe(false);
    expect(isFilledWatch({ signalState: 'WATCH', touched: false, filled: false })).toBe(false);
    expect(isFilledWatch({ signalState: 'ENTER_NOW', touched: true, filled: true })).toBe(false);
  });
});

describe('perfis de risco', () => {
  const prow = (profile: string, outcome: 'WIN' | 'LOSS', state = 'ENTER_NOW') => ({
    profile, symbol: 'BTCUSDT', signalState: state, trackStatus: 'tracked', touched: true, outcome,
    fillPrice: 100, stopLoss: 99, takeProfit1: outcome === 'WIN' ? 101.5 : 101,
  });
  const run = (n: number, profile: string, outcome: 'WIN' | 'LOSS') => Array.from({ length: n }, () => prow(profile, outcome));

  it('sem linhas, sem bloco; com linhas, os 3 perfis na ordem', () => {
    expect(buildProfileReport([])).toEqual([]);
    expect(buildProfileReport([prow('balanced', 'WIN')]).map((p) => p.profile)).toEqual(['conservative', 'balanced', 'aggressive']);
  });

  it('menos de 20 trades fechados: esperar, dizendo quantos faltam', () => {
    const [cons] = buildProfileReport([...run(5, 'conservative', 'WIN'), ...run(5, 'conservative', 'LOSS')]);
    expect(cons.stats.closedTrades).toBe(10);
    expect(cons.verdict).toBe('Esperar mais dados (faltam 10).');
  });

  it('com 20 trades: mantem, desliga e espera nos limites de -0,05R e -0,15R', () => {
    const rows = [
      ...run(20, 'conservative', 'WIN'),
      ...run(20, 'balanced', 'LOSS'),
      ...run(10, 'aggressive', 'WIN'), ...run(10, 'aggressive', 'LOSS'),
    ];
    const [cons, bal, agg] = buildProfileReport(rows);
    expect(cons.verdict).toBe('Manter o perfil.');
    expect(bal.verdict).toBe('Desligar o perfil.');
    // 10 x +1,5R e 10 x -1R: media positiva, mantem.
    expect(agg.verdict).toBe('Manter o perfil.');
  });

  it('entre -0,15R e -0,05R a regra nao decide', () => {
    // 7 WIN (+1,5R) e 13 LOSS (-1R): media de -0,125R.
    const [cons] = buildProfileReport([...run(7, 'conservative', 'WIN'), ...run(13, 'conservative', 'LOSS')]);
    expect(cons.stats.meanR).toBeGreaterThan(-0.15);
    expect(cons.stats.meanR).toBeLessThan(-0.05);
    expect(cons.verdict).toContain('a regra nao decide');
  });

  it('reviewDecision com minimo 20 e o padrao de 30 para o ENTER_NOW', () => {
    expect(reviewDecision(25, 0.1)).toBe('wait');
    expect(reviewDecision(25, 0.1, 20)).toBe('keep');
  });
});
