/**
 * Validador de estado do v11 (02/11/2026): o codigo decide o estado com as
 * constantes de ENGINE_RULES. Invalidacao encaixada na swing real, duas
 * entradas (mercado e limit), so rebaixa, com a excecao WATCH -> ENTER_NOW.
 * Cada mudanca de estado vai para validatorNotes. O news guard mantem os
 * status de 19/10 (falha aberta, visivel).
 */

const getEventsForSymbol = jest.fn();

jest.mock('../../modules/calendar/calendar.service', () => ({
  EconomicCalendarService: jest.fn().mockImplementation(() => ({ getEventsForSymbol })),
}));

import {
  applyDecisionToAnalysis,
  decideSignal,
  deriveSignalState,
  requiredPasses,
  storedSignalState,
  validatorReasons,
  type RealDataInput,
  type SignalDecisionInput,
  watchLevelsOf,
} from './signal-decision';
import { ENGINE_RULES, type WatchPlan, entryLevels, nearEdge, trackPlan } from './plan-engine';
import { STOP_MARGIN_P80 } from './engine-calibration';
import { buildPersistedAnalysisPayload } from './analysis-payload';

const saved = process.env.ENABLE_NEWS_GUARD;

// Ouro, compra na zona 99-99,5, invalidacao 98,8 (fundo real), ATR 1. Preco 99,9:
// mercado 99,9 com stop 98,55 (risco 1,35, alvo 101,5 a 1,19R); nivel do plano 99,5.
const plan: WatchPlan = {
  direction: 'long', triggerType: 'zone_reaction', zoneLow: 99, zoneHigh: 99.5, invalidation: 98.8,
  target1: 101.5, target2: 103, validForCandles: 16, trigger: 'Rejection in the top third of 99-99.5',
};
const swings = [{ kind: 'high' as const, price: 101.5 }, { kind: 'low' as const, price: 98.8 }];
const real = (price: number, patch: Partial<RealDataInput> = {}): RealDataInput =>
  ({ price, atr: 1, htfTrend: null, swings, late: { long: false, short: false }, volRegime: null, rangePosPct: 60, ...patch });
/** Checklist C1..C7 com os itens de `fails` em FAIL. */
const checks = (...fails: number[]) =>
  [1, 2, 3, 4, 5, 6, 7].map((n) => `C${n} ${fails.includes(n) ? 'FAIL' : 'PASS'}: 99.5`).join('; ');

const base: SignalDecisionInput = {
  state: 'ENTER_NOW',
  recommendation: 'BUY',
  confidence: 60,
  trendStrength: 'strong',
  structureValidation: checks(5),
  symbol: 'XAUUSD',
  currentPrice: 99.9,
  watchPlan: plan,
  estimatedLevels: null,
  probabilities: { probabilityTp1: 61, probabilityTp2: 40, probabilityStop: 39 },
  realData: real(99.9),
  planFailures: [],
};

const decide = (patch: Partial<SignalDecisionInput> = {}) => decideSignal({ ...base, ...patch });
const watch = { state: 'WATCH' as const, recommendation: 'WAIT' as const };
/** Alvo perto demais para entrar a 99,9 (o nivel do plano em 99,5 ainda serve ao WATCH). */
const nearTarget = { ...plan, target1: 100.9, target2: null };

beforeEach(() => {
  getEventsForSymbol.mockReset();
  process.env.ENABLE_NEWS_GUARD = 'false';
});

afterAll(() => {
  if (saved === undefined) delete process.env.ENABLE_NEWS_GUARD; else process.env.ENABLE_NEWS_GUARD = saved;
});

describe('decideSignal: estados que passam', () => {
  it('ENTER_NOW com a entrada a mercado valida: no preco real, stop pela invalidacao, TP1 no alvo', async () => {
    const d = await decide();
    expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', entryType: 'market', validatorNotes: [], validatorAction: 'none' });
    expect(d.levels.entry).toBeCloseTo(99.9);
    expect(d.levels.stopLoss).toBeCloseTo(98.55);
    expect(d.levels.takeProfit1).toBeCloseTo(101.5);
    expect(d.levels.takeProfit2).toBe(103);
    expect(d.watchPlan).toEqual(plan);
    expect(d.dataMode).toBe('real_data');
  });

  it('SELL espelhado: ENTER_NOW a mercado', async () => {
    const short: WatchPlan = { ...plan, direction: 'short', zoneLow: 100.5, zoneHigh: 101, invalidation: 101.2, target1: 98.5, target2: 97 };
    const d = await decide({
      recommendation: 'SELL', watchPlan: short,
      realData: real(100.1, { swings: [{ kind: 'high', price: 101.2 }] }),
    });
    expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'SELL', entryType: 'market' });
    expect(d.levels.stopLoss).toBeCloseTo(101.45);
  });

  it('a invalidacao vira a swing real entre o preco e a do modelo (ate 0,5 ATR) e o stop sai dela', async () => {
    const d = await decide({ realData: real(99.9, { swings: [{ kind: 'low', price: 98.72 }, { kind: 'low', price: 99.05 }] }) });
    expect(d.watchPlan?.invalidation).toBe(99.05);
    expect(d.levels.stopLoss).toBeCloseTo(98.8);
  });

  it('NO_TRADE do modelo fica NO_TRADE, sem niveis', async () => {
    const d = await decide({ state: 'NO_TRADE', recommendation: 'WAIT', confidence: 30 });
    expect(d).toMatchObject({ state: 'NO_TRADE', recommendation: 'WAIT', entryType: null, watchPlan: null, validatorNotes: [] });
  });
});

describe('decideSignal: a ordem limit (ARMED) nao e mais emitida', () => {
  it('ARMED do modelo vira WATCH com o mesmo plano e o nivel, sem niveis principais', async () => {
    const d = await decide({ state: 'ARMED' });
    expect(d).toMatchObject({ state: 'WATCH', recommendation: 'WAIT', entryType: null, validatorAction: 'downgraded' });
    expect(d.validatorNotes).toEqual([{ from: 'ARMED', to: 'WATCH', reason: 'limit_order_retired' }]);
    expect(d.watchPlan).toEqual(plan);
    expect(d.levels.entry).toBeNull();
  });

  it('ARMED do modelo nao sobe para ENTER_NOW, mesmo com a entrada a mercado valida', async () => {
    expect((await decide({ state: 'ARMED' })).state).toBe('WATCH');
  });

  it('ARMED sem geometria nenhuma cai ate NO_TRADE, cada degrau anotado', async () => {
    const d = await decide({ state: 'ARMED', realData: real(99.9, { atr: 0.3 }) });
    expect(d.validatorNotes).toEqual([
      { from: 'ARMED', to: 'WATCH', reason: 'limit_order_retired' },
      { from: 'WATCH', to: 'NO_TRADE', reason: 'no_valid_geometry' },
    ]);
  });
});

