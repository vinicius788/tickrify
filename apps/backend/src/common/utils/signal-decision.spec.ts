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
} from './signal-decision';
import { ENGINE_RULES, type WatchPlan } from './plan-engine';

const saved = process.env.ENABLE_NEWS_GUARD;

// Ouro, compra na zona 99-99,5, invalidacao 98,8 (fundo real), ATR 1. Preco 99,9:
// mercado 99,9 com stop 98,55 (risco 1,35, alvo 101,5 a 1,19R) e limit 99,5 a 0,4 ATR.
const plan: WatchPlan = {
  direction: 'long', triggerType: 'zone_reaction', zoneLow: 99, zoneHigh: 99.5, invalidation: 98.8,
  target1: 101.5, target2: 103, validForCandles: 16, trigger: 'Rejection in the top third of 99-99.5',
};
const swings = [{ kind: 'high' as const, price: 101.5 }, { kind: 'low' as const, price: 98.8 }];
const real = (price: number, patch: Partial<RealDataInput> = {}): RealDataInput =>
  ({ price, atr: 1, htfTrend: null, swings, late: { long: false, short: false }, ...patch });
/** Checklist C1..C7 com os itens de `fails` em FAIL. */
const checks = (...fails: number[]) =>
  [1, 2, 3, 4, 5, 6, 7].map((n) => `C${n} ${fails.includes(n) ? 'FAIL' : 'PASS'}: 99.5`).join('; ');

const base: SignalDecisionInput = {
  state: 'ARMED',
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
/** ENTER_NOW so pela limit: alvo perto demais para entrar a 99,9. */
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
    const d = await decide({ state: 'ENTER_NOW' });
    expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', entryType: 'market', validatorNotes: [], validatorAction: 'none' });
    expect(d.levels.entry).toBeCloseTo(99.9);
    expect(d.levels.stopLoss).toBeCloseTo(98.55);
    expect(d.levels.takeProfit1).toBeCloseTo(101.5);
    expect(d.dataMode).toBe('real_data');
  });

  it('ARMED do modelo segue ARMED: limit na borda a ate 0,75 ATR, TP1 limitado a 1,5R', async () => {
    const d = await decide();
    expect(d).toMatchObject({ state: 'ARMED', entryType: 'limit', validatorNotes: [] });
    expect(d.levels.entry).toBeCloseTo(99.5);
    expect(d.levels.stopLoss).toBeCloseTo(98.55);
    expect(d.levels.takeProfit1).toBeCloseTo(100.925);
    expect(d.levels.takeProfit2).toBe(103);
    expect(d.watchPlan).toEqual(plan);
  });

  it('SELL espelhado: ENTER_NOW a mercado', async () => {
    const short: WatchPlan = { ...plan, direction: 'short', zoneLow: 100.5, zoneHigh: 101, invalidation: 101.2, target1: 98.5, target2: 97 };
    const d = await decide({
      state: 'ENTER_NOW', recommendation: 'SELL', watchPlan: short,
      realData: real(100.1, { swings: [{ kind: 'high', price: 101.2 }] }),
    });
    expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'SELL', entryType: 'market' });
    expect(d.levels.stopLoss).toBeCloseTo(101.45);
  });

  it('a invalidacao vira a swing real entre o preco e a do modelo (ate 0,5 ATR) e o stop sai dela', async () => {
    const d = await decide({ state: 'ENTER_NOW', realData: real(99.9, { swings: [{ kind: 'low', price: 98.72 }, { kind: 'low', price: 99.05 }] }) });
    expect(d.watchPlan?.invalidation).toBe(99.05);
    expect(d.levels.stopLoss).toBeCloseTo(98.8);
  });

  it('NO_TRADE do modelo fica NO_TRADE, sem niveis', async () => {
    const d = await decide({ state: 'NO_TRADE', recommendation: 'WAIT', confidence: 30 });
    expect(d).toMatchObject({ state: 'NO_TRADE', recommendation: 'WAIT', entryType: null, watchPlan: null, validatorNotes: [] });
  });
});

