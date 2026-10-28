/**
 * Validador de estado do v10.3 (27/10/2026): so rebaixa, nunca promove.
 * Entrada (limit na borda da zona, ou a mercado no ENTER_NOW), stop (pela
 * invalidacao) e TP1 saem do plan-engine.ts; o estado sai da distancia D da
 * borda ao preco real; C2, C3, C6 e C7 sao obrigatorios. O news guard mantem
 * os status de 19/10 (falha aberta, agora visivel).
 */

const getEventsForSymbol = jest.fn();

jest.mock('../../modules/calendar/calendar.service', () => ({
  EconomicCalendarService: jest.fn().mockImplementation(() => ({ getEventsForSymbol })),
}));

import {
  applyDecisionToAnalysis,
  checklistGate,
  decideSignal,
  deriveSignalState,
  STATE_RULES,
  storedSignalState,
  type SignalDecisionInput,
} from './signal-decision';
import type { WatchPlan } from './plan-engine';

const FLAGS = ['ENABLE_NEWS_GUARD', 'ENABLE_RR_GUARD'] as const;
const saved = FLAGS.map((k) => process.env[k]);

// Ouro, compra na zona 99-99,5 com ATR 1: limit em 99,5, stop 98,55
// (invalidacao 98,8 - 0,25), TP1 100,925 (target1 101,5 limitado a 1,5R), TP2 103.
const plan: WatchPlan = {
  direction: 'long', triggerType: 'zone_reaction', zoneLow: 99, zoneHigh: 99.5, invalidation: 98.8,
  target1: 101.5, target2: 103, validForCandles: 16, trigger: 'Rejection in the top third of 99-99.5',
};
const real = (price: number, atr = 1, htfTrend: 'uptrend' | 'downtrend' | 'range' | null = null) => ({ price, atr, htfTrend });
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

beforeEach(() => {
  getEventsForSymbol.mockReset();
  process.env.ENABLE_NEWS_GUARD = 'false';
  process.env.ENABLE_RR_GUARD = 'true';
});

afterAll(() => {
  FLAGS.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
});

describe('decideSignal: estados que passam', () => {
  it('ARMED a ate 0,75 ATR da borda: ordem limit na borda, niveis do motor', async () => {
    const d = await decide();
    expect(d).toMatchObject({ state: 'ARMED', recommendation: 'BUY', entryType: 'limit', validatorNotes: [], validatorAction: 'none' });
    expect(d.levels.entry).toBeCloseTo(99.5);
    expect(d.levels.stopLoss).toBeCloseTo(98.55);
    expect(d.levels.takeProfit1).toBeCloseTo(100.925);
    expect(d.levels.takeProfit2).toBe(103);
    // O plano fica junto do sinal: a tela mostra zona e cancelamento.
    expect(d.watchPlan).toEqual(plan);
    expect(d.dataMode).toBe('real_data');
  });

  it('ENTER_NOW com o preco dentro da zona: a mercado, stop e TP1 refeitos do preco', async () => {
    const d = await decide({ state: 'ENTER_NOW', realData: real(99.3) });
    expect(d).toMatchObject({ state: 'ENTER_NOW', recommendation: 'BUY', entryType: 'market', validatorNotes: [] });
    expect(d.levels.entry).toBeCloseTo(99.3);
    expect(d.levels.stopLoss).toBeCloseTo(98.55);
    expect(d.levels.takeProfit1).toBeCloseTo(100.425);
  });

  it('SELL espelhado passa', async () => {
    const short: WatchPlan = { ...plan, direction: 'short', zoneLow: 100.5, zoneHigh: 101, invalidation: 101.2, target1: 98.5, target2: 97 };
    const d = await decide({ recommendation: 'SELL', watchPlan: short, realData: real(100.1) });
    expect(d).toMatchObject({ state: 'ARMED', recommendation: 'SELL', entryType: 'limit' });
    expect(d.levels.entry).toBeCloseTo(100.5);
    expect(d.levels.stopLoss).toBeCloseTo(101.45);
    expect(d.levels.takeProfit1).toBeCloseTo(99.075);
  });

  it('correcao da ordem de grandeza sem rebaixamento conta como fixed', async () => {
    expect(await decide({ priceFixed: true })).toMatchObject({ state: 'ARMED', validatorAction: 'fixed' });
    expect(await decide({ priceFixed: true, planFailures: ['implausible_price'] })).toMatchObject({ validatorAction: 'downgraded' });
  });

  it('NO_TRADE do modelo fica NO_TRADE, sem niveis', async () => {
    const d = await decide({ state: 'NO_TRADE', recommendation: 'WAIT', confidence: 30 });
    expect(d).toMatchObject({ state: 'NO_TRADE', recommendation: 'WAIT', entryType: null, watchPlan: null });
    expect(d.levels).toEqual({ entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null });
  });
});