describe('WATCH: os niveis que o motor usaria ao destravar no nivel (watchLevels)', () => {
  it('TP1 com o teto de 1,5R a partir do nivel, nao o alvo cru do modelo', async () => {
    const d = await decide({ state: 'ARMED' });
    expect(d.state).toBe('WATCH');
    // Nivel 99,5, stop 98,8 - 0,25 = 98,55 (sem calibracao), risco 0,95; alvo 101,5 daria 2,1R.
    expect(d.watchLevels).toMatchObject({ entry: 99.5, stopLoss: 98.55, takeProfit2: 103, tp1R: ENGINE_RULES.tp1CapR });
    expect(d.watchLevels!.takeProfit1).toBeCloseTo(99.5 + 1.5 * 0.95, 6);
    expect(d.watchLevels!.takeProfit1).toBeLessThan(plan.target1);
    expect(d.levels.entry).toBeNull();
  });

  it('com a margem calibrada do par e do regime (a mesma do validador e do rastreador)', async () => {
    const d = await decide({ state: 'ARMED', symbol: 'BTCUSDT', realData: real(99.9, { volRegime: 'normal' }) });
    expect(d.watchLevels!.stopLoss).toBeCloseTo(98.8 - STOP_MARGIN_P80['BTCUSDT:normal'], 6);
    const tracked = trackPlan({
      plan: d.watchPlan!, enterNow: false, atr: 1, marginAtr: STOP_MARGIN_P80['BTCUSDT:normal'],
      tf: [], tfStepMs: 60_000, fine: [[0, 100, 100.1, 99.9, 100, 0]], startMs: 0, resolveMs: 1,
    });
    expect(tracked.levels).toMatchObject({ entry: d.watchLevels!.entry, stopLoss: d.watchLevels!.stopLoss, takeProfit1: d.watchLevels!.takeProfit1 });
  });

  it('caso de producao (BTCUSD 5m, venda na zona 77480): TP1 vai de 3,4R para o teto', () => {
    const btc: WatchPlan = {
      direction: 'short', triggerType: 'zone_reaction', zoneLow: 77480, zoneHigh: 77502.8, invalidation: 77502.82,
      target1: 77316.2, target2: 77159.5, validForCandles: 16, trigger: '',
    };
    const levels = watchLevelsOf(btc, 'BTCUSD', { ...real(77417.34, { atr: 101.0614 }), volRegime: 'normal' })!;
    const margin = STOP_MARGIN_P80['BTCUSDT:normal'];
    expect(levels).toEqual(entryLevels(btc, 101.0614, nearEdge(btc), margin));
    expect(levels.entry).toBe(77480);
    expect(levels.tp1R).toBe(ENGINE_RULES.tp1CapR);
    expect(levels.takeProfit1).toBeGreaterThan(btc.target1);
  });

  it('entrada no nivel igual a invalidacao: o motor rejeita (wrong_side) e grava null', () => {
    const flat: WatchPlan = { ...plan, zoneLow: 98.8, zoneHigh: 98.8, invalidation: 98.8 };
    expect(entryLevels(flat, 1, nearEdge(flat), ENGINE_RULES.stopMarginAtr)).toBe('wrong_side');
    expect(watchLevelsOf(flat, 'XAUUSD', real(99.9))).toBeNull();
  });

  it('o validador mantem WATCH com a geometria do nivel rejeitada (preco dentro da zona, entrada a mercado valida)', async () => {
    // Mercado 99,3: risco 0,75, alvo 100,2 a 1,2R (vale). Nivel 99,5: risco 0,95, alvo a 0,74R (no_room).
    const inside = { ...plan, target1: 100.2, target2: null };
    expect(entryLevels(inside, 1, nearEdge(inside), ENGINE_RULES.stopMarginAtr)).toBe('no_room');
    const d = await decide({ ...watch, watchPlan: inside, currentPrice: 99.3, realData: real(99.3, { late: { long: true, short: false } }) });
    expect(d.state).toBe('WATCH');
    expect(d.watchLevels).toBeNull();
  });

  it('ENTER_NOW, NO_TRADE e sem REAL DATA: sem watchLevels', async () => {
    expect((await decide()).watchLevels).toBeNull();
    expect((await decide({ state: 'NO_TRADE', recommendation: 'WAIT' })).watchLevels).toBeNull();
    expect((await decide({ state: 'ARMED', realData: null })).watchLevels).toBeNull();
  });

  it('o campo vai gravado no resultado da analise', async () => {
    const d = await decide({ state: 'ARMED' });
    const persisted = buildPersistedAnalysisPayload({
      source: { signalState: d.state, watchPlan: d.watchPlan, watchLevels: d.watchLevels }, recommendation: 'WAIT', bias: 'bullish',
      confidence: 40, reasoning: 'WATCH',
    });
    expect(persisted.fullResponse.watchLevels).toEqual(d.watchLevels);
  });
});

describe('decideSignal: a escada de estados', () => {
  it('ENTER_NOW sem entrada a mercado valida vira WATCH com o nivel do plano', async () => {
    const d = await decide({ watchPlan: nearTarget });
    expect(d).toMatchObject({ state: 'WATCH', entryType: null, validatorAction: 'downgraded' });
    expect(d.validatorNotes).toEqual([{ from: 'ENTER_NOW', to: 'WATCH', reason: 'market_entry_invalid' }]);
    expect(d.levels.entry).toBeNull();
  });

  it('movimento atrasado: nunca a mercado', async () => {
    const d = await decide({ realData: real(99.9, { late: { long: true, short: false } }) });
    expect(d.state).toBe('WATCH');
    expect(validatorReasons(d.validatorNotes)).toEqual(['late_move']);
  });

  it.each([2, 6, 7])('C%i em FAIL: sem ENTER_NOW, fica WATCH', async (n) => {
    const d = await decide({ structureValidation: checks(n) });
    expect(d).toMatchObject({ state: 'WATCH' });
    expect(validatorReasons(d.validatorNotes)).toEqual(['required_check_failed']);
  });

  it('C3 em FAIL: NO_TRADE (sem setup, nem o WATCH fica)', async () => {
    const d = await decide({ structureValidation: checks(3) });
    expect(d).toMatchObject({ state: 'NO_TRADE', watchPlan: null });
    expect(d.validatorNotes.at(-1)).toEqual({ from: 'WATCH', to: 'NO_TRADE', reason: 'setup_failed' });
  });

  it(`PASS: ${ENGINE_RULES.minPass} bastam para entrar; 4 so para o WATCH; 3 nem isso`, async () => {
    expect((await decide({ structureValidation: checks(1, 5) })).state).toBe('ENTER_NOW');
    expect((await decide({ structureValidation: checks(1, 4, 5) })).state).toBe('WATCH');
    expect((await decide({ structureValidation: checks(1, 4, 5, 6) })).state).toBe('NO_TRADE');
  });

  it('nenhuma entrada valida: NO_TRADE (no_valid_geometry)', async () => {
    const d = await decide({ realData: real(99.9, { atr: 0.3, swings: [{ kind: 'low', price: 98.8 }] }) });
    expect(d.state).toBe('NO_TRADE');
    expect(d.validatorNotes.at(-1)?.reason).toBe('no_valid_geometry');
  });

  it('sem swing real entre o preco e a invalidacao, a ate 0,5 ATR: NO_TRADE', async () => {
    const d = await decide({ realData: real(99.9, { swings: [{ kind: 'low', price: 98.5 }] }) });
    expect(d).toMatchObject({ state: 'NO_TRADE', validatorNotes: [{ from: 'ENTER_NOW', to: 'NO_TRADE', reason: 'invalidation_unsnapped' }] });
  });

  it('preco alem da invalidacao: NO_TRADE', async () => {
    expect(await decide({ realData: real(98.7) })).toMatchObject({ state: 'NO_TRADE', validatorNotes: [{ from: 'ENTER_NOW', to: 'NO_TRADE', reason: 'plan_invalidated' }] });
  });
});