describe('decideSignal: a escada de estados', () => {
  it('ENTER_NOW sem entrada a mercado valida vira ARMED na limit, com a mudanca anotada', async () => {
    const d = await decide({ state: 'ENTER_NOW', watchPlan: nearTarget });
    expect(d).toMatchObject({ state: 'ARMED', entryType: 'limit', validatorAction: 'downgraded' });
    expect(d.validatorNotes).toEqual([{ from: 'ENTER_NOW', to: 'ARMED', reason: 'market_entry_invalid' }]);
    expect(d.levels.entry).toBeCloseTo(99.5);
  });

  it(`limit a mais de ${ENGINE_RULES.armedMaxAtr} ATR: WATCH, cada degrau anotado`, async () => {
    const d = await decide({ state: 'ENTER_NOW', watchPlan: { ...nearTarget, target1: 101.3 }, realData: real(100.4) });
    expect(d.state).toBe('WATCH');
    expect(d.validatorNotes).toEqual([
      { from: 'ENTER_NOW', to: 'ARMED', reason: 'market_entry_invalid' },
      { from: 'ARMED', to: 'WATCH', reason: 'entry_far_from_price' },
    ]);
    expect(d.levels.entry).toBeNull();
  });

  it('movimento atrasado: nunca a mercado; com a entrada a mercado valida tambem nao vira ARMED', async () => {
    const d = await decide({ state: 'ENTER_NOW', realData: real(99.9, { late: { long: true, short: false } }) });
    expect(d.state).toBe('WATCH');
    expect(validatorReasons(d.validatorNotes)).toEqual(['late_move']);
  });

  it.each([2, 6, 7])('C%i em FAIL: sem ENTER_NOW; C2 e C7 tambem tiram o ARMED', async (n) => {
    const d = await decide({ state: 'ENTER_NOW', structureValidation: checks(n) });
    expect(d).toMatchObject({ state: 'WATCH' });
    expect(validatorReasons(d.validatorNotes)).toEqual(['required_check_failed']);
  });

  it('C6 em FAIL nao impede o ARMED pela limit (o ARMED exige C2, C3 e C7)', async () => {
    expect((await decide({ state: 'ENTER_NOW', watchPlan: nearTarget, structureValidation: checks(6) })).state).toBe('ARMED');
  });

  it('C3 em FAIL: NO_TRADE (sem setup, nem o WATCH fica)', async () => {
    const d = await decide({ structureValidation: checks(3) });
    expect(d).toMatchObject({ state: 'NO_TRADE', watchPlan: null });
    expect(d.validatorNotes.at(-1)).toEqual({ from: 'WATCH', to: 'NO_TRADE', reason: 'setup_failed' });
  });

  it(`PASS: ${ENGINE_RULES.minPass} bastam para entrar; 4 so para o WATCH; 3 nem isso`, async () => {
    expect((await decide({ state: 'ENTER_NOW', structureValidation: checks(1, 5) })).state).toBe('ENTER_NOW');
    expect((await decide({ state: 'ENTER_NOW', structureValidation: checks(1, 4, 5) })).state).toBe('WATCH');
    expect((await decide({ state: 'ENTER_NOW', structureValidation: checks(1, 4, 5, 6) })).state).toBe('NO_TRADE');
  });

  it('nenhuma entrada valida: NO_TRADE (no_valid_geometry)', async () => {
    const d = await decide({ realData: real(99.9, { atr: 0.3, swings: [{ kind: 'low', price: 98.8 }] }) });
    expect(d.state).toBe('NO_TRADE');
    expect(d.validatorNotes.at(-1)?.reason).toBe('no_valid_geometry');
  });

  it('sem swing real entre o preco e a invalidacao, a ate 0,5 ATR: NO_TRADE', async () => {
    const d = await decide({ realData: real(99.9, { swings: [{ kind: 'low', price: 98.5 }] }) });
    expect(d).toMatchObject({ state: 'NO_TRADE', validatorNotes: [{ from: 'ARMED', to: 'NO_TRADE', reason: 'invalidation_unsnapped' }] });
  });

  it('preco alem da invalidacao: NO_TRADE', async () => {
    expect(await decide({ realData: real(98.7) })).toMatchObject({ state: 'NO_TRADE', validatorNotes: [{ from: 'ARMED', to: 'NO_TRADE', reason: 'plan_invalidated' }] });
  });
});

