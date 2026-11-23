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
  decideSignalForProfile,
  deriveSignalState,
  requiredPasses,
  storedSignalState,
  validatorReasons,
  type RealDataInput,
  type SignalDecisionInput,
  watchLevelsOf,
} from './signal-decision';
import { ENGINE_RULES, PROFILE_GATES, type WatchPlan, entryLevels, nearEdge, trackPlan, withProfileGates } from './plan-engine';
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

/** O motor de antes do modo permissivo (perfil Conservador): as regras estritas de ENGINE_RULES. */
const decide = (patch: Partial<SignalDecisionInput> = {}) => withProfileGates(PROFILE_GATES.conservative, () => decideSignal({ ...base, ...patch }));
/** O motor de hoje (Equilibrado): modo permissivo fixo, sem perfil aplicado. */
const decideBalanced = (patch: Partial<SignalDecisionInput> = {}) => decideSignal({ ...base, ...patch });
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

  it('ARMED sem geometria nenhuma segue WATCH sem niveis, o degrau anotado', async () => {
    const d = await decide({ state: 'ARMED', realData: real(99.9, { atr: 0.3 }) });
    expect(d.state).toBe('WATCH');
    expect(d.watchLevels).toBeNull();
    expect(d.validatorNotes).toEqual([
      { from: 'ARMED', to: 'WATCH', reason: 'limit_order_retired' },
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

  it('nenhuma entrada valida: ENTER_NOW cai a WATCH sem niveis (market_entry_invalid)', async () => {
    const d = await decide({ realData: real(99.9, { atr: 0.3, swings: [{ kind: 'low', price: 98.8 }] }) });
    expect(d.state).toBe('WATCH');
    expect(d.watchLevels).toBeNull();
    expect(d.validatorNotes.at(-1)?.reason).toBe('market_entry_invalid');
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

describe('perfil Conservador: o motor de antes do modo permissivo', () => {
  /** Nenhum fundo real entre o preco e a invalidacao do modelo (98,8). */
  const noSwing = { realData: real(99.9, { swings: [{ kind: 'high' as const, price: 101.5 }, { kind: 'low' as const, price: 98 }] }) };
  const late = { realData: real(99.9, { late: { long: true, short: false } }) };

  it('sem swing encaixada: No trade, com invalidation_unsnapped', async () => {
    const d = await decide(noSwing);
    expect(d).toMatchObject({ state: 'NO_TRADE', validatorNotes: [{ from: 'ENTER_NOW', to: 'NO_TRADE', reason: 'invalidation_unsnapped' }] });
  });

  it('C2 ou C7 em FAIL barram o ENTER_NOW', async () => {
    for (const fail of [7, 2]) {
      const d = await decide({ structureValidation: checks(fail) });
      expect(d).toMatchObject({ state: 'WATCH', entryWarnings: [], validatorNotes: [{ from: 'ENTER_NOW', to: 'WATCH', reason: 'required_check_failed' }] });
    }
  });

  it('movimento atrasado rebaixa a WATCH', async () => {
    const d = await decide(late);
    expect(d).toMatchObject({ state: 'WATCH', entryWarnings: [], validatorNotes: [{ from: 'ENTER_NOW', to: 'WATCH', reason: 'late_move' }] });
  });

  it('o piso de PASS e o de sempre (5, ou 6 com agravante), nao o do modo permissivo', async () => {
    expect((await decide({ structureValidation: checks(1, 2, 7) })).state).not.toBe('ENTER_NOW');
  });
});

describe('modo permissivo (fixo, 16/11/2026)', () => {
  it('sem perfil aplicado, C2, C7 e atrasado deixam de barrar e viram avisos; a entrada fica marcada como do modo', async () => {
    const d = await decideBalanced({ structureValidation: checks(2, 7), realData: real(99.9, { late: { long: true, short: false } }) });
    expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', entryWarnings: [2, 7, 8], permissiveEntry: true, validatorNotes: [] });
    expect(d.levels.stopLoss).toBeCloseTo(98.55);
  });

  it('atrasado so: ENTER_NOW com o aviso 8; sem atraso nada muda; WATCH do modelo sobe com o aviso', async () => {
    const late = { realData: real(99.9, { late: { long: true, short: false } }) };
    expect(await decideBalanced(late)).toMatchObject({ state: 'ENTER_NOW', entryWarnings: [8], validatorNotes: [] });
    expect(await decideBalanced({ ...watch, ...late })).toMatchObject({ state: 'ENTER_NOW', validatorAction: 'promoted', entryWarnings: [8] });
    expect(await decideBalanced()).toMatchObject({ state: 'ENTER_NOW', entryWarnings: [], permissiveEntry: false });
  });

  it('atrasado: geometria e checklist continuam barrando', async () => {
    const late = { realData: real(99.9, { late: { long: true, short: false } }) };
    expect(await decideBalanced({ ...late, structureValidation: checks(1, 2, 4, 7) })).toMatchObject({ state: 'NO_TRADE' });
    expect((await decideBalanced({ ...late, watchPlan: nearTarget })).state).toBe('WATCH');
  });

  it('piso de 4 de 7: 4 PASS entra, 3 nao', async () => {
    expect(await decideBalanced({ structureValidation: checks(1, 2, 7) })).toMatchObject({ state: 'ENTER_NOW', permissiveEntry: true });
    expect((await decideBalanced({ structureValidation: checks(1, 2, 4, 7) })).state).toBe('NO_TRADE');
  });

  it.each([3, 6])('C%s em FAIL continua barrando', async (fail) => {
    expect((await decideBalanced({ structureValidation: checks(fail) })).state).not.toBe('ENTER_NOW');
  });

  it('geometria invalida continua barrando: alvo abaixo de 1R e risco acima de 2 ATR', async () => {
    expect((await decideBalanced({ watchPlan: nearTarget })).state).toBe('WATCH');
    const wide = await decideBalanced({ watchPlan: { ...plan, invalidation: 97 }, realData: real(99.9, { swings: [{ kind: 'low', price: 97 }] }) });
    expect(wide.state).not.toBe('ENTER_NOW');
  });

  it('sem swing encaixada vale a invalidacao do modelo, dentro dos limites de risco', async () => {
    const d = await decideBalanced({ realData: real(99.9, { swings: [{ kind: 'low', price: 98 }] }) });
    expect(d).toMatchObject({ state: 'ENTER_NOW', permissiveEntry: true, validatorNotes: [] });
    expect(d.watchPlan?.invalidation).toBe(98.8);
    expect(d.levels.stopLoss).toBeCloseTo(98.55);
    const far = await decideBalanced({ watchPlan: { ...plan, invalidation: 97 }, realData: real(99.9, { swings: [{ kind: 'low', price: 98 }] }) });
    expect(far.state).toBe('WATCH');
    expect(far.watchLevels).toBeNull();
    expect(validatorReasons(far.validatorNotes)).toEqual(['market_entry_invalid']);
  });

  it('contra o 4h e forex viram avisos em vez de exigir 6 PASS', async () => {
    const htf = await decideBalanced({ structureValidation: checks(1, 5), realData: real(99.9, { htfTrend: 'downtrend' }) });
    expect(htf).toMatchObject({ state: 'ENTER_NOW', entryWarnings: [9], permissiveEntry: true });
    const fx = await decideBalanced({ symbol: 'EURUSD', structureValidation: checks(4, 5) });
    expect(fx).toMatchObject({ state: 'ENTER_NOW', entryWarnings: [10], permissiveEntry: true });
  });

  it('WATCH do modelo com geometria a mercado valida sobe para ENTER_NOW; NO_TRADE do modelo fica', async () => {
    const up = await decideBalanced({ ...watch, structureValidation: checks(2, 7) });
    expect(up).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', validatorAction: 'promoted' });
    expect((await decideBalanced({ state: 'NO_TRADE', recommendation: 'WAIT' })).state).toBe('NO_TRADE');
  });

  it('noticias continuam rebaixando', async () => {
    process.env.ENABLE_NEWS_GUARD = 'true';
    getEventsForSymbol.mockResolvedValue({ events: [{ impact: 'High', minutesUntil: 10, country: 'US', title: 'CPI' }], degraded: false });
    const d = await decideBalanced({ structureValidation: checks(2, 7) });
    expect(d).toMatchObject({ state: 'WATCH', permissiveEntry: false, entryWarnings: [] });
  });

  it('sem velas: C2 e C7 viram aviso, mas o preco fora da zona continua barrando', async () => {
    const est = { entry: 99.3, stopLoss: 98.6, takeProfit1: 101.5, takeProfit2: null };
    const inside = await decideBalanced({ realData: null, currentPrice: 99.3, estimatedLevels: est, structureValidation: checks(2, 7) });
    expect(inside).toMatchObject({ state: 'ENTER_NOW', dataMode: 'print', entryWarnings: [2, 7], permissiveEntry: true });
    const outside = await decideBalanced({ realData: null, currentPrice: 99.9, estimatedLevels: est, structureValidation: checks(2, 7) });
    expect(outside.state).toBe('WATCH');
  });
});

describe('WATCH sem geometria valida (fixo): segue WATCH sem niveis em vez de No trade', () => {
  /** Sem entrada valida a mercado nem no nivel: alvo a menos de 1R das duas. */
  const noGeometry = { ...watch, watchPlan: { ...plan, target1: 99.8, target2: null } };

  it('segue WATCH sem niveis, nunca ENTER_NOW; C3 e o minimo de PASS continuam valendo', async () => {
    const d = await decide(noGeometry);
    expect(d).toMatchObject({ state: 'WATCH', recommendation: 'WAIT', watchLevels: null, validatorNotes: [], rejectedPlan: null });
    expect(d.levels.entry).toBeNull();
    expect((await decide({ ...noGeometry, state: 'ENTER_NOW', recommendation: 'BUY' })).state).toBe('WATCH');
    expect((await decide({ ...noGeometry, structureValidation: checks(3) })).state).toBe('NO_TRADE');
    expect((await decide({ ...noGeometry, structureValidation: checks(1, 2, 4, 5) })).state).toBe('NO_TRADE');
  });
});

describe('entrada pendente (fixo, so apresentacao)', () => {
  /** WATCH do modelo que fica WATCH: C7 em FAIL, com niveis validos no recuo. */
  const waiting = { ...watch, structureValidation: checks(7) };

  it('WATCH com niveis validos no nivel ganha pendingEntry', async () => {
    const d = await decide(waiting);
    expect(d).toMatchObject({ state: 'WATCH', pendingEntry: true });
    expect(d.watchLevels).not.toBeNull();
  });

  it('sem niveis validos, ENTER_NOW e NO_TRADE nunca sao entrada pendente', async () => {
    expect(await decide({})).toMatchObject({ state: 'ENTER_NOW', pendingEntry: false });
    expect(await decide({ state: 'NO_TRADE', recommendation: 'WAIT' })).toMatchObject({ state: 'NO_TRADE', pendingEntry: false });
    expect(await decide({ ...waiting, realData: null })).toMatchObject({ state: 'WATCH', watchLevels: null, pendingEntry: false });
  });
});

describe('alvo no proximo nivel (fixo)', () => {
  /** Primeiro nivel a 0,74R da entrada a mercado; o seguinte a 2,3R. */
  const close = { watchPlan: { ...plan, target1: 100.9, target2: 103 } };

  it('TP1 vai para o proximo nivel com o teto de 1,5R, aviso 11 e targetMoved', async () => {
    const d = await decide(close);
    expect(d).toMatchObject({ state: 'ENTER_NOW', targetMoved: true, entryWarnings: [11] });
    expect(d.levels.takeProfit1).toBeCloseTo(99.9 + 1.5 * 1.35);
    expect(d.levels.takeProfit2).toBeNull();
  });

  it('sem proximo nivel, ou com ele tambem abaixo de 1R, nada muda; primeiro nivel ja bom nao e mexido', async () => {
    expect((await decide({ watchPlan: { ...plan, target1: 100.9, target2: null } })).state).toBe('WATCH');
    expect((await decide({ watchPlan: { ...plan, target1: 100.5, target2: 100.9 } })).state).toBe('WATCH');
    expect((await decide({})).targetMoved).toBe(false);
  });

  it('WATCH no recuo tambem usa o proximo nivel e marca targetMoved', async () => {
    const recuo = { ...watch, structureValidation: checks(7), watchPlan: { ...plan, target1: 100.0, target2: 103 } };
    const d = await decide(recuo);
    expect(d).toMatchObject({ state: 'WATCH', targetMoved: true });
    expect(d.watchLevels?.tp1R).toBeGreaterThanOrEqual(1);
  });
});

describe('perfis de risco (17/11/2026)', () => {
  // XAUUSD 5M de 16/11/2026 22:53 BRT (prompt D): venda dentro da zona, regime de volatilidade alto.
  const swings = [3856.66975, 3855.85464, 3857.30921, 3866.13478, 3841.13083, 3861.00386, 3861.52612, 3856.68556]
    .map((price) => ({ kind: 'low' as 'low' | 'high', price }))
    .concat([3861.45113, 3860.85817, 3870.11881, 3870.86785, 3851.35571, 3866.92385, 3866.25575, 3865.13177, 3854.75104].map((price) => ({ kind: 'high' as const, price })));
  const gold = {
    state: 'WATCH' as const, recommendation: 'WAIT' as const, confidence: 50, trendStrength: 'moderate',
    structureValidation: 'C1 PASS: a. C2 PASS: b. C3 PASS: c. C4 PASS: d. C5 PASS: e. C6 FAIL market Rk5.33, limit valid. C7 PASS: g. 6/7, WATCH.',
    symbol: 'XAUUSD', currentPrice: 3866.95,
    watchPlan: { direction: 'short' as const, triggerType: 'sweep_reclaim' as const, zoneLow: 3864.44, zoneHigh: 3870.36, invalidation: 3870.86785, target1: 3862.5, target2: 3854.16, validForCandles: 16, trigger: 'x' },
    estimatedLevels: null, probabilities: { probabilityTp1: null, probabilityTp2: null, probabilityStop: null },
    realData: { price: 3866.95221, atr: 6.965625714285774, rangePosPct: null, htfTrend: 'downtrend' as const, swings, late: { long: true, short: false }, volRegime: 'high' as const },
  };

  it('mesma resposta, 3 decisoes: o Equilibrado repete producao e o Arriscado aceita o alvo a 0,98R', async () => {
    const { decision, profiles } = await decideSignalForProfile(gold as never, 'balanced');
    expect(decision.state).toBe('WATCH');
    expect(decision.watchLevels).toBeNull();
    expect(profiles.conservative.state).toBe('WATCH');
    expect(profiles.aggressive.state).toBe('WATCH');
    expect(profiles.aggressive.watchLevels?.takeProfit1).toBe(3854.16);
    expect(profiles.aggressive.watchLevels?.tp1R).toBeCloseTo(0.98, 2);
    const aggressive = await decideSignalForProfile(gold as never, 'aggressive');
    expect(aggressive.decision.watchLevels?.entry).toBe(3864.44);
  });

  it('sem velas reais o perfil nao muda nada', async () => {
    const print = { ...gold, realData: null, estimatedLevels: { entry: 3866, stopLoss: 3875, takeProfit1: 3855, takeProfit2: null } };
    const { profiles } = await decideSignalForProfile(print as never, 'aggressive');
    expect(profiles.aggressive).toEqual(profiles.balanced);
    expect(profiles.conservative).toEqual(profiles.balanced);
  });

  it('o C6 e o do modelo em todos os perfis: C6 em FAIL segue barrando o ENTER_NOW', async () => {
    const { profiles } = await decideSignalForProfile(gold as never, 'aggressive');
    expect(profiles.aggressive.state).toBe('WATCH');
    expect(profiles.balanced.state).toBe('WATCH');
    expect(profiles.conservative.state).toBe('WATCH');
  });

  it('o Arriscado nunca destrava plano invalidado', async () => {
    const invalidated = { ...gold, realData: { ...gold.realData, price: 3872 } };
    const { profiles } = await decideSignalForProfile(invalidated as never, 'aggressive');
    expect(profiles.aggressive.state).toBe('NO_TRADE');
    expect(profiles.aggressive.reasons).toContain('plan_invalidated');
  });
});

describe('motor pelas velas: regras de 23/11/2026 (filter-2026-11-23)', () => {
  // Alta limpa: fundos e topos subindo, tempo de direcao em alta e preco acima das duas EMA50.
  const trendUp = real(108, {
    atr: 2, htfTrend: 'uptrend', vsEma50: 'above', htfVsEma50: 'above', rangePosPct: 60,
    swings: [{ kind: 'low', price: 96 }, { kind: 'high', price: 104 }, { kind: 'low', price: 100 }, { kind: 'high', price: 112 }, { kind: 'low', price: 104.5 }],
  });
  const read = (direction: 'long' | 'short' | 'neutral') => ({ direction, veto: null });
  const longPlan: WatchPlan = { ...plan, zoneLow: 105, zoneHigh: 106, invalidation: 104, target1: 112, target2: null };

  it('sem maioria e sem vies forte: aguardar com "leituras divergentes", sem plano', async () => {
    const d = await decideBalanced({ state: 'ENTER_NOW', currentPrice: 108, watchPlan: longPlan, realData: trendUp, read: null, noMajority: true });
    expect(d.state).toBe('NO_TRADE');
    expect(d.codeSummary).toMatchObject({ action: 'wait', waitReason: 'no_majority' });
    expect(d.validatorNotes.map((n) => n.reason)).toContain('no_majority');
  });

  it('o codigo nunca promove: WATCH do modelo nao vira ENTER_NOW, mesmo com a entrada a mercado valida', async () => {
    const withNow = await decideBalanced({ state: 'ENTER_NOW', recommendation: 'BUY', currentPrice: 108, watchPlan: null, realData: trendUp, read: read('long') });
    const asked = await decideBalanced({ state: 'WATCH', recommendation: 'WAIT', currentPrice: 108, watchPlan: null, realData: trendUp, read: read('long') });
    expect(asked.state).not.toBe('ENTER_NOW');
    expect(withNow.state).toBe('ENTER_NOW');
    expect(asked.codeSummary?.action).not.toBe('buy_now');
    const blocked = await decideBalanced({ state: 'ENTER_NOW', recommendation: 'BUY', currentPrice: 108, watchPlan: null, realData: trendUp, read: read('long'), allowNow: false });
    expect(blocked.state).not.toBe('ENTER_NOW');
  });

  it('filtro de tendencia: tempo de direcao em alta e preco acima da EMA50: venda so no rompimento, nunca no recuo', async () => {
    const d = await decideBalanced({ state: 'WATCH', recommendation: 'WAIT', currentPrice: 108, watchPlan: null, realData: trendUp, read: read('short') });
    expect(['sell_pullback', 'sell_now']).not.toContain(d.codeSummary?.action);
    expect(['sell_breakout', 'wait']).toContain(d.codeSummary?.action);
  });

  it('plano anterior que nao prende (desempate fraco) nao segura a direcao e aparece sob pressao', async () => {
    const prior = { direction: 'short' as const, invalidation: 120, binding: false };
    const d = await decideBalanced({ state: 'WATCH', recommendation: 'WAIT', currentPrice: 108, watchPlan: longPlan, realData: trendUp, read: read('long'), prior });
    expect(d.codeSummary?.action.startsWith('sell')).toBe(false);
    expect(d.codeSummary?.priorUnderPressure).toBe(true);
    const holds = await decideBalanced({ state: 'WATCH', recommendation: 'WAIT', currentPrice: 108, watchPlan: longPlan, realData: { ...trendUp, htfTrend: 'range' }, read: read('long'), prior: { ...prior, binding: true } });
    expect(holds.codeSummary?.priorUnderPressure).toBeFalsy();
  });

  it('vies forte contra o plano anterior que prendia: deixa de prender', async () => {
    const prior = { direction: 'short' as const, invalidation: 120, binding: true };
    const d = await decideBalanced({ state: 'WATCH', recommendation: 'WAIT', currentPrice: 108, watchPlan: longPlan, realData: trendUp, read: read('long'), prior });
    expect(d.codeSummary?.priorUnderPressure).toBe(true);
    expect(d.codeSummary?.action.startsWith('sell')).toBe(false);
  });
});