describe('decideSignal: so rebaixa, com uma excecao', () => {
  it('WATCH do modelo com todas as condicoes do ENTER_NOW: o codigo promove', async () => {
    const d = await decide(watch);
    expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', entryType: 'market', validatorAction: 'promoted' });
    expect(d.validatorNotes).toEqual([{ from: 'WATCH', to: 'ENTER_NOW', reason: 'market_entry_valid' }]);
  });

  it('WATCH do modelo sem entrada a mercado valida segue WATCH', async () => {
    expect(await decide({ ...watch, watchPlan: nearTarget })).toMatchObject({ state: 'WATCH', validatorNotes: [] });
  });

  it('estado de sinal com HOLD: vira WATCH com o plano, sem promover', async () => {
    const d = await decide({ recommendation: 'WAIT' });
    expect(d).toMatchObject({ state: 'WATCH', recommendation: 'WAIT', validatorNotes: [{ from: 'ENTER_NOW', to: 'WATCH', reason: 'state_mismatch' }] });
    expect(d.watchPlan).toEqual(plan);
  });

  it('sinal do lado oposto ao plano, plano incoerente ou preco implausivel: NO_TRADE', async () => {
    expect((await decide({ recommendation: 'SELL' })).validatorNotes).toEqual([{ from: 'ENTER_NOW', to: 'NO_TRADE', reason: 'state_mismatch' }]);
    expect((await decide({ ...watch, watchPlan: { ...plan, invalidation: 99.2 } })).validatorNotes).toEqual([{ from: 'WATCH', to: 'NO_TRADE', reason: 'watch_plan_invalid' }]);
    expect(await decide({ planFailures: ['implausible_price'] })).toMatchObject({ state: 'NO_TRADE', validatorAction: 'downgraded' });
  });

  it('correcao da ordem de grandeza sem mudanca de estado conta como fixed', async () => {
    expect(await decide({ priceFixed: true })).toMatchObject({ state: 'ENTER_NOW', validatorAction: 'fixed' });
  });

  it('print desatualizado: marca stalePrint sem mudar o estado', async () => {
    expect(await decide({ currentPrice: 98 })).toMatchObject({ state: 'ENTER_NOW', stalePrint: true, validatorNotes: [] });
  });
});

describe('modo leitura: onde o preco esta', () => {
  it('preco, posicao no range, tendencia do 4h e a distancia em ATR ate invalidacao, suporte, resistencia e nivel do plano', async () => {
    const d = await decide({ realData: real(99.9, { htfTrend: 'uptrend' }) });
    expect(d.location).toEqual({
      price: 99.9, atr: 1, rangePosPct: 60, htfTrend: 'uptrend',
      invalidation: { price: 98.8, atr: expect.closeTo(1.1, 5) },
      support: { price: 98.8, atr: expect.closeTo(1.1, 5) },
      resistance: { price: 101.5, atr: expect.closeTo(1.6, 5) },
      planLevel: { price: 99.5, atr: expect.closeTo(0.4, 5) },
    });
  });

  it('NO_TRADE: sem plano, so preco, range e swings; sem REAL DATA: null', async () => {
    const d = await decide({ state: 'NO_TRADE', recommendation: 'WAIT' });
    expect(d.location).toMatchObject({ invalidation: null, planLevel: null, support: { price: 98.8 } });
    expect((await decide({ realData: null })).location).toBeNull();
  });
});

describe('requiredPasses: agravantes nao se somam (no maximo 1 PASS a mais)', () => {
  it.each([
    ['XAUUSD', 'long', null, 5],
    ['EURUSD', 'long', null, 6],
    ['BTCUSDT', 'long', 'downtrend', 6],
    ['XAUUSD', 'short', 'uptrend', 6],
    ['NAS100', 'short', 'uptrend', 6],
    ['EURUSD', 'short', 'uptrend', 6],
    ['EURUSD', 'long', 'downtrend', 6],
    ['ETHUSDT', 'short', 'uptrend', 6],
    ['XAUUSD', 'short', 'downtrend', 5],
    ['XAUUSD', 'short', 'range', 5],
  ] as const)('%s %s com o 4h %s: %i', (symbol, dir, htf, n) => {
    expect(requiredPasses(symbol, dir, htf)).toBe(n);
  });

  it('forex com 5 PASS nao entra; contra o 4h idem', async () => {
    expect((await decide({ symbol: 'EURUSD', structureValidation: checks(1, 5) })).state).toBe('WATCH');
    expect((await decide({ structureValidation: checks(1, 5), realData: real(99.9, { htfTrend: 'downtrend' }) })).state).toBe('WATCH');
    expect((await decide({ structureValidation: checks(1, 5), realData: real(99.9, { htfTrend: 'uptrend' }) })).state).toBe('ENTER_NOW');
  });
});

describe('decideSignal: sem velas reais (niveis do modelo)', () => {
  const estimatedLevels = { entry: 99.3, stopLoss: 98.5, takeProfit1: 101, takeProfit2: 103 };

  it('sem niveis legiveis do modelo: WATCH com o plano', async () => {
    const d = await decide({ realData: null, currentPrice: 99.3 });
    expect(d).toMatchObject({ state: 'WATCH', dataMode: 'print', validatorNotes: [{ from: 'ENTER_NOW', to: 'WATCH', reason: 'levels_unverified' }] });
    expect(d.watchPlan).toEqual(plan);
  });

  it('dentro da zona o ENTER_NOW fica, com os niveis do modelo; fora dela, WATCH; nao promove', async () => {
    const d = await decide({ realData: null, estimatedLevels, currentPrice: 99.3 });
    expect(d).toMatchObject({ state: 'ENTER_NOW', entryType: 'market', dataMode: 'print', validatorNotes: [] });
    expect(d.levels).toEqual(estimatedLevels);
    expect((await decide({ realData: null, estimatedLevels })).validatorNotes).toEqual([{ from: 'ENTER_NOW', to: 'WATCH', reason: 'not_at_price' }]);
    expect((await decide({ ...watch, realData: null, estimatedLevels, currentPrice: 99.3 })).state).toBe('WATCH');
  });

  it('ARMED do modelo vira WATCH; preco lido alem da invalidacao: NO_TRADE', async () => {
    expect((await decide({ state: 'ARMED', realData: null, estimatedLevels })).validatorNotes).toEqual([{ from: 'ARMED', to: 'WATCH', reason: 'limit_order_retired' }]);
    expect((await decide({ realData: null, estimatedLevels, currentPrice: 98.7 })).state).toBe('NO_TRADE');
  });
});