describe('decideSignal: so rebaixa, com uma excecao', () => {
  it('WATCH do modelo com todas as condicoes do ENTER_NOW: o codigo promove', async () => {
    const d = await decide(watch);
    expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', entryType: 'market', validatorAction: 'promoted' });
    expect(d.validatorNotes).toEqual([{ from: 'WATCH', to: 'ENTER_NOW', reason: 'market_entry_valid' }]);
  });

  it('WATCH do modelo que so teria a limit perto segue WATCH (nunca vira ARMED)', async () => {
    expect(await decide({ ...watch, watchPlan: nearTarget })).toMatchObject({ state: 'WATCH', validatorNotes: [] });
  });

  it('ARMED do modelo com a entrada a mercado valida nao sobe para ENTER_NOW', async () => {
    expect((await decide()).state).toBe('ARMED');
  });

  it('estado de sinal com HOLD: vira WATCH com o plano, sem promover', async () => {
    const d = await decide({ state: 'ENTER_NOW', recommendation: 'WAIT' });
    expect(d).toMatchObject({ state: 'WATCH', recommendation: 'WAIT', validatorNotes: [{ from: 'ENTER_NOW', to: 'WATCH', reason: 'state_mismatch' }] });
    expect(d.watchPlan).toEqual(plan);
  });

  it('sinal do lado oposto ao plano, plano incoerente ou preco implausivel: NO_TRADE', async () => {
    expect((await decide({ recommendation: 'SELL' })).validatorNotes).toEqual([{ from: 'ARMED', to: 'NO_TRADE', reason: 'state_mismatch' }]);
    expect((await decide({ ...watch, watchPlan: { ...plan, invalidation: 99.2 } })).validatorNotes).toEqual([{ from: 'WATCH', to: 'NO_TRADE', reason: 'watch_plan_invalid' }]);
    expect(await decide({ planFailures: ['implausible_price'] })).toMatchObject({ state: 'NO_TRADE', validatorAction: 'downgraded' });
  });

  it('correcao da ordem de grandeza sem mudanca de estado conta como fixed', async () => {
    expect(await decide({ priceFixed: true })).toMatchObject({ state: 'ARMED', validatorAction: 'fixed' });
  });

  it('print desatualizado: marca stalePrint sem mudar o estado', async () => {
    expect(await decide({ currentPrice: 98 })).toMatchObject({ state: 'ARMED', stalePrint: true, validatorNotes: [] });
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
    expect((await decide({ state: 'ENTER_NOW', symbol: 'EURUSD', structureValidation: checks(1, 5) })).state).toBe('WATCH');
    expect((await decide({ state: 'ENTER_NOW', structureValidation: checks(1, 5), realData: real(99.9, { htfTrend: 'downtrend' }) })).state).toBe('WATCH');
    expect((await decide({ state: 'ENTER_NOW', structureValidation: checks(1, 5), realData: real(99.9, { htfTrend: 'uptrend' }) })).state).toBe('ENTER_NOW');
  });
});