describe('decideSignal: distancia D e preco real', () => {
  it('sem velas reais e sem niveis legiveis do modelo: WATCH com o plano', async () => {
    const d = await decide({ realData: null });
    expect(d).toMatchObject({ state: 'WATCH', recommendation: 'WAIT', validatorNotes: ['levels_unverified'], dataMode: 'print' });
    expect(d.watchPlan).toEqual(plan);
    expect(d.levels.entry).toBeNull();
    expect(d.probabilities).toEqual({ probabilityTp1: null, probabilityTp2: null, probabilityStop: null });
  });

  describe('sem velas reais: niveis do modelo e distancia em R (fallback do v10)', () => {
    // Limit em 99,5, stop 98,5 (R = 1): o preco lido 99,9 fica a 0,4R da borda.
    const estimatedLevels = { entry: 99.5, stopLoss: 98.5, takeProfit1: 101, takeProfit2: 103 };

    it(`ARMED ate ${STATE_RULES.armedMaxStopR}R da borda, com os niveis do modelo e dataMode print`, async () => {
      const d = await decide({ realData: null, estimatedLevels });
      expect(d).toMatchObject({ state: 'ARMED', entryType: 'limit', dataMode: 'print', validatorNotes: [] });
      expect(d.levels).toEqual(estimatedLevels);
    });

    it('longe da borda (em R): WATCH; dentro da zona o ENTER_NOW fica; fora vira ARMED', async () => {
      expect(await decide({ realData: null, estimatedLevels, currentPrice: 100.2 })).toMatchObject({ state: 'WATCH', validatorNotes: ['entry_far_from_price'] });
      expect(await decide({ state: 'ENTER_NOW', realData: null, estimatedLevels, currentPrice: 99.3 })).toMatchObject({ state: 'ENTER_NOW', entryType: 'market' });
      expect(await decide({ state: 'ENTER_NOW', realData: null, estimatedLevels })).toMatchObject({ state: 'ARMED', validatorNotes: ['not_at_price'] });
    });

    it('preco lido alem da invalidacao: NO_TRADE; zona atravessada: WATCH', async () => {
      expect(await decide({ realData: null, estimatedLevels, currentPrice: 98.7 })).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['plan_invalidated'] });
      expect(await decide({ realData: null, estimatedLevels, currentPrice: 98.9 })).toMatchObject({ state: 'WATCH', validatorNotes: ['zone_overrun'] });
    });

    it('o guard de R:R vale tambem nos niveis do modelo', async () => {
      const short = { ...estimatedLevels, takeProfit1: 100.5, takeProfit2: null };
      expect(await decide({ realData: null, estimatedLevels: short })).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['rr_tp2_below_min'] });
    });
  });

  it(`D acima de ${STATE_RULES.armedMaxAtr} ATR: WATCH`, async () => {
    expect(await decide({ realData: real(100.4) })).toMatchObject({ state: 'WATCH', validatorNotes: ['entry_far_from_price'] });
    expect(await decide({ state: 'ENTER_NOW', realData: real(100.4) })).toMatchObject({ state: 'WATCH', validatorNotes: ['entry_far_from_price'] });
  });

  it('ENTER_NOW com o preco fora da zona vira ARMED (not_at_price), ordem limit', async () => {
    const d = await decide({ state: 'ENTER_NOW' });
    expect(d).toMatchObject({ state: 'ARMED', entryType: 'limit', validatorNotes: ['not_at_price'] });
    expect(d.levels.entry).toBeCloseTo(99.5);
  });

  it('nunca promove: ARMED com o preco dentro da zona segue ARMED na borda', async () => {
    const d = await decide({ realData: real(99.3) });
    expect(d).toMatchObject({ state: 'ARMED', entryType: 'limit', validatorNotes: [] });
    expect(d.levels.entry).toBeCloseTo(99.5);
  });

  it('preco que ja atravessou a zona (sem passar da invalidacao): WATCH', async () => {
    expect(await decide({ realData: real(98.9) })).toMatchObject({ state: 'WATCH', validatorNotes: ['zone_overrun'] });
  });

  it('preco alem da invalidacao: NO_TRADE', async () => {
    expect(await decide({ realData: real(98.7) })).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['plan_invalidated'] });
  });

  it('stop a mais de 2,0 ATR: NO_TRADE', async () => {
    expect(await decide({ realData: real(99.6, 0.3) })).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['stop_atr_out_of_range'] });
  });

  it('alvo a menos de 1R da entrada: NO_TRADE', async () => {
    const d = await decide({ watchPlan: { ...plan, target1: 100.4 } });
    expect(d).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['tp1_no_room'] });
  });

  it('v10.2: ARMED sem plano, ou com plano do lado oposto: NO_TRADE', async () => {
    expect(await decide({ watchPlan: null })).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['watch_plan_invalid'] });
    expect(await decide({ recommendation: 'SELL' })).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['watch_plan_invalid'] });
  });
});