describe('decideSignal: confianca e probabilidades', () => {
  it(`sinal: teto ${ENGINE_RULES.confidenceCap}, tendencia moderada ${ENGINE_RULES.confidenceCapModerateTrend}, fraca ${ENGINE_RULES.confidenceCapWeakTrend}`, async () => {
    expect((await decide({ confidence: 80 })).confidence).toBe(72);
    expect((await decide({ confidence: 80, trendStrength: 'moderate' })).confidence).toBe(68);
    expect((await decide({ confidence: 80, trendStrength: 'weak' })).confidence).toBe(58);
  });

  it('probabilityTp1 fica a 3 pontos da confianca e o TP2 nunca passa do TP1', async () => {
    const d = await decide({ confidence: 60, probabilities: { probabilityTp1: 75, probabilityTp2: 80, probabilityStop: 25 } });
    expect(d.probabilities).toEqual({ probabilityTp1: 63, probabilityTp2: 63, probabilityStop: 25 });
  });

  it('ao subir o TP1 para perto da confianca, o stop desce para no maximo 100 - TP1', async () => {
    const d = await decide({ confidence: 70, probabilities: { probabilityTp1: 55, probabilityTp2: 30, probabilityStop: 45 } });
    expect(d.probabilities).toEqual({ probabilityTp1: 67, probabilityTp2: 30, probabilityStop: 33 });
  });

  it('WATCH e NO_TRADE: confianca no maximo 49 e sem probabilidades', async () => {
    const d = await decide({ ...watch, confidence: 70, structureValidation: checks(2) });
    expect(d.state).toBe('WATCH');
    expect(d.confidence).toBe(ENGINE_RULES.confidenceCapNoSignal);
    expect(d.probabilities).toEqual({ probabilityTp1: null, probabilityTp2: null, probabilityStop: null });
  });
});

describe('decideSignal: regras que so medem', () => {
  it('stop antes da invalidacao so mede', async () => {
    const d = await decide({ planFailures: ['stop_inside_invalidation'] });
    expect(d).toMatchObject({ state: 'ENTER_NOW', validatorFlags: ['stop_inside_invalidation'], validatorNotes: [] });
  });
});