describe('decideSignal: sem velas reais (niveis do modelo, distancia em R)', () => {
  // Limit em 99,5, stop 98,5 (R = 1): o preco lido 99,9 fica a 0,4R da borda.
  const estimatedLevels = { entry: 99.5, stopLoss: 98.5, takeProfit1: 101, takeProfit2: 103 };

  it('sem niveis legiveis do modelo: WATCH com o plano', async () => {
    const d = await decide({ realData: null });
    expect(d).toMatchObject({ state: 'WATCH', dataMode: 'print', validatorNotes: [{ from: 'ARMED', to: 'WATCH', reason: 'levels_unverified' }] });
    expect(d.watchPlan).toEqual(plan);
  });

  it(`ARMED ate ${ENGINE_RULES.armedMaxStopR}R da borda, com os niveis do modelo; nao promove`, async () => {
    const d = await decide({ realData: null, estimatedLevels });
    expect(d).toMatchObject({ state: 'ARMED', entryType: 'limit', dataMode: 'print', validatorNotes: [] });
    expect(d.levels).toEqual(estimatedLevels);
    expect((await decide({ ...watch, realData: null, estimatedLevels })).state).toBe('WATCH');
  });

  it('longe da borda (em R): WATCH; dentro da zona o ENTER_NOW fica; fora vira ARMED', async () => {
    expect((await decide({ realData: null, estimatedLevels, currentPrice: 100.2 })).validatorNotes).toEqual([{ from: 'ARMED', to: 'WATCH', reason: 'entry_far_from_price' }]);
    expect(await decide({ state: 'ENTER_NOW', realData: null, estimatedLevels, currentPrice: 99.3 })).toMatchObject({ state: 'ENTER_NOW', entryType: 'market' });
    expect((await decide({ state: 'ENTER_NOW', realData: null, estimatedLevels })).validatorNotes).toEqual([{ from: 'ENTER_NOW', to: 'ARMED', reason: 'not_at_price' }]);
  });

  it('preco lido alem da invalidacao: NO_TRADE; zona atravessada: WATCH', async () => {
    expect((await decide({ realData: null, estimatedLevels, currentPrice: 98.7 })).state).toBe('NO_TRADE');
    expect((await decide({ realData: null, estimatedLevels, currentPrice: 98.9 })).validatorNotes).toEqual([{ from: 'ARMED', to: 'WATCH', reason: 'zone_overrun' }]);
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
    expect(d).toMatchObject({ state: 'ARMED', validatorFlags: ['stop_inside_invalidation'], validatorNotes: [] });
  });
});

describe('decideSignal: news guard', () => {
  beforeEach(() => { process.env.ENABLE_NEWS_GUARD = 'true'; });
  const event = (minutesUntil: number, impact = 'High') => ({ impact, minutesUntil, country: 'USD', title: 'CPI m/m' });

  it('evento High na janela: o sinal vira WATCH com o plano condicional', async () => {
    getEventsForSymbol.mockResolvedValue({ events: [event(30)], degraded: false });
    const d = await decide();
    expect(d).toMatchObject({ state: 'WATCH', validatorNotes: [{ from: 'ARMED', to: 'WATCH', reason: 'news_event' }], newsGuardStatus: 'event', newsEvent: 'USD CPI m/m (30min)' });
    expect(d.watchPlan).toEqual(plan);
  });

  it.each([
    ['fora da janela', [event(90)], false, 'no_event'],
    ['impacto medio', [event(10, 'Medium')], false, 'no_event'],
    ['fonte degradada sem evento', [], true, 'degraded_no_event'],
  ])('%s: nao rebaixa', async (_n, events, degraded, status) => {
    getEventsForSymbol.mockResolvedValue({ events, degraded });
    expect(await decide()).toMatchObject({ state: 'ARMED', newsGuardStatus: status });
  });

  it('fonte degradada com o evento no cache: rebaixa', async () => {
    getEventsForSymbol.mockResolvedValue({ events: [event(5)], degraded: true });
    expect(await decide()).toMatchObject({ state: 'WATCH', newsGuardStatus: 'degraded_event' });
  });

  it('erro do calendario: segue sem rebaixar, status error', async () => {
    getEventsForSymbol.mockRejectedValue(new Error('calendar timed out'));
    expect(await decide()).toMatchObject({ state: 'ARMED', newsGuardStatus: 'error' });
  });

  it('calendario sem resposta: espera 6 s e segue (timeout)', async () => {
    jest.useFakeTimers();
    try {
      getEventsForSymbol.mockReturnValue(new Promise(() => undefined));
      const pending = decide();
      await jest.advanceTimersByTimeAsync(6_000);
      expect(await pending).toMatchObject({ state: 'ARMED', newsGuardStatus: 'timeout' });
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
    const armed: Record<string, any> = applyDecisionToAnalysis(analysis, await decide(), 'Outdated screenshot.');
    expect(armed.entry).toBeCloseTo(99.5);
    expect(armed.riskRewardTp1).toBeCloseTo(1.5, 1);
    expect(armed.riskRewardTp2).toBeCloseTo(3.68, 1);
    expect(armed).toMatchObject({ entryType: 'limit', riskFactors: 'Thin liquidity\nOutdated screenshot.' });
    const none = applyDecisionToAnalysis(analysis, await decide({ state: 'NO_TRADE', recommendation: 'WAIT' }));
    expect(none.alternativeScenario).toBeNull();
  });
});