describe('checklistGate e o gate no validador', () => {
  it.each([2, 3, 6, 7])('C%i em FAIL: sem plano, mesmo com 6 PASS', async (n) => {
    expect(checklistGate(checks(n), 'XAUUSD', 'long', null)).toBe('required_check_failed');
    expect(await decide({ structureValidation: checks(n) })).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['required_check_failed'] });
  });

  it('checklist ilegivel nao passa', () => {
    expect(checklistGate('7/7 all good', 'XAUUSD', 'long', null)).toBe('required_check_failed');
  });

  it('5 PASS bastam; 4 nao', async () => {
    expect((await decide({ structureValidation: checks(1, 5) })).state).toBe('ARMED');
    expect(await decide({ structureValidation: checks(1, 4, 5) })).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['checks_below_min'] });
  });

  it('forex precisa de 6 PASS; ouro com 5 segue', async () => {
    expect(await decide({ symbol: 'EURUSD', structureValidation: checks(1, 5) })).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['forex_checks_below_min'] });
    expect((await decide({ symbol: 'EURUSD' })).state).toBe('ARMED');
  });

  it('contra a tendencia do 4h calculada pelo codigo precisa de 6 PASS', async () => {
    const against = real(99.9, 1, 'downtrend');
    expect(await decide({ structureValidation: checks(1, 5), realData: against })).toMatchObject({
      state: 'NO_TRADE', validatorNotes: ['countertrend_checks_below_min'],
    });
    expect((await decide({ realData: against })).state).toBe('ARMED');
    expect((await decide({ structureValidation: checks(1, 5), realData: real(99.9, 1, 'uptrend') })).state).toBe('ARMED');
    expect((await decide({ structureValidation: checks(1, 5), realData: real(99.9, 1, 'range') })).state).toBe('ARMED');
  });

  it('o WATCH passa pelo mesmo gate', async () => {
    const watch = { state: 'WATCH' as const, recommendation: 'WAIT' as const };
    expect((await decide(watch)).state).toBe('WATCH');
    expect(await decide({ ...watch, structureValidation: checks(7) })).toMatchObject({ state: 'NO_TRADE', watchPlan: null, validatorNotes: ['required_check_failed'] });
  });
});

describe('decideSignal: so rebaixa', () => {
  it(`alvo final abaixo de ${STATE_RULES.minRiskRewardTp2}R vira NO_TRADE; com a chave desligada passa`, async () => {
    const watchPlan = { ...plan, target1: 100.7, target2: null };
    expect(await decide({ watchPlan })).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['rr_tp2_below_min'] });
    process.env.ENABLE_RR_GUARD = 'false';
    expect(await decide({ watchPlan })).toMatchObject({ state: 'ARMED', validatorNotes: [] });
  });

  it('preco implausivel vira NO_TRADE', async () => {
    const d = await decide({ planFailures: ['implausible_price'] });
    expect(d).toMatchObject({ state: 'NO_TRADE', validatorNotes: ['implausible_price'] });
  });

  it('print desatualizado: marca stale_print sem rebaixar', async () => {
    const d = await decide({ currentPrice: 98 });
    expect(d).toMatchObject({ state: 'ARMED', stalePrint: true, validatorNotes: ['stale_print'], validatorAction: 'none' });
  });

  it('estado de sinal com HOLD e incoerente: vira WATCH com o plano do modelo', async () => {
    const d = await decide({ recommendation: 'WAIT' });
    expect(d).toMatchObject({ state: 'WATCH', recommendation: 'WAIT', validatorNotes: ['state_mismatch'] });
    expect(d.watchPlan).toEqual(plan);
  });

  it('nunca promove: WATCH perto da zona continua WATCH', async () => {
    const d = await decide({ state: 'WATCH', recommendation: 'WAIT' });
    expect(d).toMatchObject({ state: 'WATCH', recommendation: 'WAIT', validatorNotes: [] });
    expect(d.watchPlan).toEqual(plan);
  });

  it('WATCH sem plano coerente vira NO_TRADE', async () => {
    const d = await decide({ state: 'WATCH', recommendation: 'WAIT', watchPlan: { ...plan, invalidation: 99.2 } });
    expect(d).toMatchObject({ state: 'NO_TRADE', watchPlan: null, validatorNotes: ['watch_plan_invalid'] });
  });
});

describe('decideSignal: confianca e probabilidades', () => {
  it(`sinal: teto ${STATE_RULES.confidenceCap}, tendencia moderada ${STATE_RULES.confidenceCapModerateTrend}, fraca ${STATE_RULES.confidenceCapWeakTrend}`, async () => {
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
    const d = await decide({ state: 'WATCH', recommendation: 'WAIT', confidence: 70 });
    expect(d.confidence).toBe(STATE_RULES.confidenceCapNoSignal);
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
    expect(d).toMatchObject({ state: 'WATCH', validatorNotes: ['news_event'], newsGuardStatus: 'event', newsEvent: 'USD CPI m/m (30min)' });
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

describe('deriveSignalState: analises de antes do v10', () => {
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