describe('decideSignal: news guard', () => {
  beforeEach(() => { process.env.ENABLE_NEWS_GUARD = 'true'; });
  const event = (minutesUntil: number, impact = 'High') => ({ impact, minutesUntil, country: 'USD', title: 'CPI m/m' });

  it('evento High na janela: o sinal vira WATCH com o plano condicional', async () => {
    getEventsForSymbol.mockResolvedValue({ events: [event(30)], degraded: false });
    const d = await decide();
    expect(d).toMatchObject({ state: 'WATCH', validatorNotes: [{ from: 'ENTER_NOW', to: 'WATCH', reason: 'news_event' }], newsGuardStatus: 'event', newsEvent: 'USD CPI m/m (30min)' });
    expect(d.watchPlan).toEqual(plan);
  });

  it.each([
    ['fora da janela', [event(90)], false, 'no_event'],
    ['impacto medio', [event(10, 'Medium')], false, 'no_event'],
    ['fonte degradada sem evento', [], true, 'degraded_no_event'],
  ])('%s: nao rebaixa', async (_n, events, degraded, status) => {
    getEventsForSymbol.mockResolvedValue({ events, degraded });
    expect(await decide()).toMatchObject({ state: 'ENTER_NOW', newsGuardStatus: status });
  });

  it('fonte degradada com o evento no cache: rebaixa', async () => {
    getEventsForSymbol.mockResolvedValue({ events: [event(5)], degraded: true });
    expect(await decide()).toMatchObject({ state: 'WATCH', newsGuardStatus: 'degraded_event' });
  });

  it('erro do calendario: segue sem rebaixar, status error', async () => {
    getEventsForSymbol.mockRejectedValue(new Error('calendar timed out'));
    expect(await decide()).toMatchObject({ state: 'ENTER_NOW', newsGuardStatus: 'error' });
  });

  it('calendario sem resposta: espera 6 s e segue (timeout)', async () => {
    jest.useFakeTimers();
    try {
      getEventsForSymbol.mockReturnValue(new Promise(() => undefined));
      const pending = decide();
      await jest.advanceTimersByTimeAsync(6_000);
      expect(await pending).toMatchObject({ state: 'ENTER_NOW', newsGuardStatus: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('sem sinal nao consulta o calendario (skipped); chave desligada = disabled', async () => {
    expect(await decide({ state: 'NO_TRADE', recommendation: 'WAIT' })).toMatchObject({ newsGuardStatus: 'skipped' });
    expect(getEventsForSymbol).not.toHaveBeenCalled();
    process.env.ENABLE_NEWS_GUARD = 'false';
    expect(await decide()).toMatchObject({ newsGuardStatus: 'disabled' });
  });
});

describe('chave ENGINE_ENTER_AT_LEVEL: reanalise com o preco na zona do WATCH', () => {
  const FLAG = 'ENGINE_ENTER_AT_LEVEL';
  const lateLong = { late: { long: true, short: false } };
  const atZone = { ...watch, structureValidation: checks(5), currentPrice: 99.3, realData: real(99.3, lateLong), priorWatch: { plan, confirmed: true } };
  const withFlag = async <T>(value: 'true' | 'false', run: () => Promise<T>): Promise<T> => {
    const before = process.env[FLAG];
    process.env[FLAG] = value;
    try { return await run(); } finally { if (before === undefined) delete process.env[FLAG]; else process.env[FLAG] = before; }
  };

  it('desligada, o recuo ate a zona continua contando como atrasado (o que barra hoje)', async () => {
    const r = await withFlag('false', () => decide(atZone));
    expect(r.state).toBe('WATCH');
    expect(r.enterAtLevel).toBe(false);
    const fromModel = await withFlag('false', () => decide({ ...atZone, state: 'ENTER_NOW', recommendation: 'BUY' }));
    expect(fromModel.state).toBe('WATCH');
    expect(fromModel.validatorNotes).toEqual([{ from: 'ENTER_NOW', to: 'WATCH', reason: 'late_move' }]);
  });

  it('ligada, IA confirmou e preco na zona: ENTER_NOW com os niveis medidos do preco de agora', async () => {
    const r = await withFlag('true', () => decide(atZone));
    expect(r).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', enterAtLevel: true, validatorAction: 'promoted' });
    expect(r.levels.entry).toBe(99.3);
    expect(r.validatorNotes).toEqual([{ from: 'WATCH', to: 'ENTER_NOW', reason: 'market_entry_valid' }]);
  });

  it.each([
    ['IA nao confirmou', { priorWatch: { plan, confirmed: false } }],
    ['sem WATCH anterior', { priorWatch: null }],
    ['direcao trocada', { priorWatch: { plan: { ...plan, direction: 'short' as const, zoneLow: 99, zoneHigh: 99.5, invalidation: 100, target1: 97, target2: null }, confirmed: true } }],
    ['preco acima da zona', { currentPrice: 99.9, realData: real(99.9, lateLong) }],
  ])('ligada, %s: o atrasado continua valendo', async (_name, patch) => {
    const r = await withFlag('true', () => decide({ ...atZone, ...patch }));
    expect(r.state).toBe('WATCH');
    expect(r.enterAtLevel).toBe(false);
  });

  it.each([
    ['C7 reprovado', { structureValidation: checks(5, 7) }, 'WATCH'],
    ['C2 reprovado', { structureValidation: checks(5, 2) }, 'WATCH'],
    ['PASS abaixo do minimo', { structureValidation: checks(1, 4, 5) }, 'WATCH'],
    ['sem geometria', { watchPlan: { ...plan, target1: 99.8, target2: null } }, 'NO_TRADE'],
  ])('ligada, nenhuma outra regra afrouxa: %s', async (_name, patch, state) => {
    const r = await withFlag('true', () => decide({ ...atZone, ...patch }));
    expect(r.state).toBe(state);
    expect(r.enterAtLevel).toBe(false);
  });

  it('desligada = identico a hoje em toda a grade de cenarios', async () => {
    for (const price of [98.7, 99, 99.3, 99.5, 99.9, 100.4]) {
      for (const late of [true, false]) {
        for (const state of ['WATCH', 'ENTER_NOW', 'ARMED', 'NO_TRADE'] as const) {
          for (const confirmed of [true, false]) {
            const input = { ...base, state, recommendation: state === 'WATCH' || state === 'NO_TRADE' ? 'WAIT' as const : 'BUY' as const, currentPrice: price, realData: real(price, { late: { long: late, short: late } }) };
            const today = await withFlag('false', () => decide(input));
            const prior = await withFlag('false', () => decide({ ...input, priorWatch: { plan, confirmed } }));
            expect(prior).toEqual(today);
            expect(prior.enterAtLevel).toBe(false);
          }
        }
      }
    }
  });
});

describe('chave ENGINE_MARKET_PLAN_ON_WATCH: o WATCH mostra tambem o plano a mercado', () => {
  const FLAG = 'ENGINE_MARKET_PLAN_ON_WATCH';
  const lateLong = { late: { long: true, short: false } };
  const lateAtPrice = { ...watch, structureValidation: checks(5), currentPrice: 99.3, realData: real(99.3, lateLong) };
  const withFlag = async <T>(value: 'true' | 'false', run: () => Promise<T>): Promise<T> => {
    const before = process.env[FLAG];
    process.env[FLAG] = value;
    try { return await run(); } finally { if (before === undefined) delete process.env[FLAG]; else process.env[FLAG] = before; }
  };

  it('desligada: nenhum plano a mercado no WATCH, como sempre', async () => {
    const r = await withFlag('false', () => decide(lateAtPrice));
    expect(r.state).toBe('WATCH');
    expect(r.marketLevels).toBeNull();
  });

  it('ligada, atrasado segurou o ENTER_NOW: o estado segue WATCH e o plano a mercado vai junto', async () => {
    const r = await withFlag('true', () => decide(lateAtPrice));
    expect(r.state).toBe('WATCH');
    expect(r.recommendation).toBe('WAIT');
    expect(r.levels).toEqual({ entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null });
    expect(r.marketLevels).toMatchObject({ entry: 99.3 });
    expect(r.marketLevels!.stopLoss).toBeLessThan(99.3);
    expect(r.marketLevels!.takeProfit1).toBeGreaterThan(99.3);
    expect(r.marketLevels!.riskAtr).toBeLessThanOrEqual(ENGINE_RULES.riskMaxAtr);
    expect(r.marketLevels!.tp1R).toBeGreaterThanOrEqual(ENGINE_RULES.tp1MinR);
    expect(r.marketLevels!.tp1R).toBeLessThanOrEqual(ENGINE_RULES.tp1CapR);
  });

  it('ligada, C7 reprovado: mesmo plano a mercado, estado WATCH', async () => {
    const r = await withFlag('true', () => decide({ ...lateAtPrice, realData: real(99.3), structureValidation: checks(5, 7) }));
    expect(r.state).toBe('WATCH');
    expect(r.marketLevels).toMatchObject({ entry: 99.3 });
  });

  it('ligada, os niveis sao os mesmos que o ENTER_NOW teria com o checklist aprovado', async () => {
    const watchResult = await withFlag('true', () => decide(lateAtPrice));
    const enter = await withFlag('true', () => decide({ ...lateAtPrice, realData: real(99.3) }));
    expect(enter.state).toBe('ENTER_NOW');
    expect(enter.marketLevels).toBeNull();
    expect(watchResult.marketLevels).toMatchObject({ entry: enter.levels.entry, stopLoss: enter.levels.stopLoss, takeProfit1: enter.levels.takeProfit1 });
  });

  it('ligada, entrada a mercado sem geometria: nenhum plano a mercado', async () => {
    // Alvo logo acima do preco: sem 1R de espaco a mercado.
    const r = await withFlag('true', () => decide({ ...lateAtPrice, watchPlan: { ...plan, target1: 99.8, target2: null } }));
    expect(r.marketLevels).toBeNull();
  });

  it('ligada, sem velas reais ou NO_TRADE: nunca ha plano a mercado', async () => {
    expect((await withFlag('true', () => decide({ ...lateAtPrice, realData: null }))).marketLevels).toBeNull();
    expect((await withFlag('true', () => decide({ state: 'NO_TRADE', recommendation: 'WAIT' }))).marketLevels).toBeNull();
  });
});

describe('rejectedPlan: o plano do modelo que o codigo rebaixou para NO_TRADE', () => {
  it('guarda o plano cru (antes do encaixe) e o motivo', async () => {
    const r = await decide({ ...watch, realData: real(99.9, { swings: [] }) });
    expect(r.state).toBe('NO_TRADE');
    expect(r.watchPlan).toBeNull();
    expect(r.rejectedPlan).toEqual({ modelState: 'WATCH', reason: 'invalidation_unsnapped', plan });
  });

  it('guarda o motivo do degrau que chegou ao NO_TRADE', async () => {
    const r = await decide({ structureValidation: checks(3) });
    expect(r.state).toBe('NO_TRADE');
    expect(r.rejectedPlan).toEqual({ modelState: 'ENTER_NOW', reason: 'setup_failed', plan });
  });

  it('nao existe quando o NO_TRADE e do proprio modelo ou quando o plano sobrevive', async () => {
    expect((await decide({ state: 'NO_TRADE', recommendation: 'WAIT' })).rejectedPlan).toBeNull();
    expect((await decide()).rejectedPlan).toBeNull();
    expect((await decide({ ...watch })).rejectedPlan).toBeNull();
  });
});

describe('deriveSignalState: analises gravadas sem estado', () => {
  it.each([
    ['BUY', 'market', null, 'ENTER_NOW'],
    ['SELL', 'limit', null, 'ARMED'],
    ['COMPRA', null, null, 'ARMED'],
    ['WAIT', null, 'If price closes above 101, long', 'WATCH'],
    ['HOLD', null, '', 'NO_TRADE'],
    ['AGUARDAR', null, null, 'NO_TRADE'],
  ])('%s / %s / %s -> %s', (rec, type, alt, state) => {
    expect(deriveSignalState(rec, type, alt)).toBe(state);
  });
});

describe('storedSignalState: lista, setups e leitura do historico', () => {
  it('o estado gravado vence; sem ele, a regra do historico pelo resultado salvo', () => {
    expect(storedSignalState({ signalState: 'WATCH', analysis: { entryType: 'market' } }, 'BUY')).toBe('WATCH');
    expect(storedSignalState({ analysis: { entryType: 'market' } }, 'BUY')).toBe('ENTER_NOW');
    expect(storedSignalState({ signalState: 'LIVE', analysis: { alternativeScenario: 'x' } }, 'WAIT')).toBe('WATCH');
    expect(storedSignalState(null, 'WAIT')).toBe('NO_TRADE');
  });
});

describe('applyDecisionToAnalysis', () => {
  const analysis = {
    entry: 99.4, stopLoss: 98.6, takeProfit1: 100.6, takeProfit2: 101.6, entryType: 'limit', entryY: 0.4,
    invalidationLevel: 98.8, entryCondition: 'Pending order: buy limit 99.5', partialExitStrategy: 'Half at TP1',
    alternativeScenario: 'If price reacts at 99-99.5, long', riskFactors: 'Thin liquidity',
    probabilityTp1: 60, probabilityTp2: 40, probabilityStop: 40,
  };

  it('WATCH: zera niveis, plano de saida e probabilidades; mantem o cenario alternativo', async () => {
    const out = applyDecisionToAnalysis(analysis, await decide({ realData: null }));
    expect(out).toMatchObject({
      entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null, entryType: null, entryY: null,
      invalidationLevel: null, entryCondition: null, partialExitStrategy: null, riskRewardRatio: null,
      probabilityTp1: null, alternativeScenario: 'If price reacts at 99-99.5, long',
    });
  });

  it('sinal: niveis do motor (nao os do modelo), R:R recalculado; NO_TRADE tira o cenario; print velho entra em riskFactors', async () => {
    const enter: Record<string, any> = applyDecisionToAnalysis(analysis, await decide(), 'Outdated screenshot.');
    expect(enter.entry).toBeCloseTo(99.9);
    expect(enter.riskRewardTp1).toBeCloseTo(1.19, 1);
    expect(enter.riskRewardTp2).toBeCloseTo(2.3, 1);
    expect(enter).toMatchObject({ entryType: 'market', riskFactors: 'Thin liquidity\nOutdated screenshot.' });
    const none = applyDecisionToAnalysis(analysis, await decide({ state: 'NO_TRADE', recommendation: 'WAIT' }));
    expect(none.alternativeScenario).toBeNull();
  });
});

describe('chaves de 16/11/2026: ENGINE_SNAP_FALLBACK e ENGINE_ENTER_REQUIRED_CHECKS', () => {
  const SNAP = 'ENGINE_SNAP_FALLBACK';
  const CHECKS = 'ENGINE_ENTER_REQUIRED_CHECKS';
  const withFlags = async <T>(flags: Record<string, string>, run: () => Promise<T>): Promise<T> => {
    const before = Object.fromEntries(Object.keys(flags).map((k) => [k, process.env[k]]));
    Object.assign(process.env, flags);
    try { return await run(); } finally {
      for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
  /** Nenhum fundo real entre o preco e a invalidacao do modelo (98,8). */
  const noSwing = { realData: real(99.9, { swings: [{ kind: 'high' as const, price: 101.5 }, { kind: 'low' as const, price: 98 }] }) };

  describe('sem swing encaixada', () => {
    it.each(['0', 'abc', '7'])('valor %s: No trade, como sempre', async (value) => {
      const d = await withFlags({ [SNAP]: value }, () => decide(noSwing));
      expect(d).toMatchObject({ state: 'NO_TRADE', snapFallback: false, validatorNotes: [{ from: 'ENTER_NOW', to: 'NO_TRADE', reason: 'invalidation_unsnapped' }] });
    });

    it('1: o plano segue com a invalidacao do modelo, no maximo ate WATCH', async () => {
      const d = await withFlags({ [SNAP]: '1' }, () => decide(noSwing));
      expect(d).toMatchObject({ state: 'WATCH', recommendation: 'WAIT', snapFallback: true, rejectedPlan: null });
      expect(d.validatorNotes).toEqual([{ from: 'ENTER_NOW', to: 'WATCH', reason: 'invalidation_unsnapped' }]);
      expect(d.watchPlan?.invalidation).toBe(98.8);
      expect(d.levels.entry).toBeNull();
      const fromWatch = await withFlags({ [SNAP]: '1' }, () => decide({ ...watch, ...noSwing }));
      expect(fromWatch).toMatchObject({ state: 'WATCH', snapFallback: true, validatorNotes: [] });
    });

    it('2: ENTER_NOW com o stop saindo da invalidacao do modelo', async () => {
      const d = await withFlags({ [SNAP]: '2' }, () => decide(noSwing));
      expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', snapFallback: true, validatorNotes: [] });
      expect(d.levels.stopLoss).toBeCloseTo(98.55);
    });

    it('2: risco acima de 2 ATR continua barrando', async () => {
      const far = { ...plan, invalidation: 97 };
      const d = await withFlags({ [SNAP]: '2' }, () => decide({ ...noSwing, watchPlan: far }));
      expect(d.state).toBe('NO_TRADE');
      expect(validatorReasons(d.validatorNotes)).toEqual(['market_entry_invalid', 'no_valid_geometry']);
      expect(d.snapFallback).toBe(false);
    });

    it('com swing encaixada a chave nao muda nada', async () => {
      const off = await decide();
      const on = await withFlags({ [SNAP]: '2' }, () => decide());
      expect(on).toEqual(off);
      expect(on.snapFallback).toBe(false);
    });
  });

  describe('itens obrigatorios do ENTER_NOW', () => {
    it('0: C7 ou C2 em FAIL barra, como sempre', async () => {
      for (const fail of [7, 2]) {
        const d = await withFlags({ [CHECKS]: '0' }, () => decide({ structureValidation: checks(fail) }));
        expect(d).toMatchObject({ state: 'WATCH', entryWarnings: [], validatorNotes: [{ from: 'ENTER_NOW', to: 'WATCH', reason: 'required_check_failed' }] });
      }
    });

    it('1: C7 em FAIL vira aviso; C2 continua obrigatorio', async () => {
      const c7 = await withFlags({ [CHECKS]: '1' }, () => decide({ structureValidation: checks(7) }));
      expect(c7).toMatchObject({ state: 'ENTER_NOW', entryWarnings: [7], validatorNotes: [] });
      const c2 = await withFlags({ [CHECKS]: '1' }, () => decide({ structureValidation: checks(2) }));
      expect(c2.state).toBe('WATCH');
    });

    it('2: C2 e C7 viram aviso, com o minimo de PASS valendo', async () => {
      const both = await withFlags({ [CHECKS]: '2' }, () => decide({ structureValidation: checks(2, 7) }));
      expect(both).toMatchObject({ state: 'ENTER_NOW', entryWarnings: [2, 7] });
      const few = await withFlags({ [CHECKS]: '2' }, () => decide({ structureValidation: checks(2, 5, 7) }));
      expect(few).toMatchObject({ state: 'WATCH', entryWarnings: [] });
      expect(validatorReasons(few.validatorNotes)).toEqual(['checks_below_min']);
    });

    it.each([3, 6])('2: C%s continua obrigatorio', async (fail) => {
      const d = await withFlags({ [CHECKS]: '2' }, () => decide({ structureValidation: checks(fail) }));
      expect(d.state).not.toBe('ENTER_NOW');
    });

    it('2: sem velas reais nada afrouxa', async () => {
      const print = { realData: null, currentPrice: 99.3, estimatedLevels: { entry: 99.3, stopLoss: 98.6, takeProfit1: 101.5, takeProfit2: null }, structureValidation: checks(7) };
      const d = await withFlags({ [CHECKS]: '2' }, () => decide(print));
      expect(d).toMatchObject({ state: 'WATCH', entryWarnings: [] });
    });

    it('WATCH do modelo com C7 em FAIL sobe para ENTER_NOW com o aviso', async () => {
      const d = await withFlags({ [CHECKS]: '1' }, () => decide({ ...watch, structureValidation: checks(7) }));
      expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', validatorAction: 'promoted', entryWarnings: [7] });
    });
  });
});

describe('chaves de 16/11/2026: ENGINE_LATE_AS_WARNING e ENGINE_WATCH_ON_REJECTED_GEOMETRY', () => {
  const withFlag = async <T>(key: string, value: string, run: () => Promise<T>): Promise<T> => {
    const before = process.env[key];
    process.env[key] = value;
    try { return await run(); } finally { if (before === undefined) delete process.env[key]; else process.env[key] = before; }
  };
  const late = { realData: real(99.9, { late: { long: true, short: false } }) };

  it('atrasado desligada: rebaixa a WATCH, como sempre', async () => {
    const d = await withFlag('ENGINE_LATE_AS_WARNING', 'false', () => decide(late));
    expect(d).toMatchObject({ state: 'WATCH', entryWarnings: [], validatorNotes: [{ from: 'ENTER_NOW', to: 'WATCH', reason: 'late_move' }] });
  });

  it('atrasado ligada: ENTER_NOW com o aviso 8; sem atraso, nada muda', async () => {
    const d = await withFlag('ENGINE_LATE_AS_WARNING', 'true', () => decide(late));
    expect(d).toMatchObject({ state: 'ENTER_NOW', entryWarnings: [8], validatorNotes: [] });
    const promoted = await withFlag('ENGINE_LATE_AS_WARNING', 'true', () => decide({ ...watch, ...late }));
    expect(promoted).toMatchObject({ state: 'ENTER_NOW', validatorAction: 'promoted', entryWarnings: [8] });
    expect(await withFlag('ENGINE_LATE_AS_WARNING', 'true', () => decide())).toEqual(await decide());
  });

  it('atrasado ligada: geometria e checklist continuam barrando', async () => {
    const c7 = await withFlag('ENGINE_LATE_AS_WARNING', 'true', () => decide({ ...late, structureValidation: checks(7) }));
    expect(c7).toMatchObject({ state: 'WATCH', entryWarnings: [] });
    const far = await withFlag('ENGINE_LATE_AS_WARNING', 'true', () => decide({ ...late, watchPlan: nearTarget }));
    expect(far.state).toBe('WATCH');
  });

  /** Sem entrada valida a mercado nem no nivel: alvo a menos de 1R das duas. */
  const noGeometry = { ...watch, watchPlan: { ...plan, target1: 99.8, target2: null } };

  it('geometria desligada: WATCH sem geometria vira NO_TRADE, como sempre', async () => {
    const d = await withFlag('ENGINE_WATCH_ON_REJECTED_GEOMETRY', 'false', () => decide(noGeometry));
    expect(d).toMatchObject({ state: 'NO_TRADE', validatorNotes: [{ from: 'WATCH', to: 'NO_TRADE', reason: 'no_valid_geometry' }] });
  });

  it('geometria ligada: segue WATCH sem niveis, nunca ENTER_NOW; C3 e o minimo de PASS continuam valendo', async () => {
    const d = await withFlag('ENGINE_WATCH_ON_REJECTED_GEOMETRY', 'true', () => decide(noGeometry));
    expect(d).toMatchObject({ state: 'WATCH', recommendation: 'WAIT', watchLevels: null, validatorNotes: [], rejectedPlan: null });
    expect(d.levels.entry).toBeNull();
    const fromEnter = await withFlag('ENGINE_WATCH_ON_REJECTED_GEOMETRY', 'true', () => decide({ ...noGeometry, state: 'ENTER_NOW', recommendation: 'BUY' }));
    expect(fromEnter.state).toBe('WATCH');
    const c3 = await withFlag('ENGINE_WATCH_ON_REJECTED_GEOMETRY', 'true', () => decide({ ...noGeometry, structureValidation: checks(3) }));
    expect(c3.state).toBe('NO_TRADE');
    const few = await withFlag('ENGINE_WATCH_ON_REJECTED_GEOMETRY', 'true', () => decide({ ...noGeometry, structureValidation: checks(1, 2, 4, 5) }));
    expect(few.state).toBe('NO_TRADE');
  });
});

describe('modo permissivo (chave ENGINE_PERMISSIVE, 16/11/2026)', () => {
  const on = async <T>(run: () => Promise<T>, value = '1'): Promise<T> => {
    const before = process.env.ENGINE_PERMISSIVE;
    process.env.ENGINE_PERMISSIVE = value;
    try { return await run(); } finally { if (before === undefined) delete process.env.ENGINE_PERMISSIVE; else process.env.ENGINE_PERMISSIVE = before; }
  };

  it.each(['0', 'abc', '2'])('valor %s: identico ao motor de sempre', async (value) => {
    for (const patch of [{}, { structureValidation: checks(7) }, { structureValidation: checks(1, 4, 5) }, { realData: real(99.9, { late: { long: true, short: false } }) }]) {
      expect(await on(() => decide(patch), value)).toEqual(await decide(patch));
    }
    expect((await decide()).permissiveEntry).toBe(false);
  });

  it('C2, C7 e atrasado deixam de barrar e viram avisos; a entrada fica marcada como do modo', async () => {
    const d = await on(() => decide({ structureValidation: checks(2, 7), realData: real(99.9, { late: { long: true, short: false } }) }));
    expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', entryWarnings: [2, 7, 8], permissiveEntry: true, validatorNotes: [] });
    expect(d.levels.stopLoss).toBeCloseTo(98.55);
  });

  it('piso de 4 de 7: 4 PASS entra, 3 nao', async () => {
    const four = await on(() => decide({ structureValidation: checks(1, 2, 7) }));
    expect(four).toMatchObject({ state: 'ENTER_NOW', permissiveEntry: true });
    const three = await on(() => decide({ structureValidation: checks(1, 2, 4, 7) }));
    expect(three.state).toBe('NO_TRADE');
  });

  it.each([3, 6])('C%s em FAIL continua barrando', async (fail) => {
    expect((await on(() => decide({ structureValidation: checks(fail) }))).state).not.toBe('ENTER_NOW');
  });

  it('geometria invalida continua barrando: alvo abaixo de 1R e risco acima de 2 ATR', async () => {
    const noRoom = await on(() => decide({ watchPlan: nearTarget }));
    expect(noRoom.state).toBe('WATCH');
    const wide = await on(() => decide({ watchPlan: { ...plan, invalidation: 97 }, realData: real(99.9, { swings: [{ kind: 'low', price: 97 }] }) }));
    expect(wide.state).not.toBe('ENTER_NOW');
  });

  it('sem swing encaixada vale a invalidacao do modelo, dentro dos limites de risco', async () => {
    const d = await on(() => decide({ realData: real(99.9, { swings: [{ kind: 'low', price: 98 }] }) }));
    expect(d).toMatchObject({ state: 'ENTER_NOW', snapFallback: true, permissiveEntry: true });
    expect(d.watchPlan?.invalidation).toBe(98.8);
  });

  it('contra o 4h e forex viram avisos em vez de exigir 6 PASS', async () => {
    const htf = await on(() => decide({ structureValidation: checks(1, 5), realData: real(99.9, { htfTrend: 'downtrend' }) }));
    expect(htf).toMatchObject({ state: 'ENTER_NOW', entryWarnings: [9], permissiveEntry: true });
    const fx = await on(() => decide({ symbol: 'EURUSD', structureValidation: checks(4, 5) }));
    expect(fx).toMatchObject({ state: 'ENTER_NOW', entryWarnings: [10], permissiveEntry: true });
  });

  it('entrada que o motor de sempre ja daria nao e marcada como do modo', async () => {
    expect(await on(() => decide())).toMatchObject({ state: 'ENTER_NOW', entryWarnings: [], permissiveEntry: false });
  });

  it('WATCH do modelo com geometria a mercado valida sobe para ENTER_NOW; NO_TRADE do modelo fica', async () => {
    const up = await on(() => decide({ ...watch, structureValidation: checks(2, 7) }));
    expect(up).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', validatorAction: 'promoted' });
    expect((await on(() => decide({ state: 'NO_TRADE', recommendation: 'WAIT' }))).state).toBe('NO_TRADE');
  });

  it('noticias continuam rebaixando', async () => {
    process.env.ENABLE_NEWS_GUARD = 'true';
    getEventsForSymbol.mockResolvedValue({ events: [{ impact: 'High', minutesUntil: 10, country: 'US', title: 'CPI' }], degraded: false });
    const d = await on(() => decide({ structureValidation: checks(2, 7) }));
    expect(d).toMatchObject({ state: 'WATCH', permissiveEntry: false, entryWarnings: [] });
  });

  it('sem velas: C2 e C7 viram aviso, mas o preco fora da zona continua barrando', async () => {
    const est = { entry: 99.3, stopLoss: 98.6, takeProfit1: 101.5, takeProfit2: null };
    const inside = await on(() => decide({ realData: null, currentPrice: 99.3, estimatedLevels: est, structureValidation: checks(2, 7) }));
    expect(inside).toMatchObject({ state: 'ENTER_NOW', dataMode: 'print', entryWarnings: [2, 7], permissiveEntry: true });
    const outside = await on(() => decide({ realData: null, currentPrice: 99.9, estimatedLevels: est, structureValidation: checks(2, 7) }));
    expect(outside.state).toBe('WATCH');
  });
});

describe('entrada pendente (chave ENGINE_PENDING_ENTRY_LABEL, so apresentacao)', () => {
  const run = async (value: string, patch: Partial<SignalDecisionInput>) => {
    const before = process.env.ENGINE_PENDING_ENTRY_LABEL;
    process.env.ENGINE_PENDING_ENTRY_LABEL = value;
    try { return await decide(patch); } finally { if (before === undefined) delete process.env.ENGINE_PENDING_ENTRY_LABEL; else process.env.ENGINE_PENDING_ENTRY_LABEL = before; }
  };
  /** WATCH do modelo que fica WATCH: C7 em FAIL, com niveis validos no recuo. */
  const waiting = { ...watch, structureValidation: checks(7) };

  it('ligada: WATCH com niveis validos no nivel ganha pendingEntry; o estado e o resto nao mudam', async () => {
    const off = await run('0', waiting);
    const on = await run('1', waiting);
    expect(off).toMatchObject({ state: 'WATCH', pendingEntry: false });
    expect(off.watchLevels).not.toBeNull();
    expect(on).toEqual({ ...off, pendingEntry: true });
  });

  it('ligada: sem niveis validos, ENTER_NOW e NO_TRADE nunca sao entrada pendente', async () => {
    expect(await run('1', {})).toMatchObject({ state: 'ENTER_NOW', pendingEntry: false });
    expect(await run('1', { state: 'NO_TRADE', recommendation: 'WAIT' })).toMatchObject({ state: 'NO_TRADE', pendingEntry: false });
    const print = await run('1', { ...waiting, realData: null });
    expect(print).toMatchObject({ state: 'WATCH', watchLevels: null, pendingEntry: false });
    expect((await run('abc', waiting)).pendingEntry).toBe(false);
  });
});

describe('alvo no proximo nivel (chave ENGINE_NEXT_TARGET)', () => {
  const run = async (value: string, patch: Partial<SignalDecisionInput>) => {
    const before = process.env.ENGINE_NEXT_TARGET;
    process.env.ENGINE_NEXT_TARGET = value;
    try { return await decide(patch); } finally { if (before === undefined) delete process.env.ENGINE_NEXT_TARGET; else process.env.ENGINE_NEXT_TARGET = before; }
  };
  /** Primeiro nivel a 0,74R da entrada a mercado; o seguinte a 2,3R. */
  const close = { watchPlan: { ...plan, target1: 100.9, target2: 103 } };

  it('desligada: primeiro nivel perto barra a entrada, como sempre', async () => {
    const d = await run('false', close);
    expect(d).toMatchObject({ state: 'WATCH', targetMoved: false, entryWarnings: [] });
    expect(validatorReasons(d.validatorNotes)).toEqual(['market_entry_invalid']);
  });

  it('ligada: TP1 vai para o proximo nivel com o teto de 1,5R, aviso 11 e targetMoved', async () => {
    const d = await run('true', close);
    expect(d).toMatchObject({ state: 'ENTER_NOW', targetMoved: true, entryWarnings: [11] });
    expect(d.levels.takeProfit1).toBeCloseTo(99.9 + 1.5 * 1.35);
    expect(d.levels.takeProfit2).toBeNull();
  });

  it('ligada: sem proximo nivel, ou com ele tambem abaixo de 1R, nada muda; primeiro nivel ja bom nao e mexido', async () => {
    expect((await run('true', { watchPlan: { ...plan, target1: 100.9, target2: null } })).state).toBe('WATCH');
    expect((await run('true', { watchPlan: { ...plan, target1: 100.5, target2: 100.9 } })).state).toBe('WATCH');
    const good = await run('true', {});
    expect(good).toEqual(await run('false', {}));
    expect(good.targetMoved).toBe(false);
  });

  it('ligada: WATCH no recuo tambem usa o proximo nivel e marca targetMoved', async () => {
    const recuo = { ...watch, structureValidation: checks(7), watchPlan: { ...plan, target1: 100.0, target2: 103 } };
    const off = await run('false', recuo);
    const on = await run('true', recuo);
    expect(off.watchLevels).toBeNull();
    expect(on).toMatchObject({ state: 'WATCH', targetMoved: true });
    expect(on.watchLevels?.tp1R).toBeGreaterThanOrEqual(1);
  });
});
