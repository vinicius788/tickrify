/**
 * News guard dentro do decideSignal (VNext, Etapa 2, 19/10/2026).
 *
 * Dois blocos de proposito:
 *   - "decisao": recomendacao, confianca e campos do guard em cada caso. Rodou
 *     igual ANTES e DEPOIS de o motivo entrar em validatorReasons (a mudanca
 *     so registra, nao decide).
 *   - "motivo": validatorReasons e validatorAction. Antes, o rebaixamento por
 *     evento economico nao deixava motivo nenhum (action 'none' ou 'fixed').
 */

const getEventsForSymbol = jest.fn();

jest.mock('../../modules/calendar/calendar.service', () => ({
  EconomicCalendarService: jest.fn().mockImplementation(() => ({ getEventsForSymbol })),
}));

import { decideSignal, type SignalDecisionInput } from './signal-decision';
import type { TradePlanRule } from './trade-plan-validator';

type CalendarEvent = { impact: string; minutesUntil: number; country: string; title: string };

const event = (minutesUntil: number, impact = 'High'): CalendarEvent => ({
  impact,
  minutesUntil,
  country: 'USD',
  title: 'CPI m/m',
});

const base: SignalDecisionInput = {
  recommendation: 'BUY',
  flooredConfidence: 70,
  trendStrength: 'strong',
  factorsPresent: 6,
  riskRewardTp1: 2,
  riskRewardTp2: 4,
  symbol: 'EURUSD',
  planFailures: [],
};

interface Case {
  name: string;
  input?: Partial<SignalDecisionInput>;
  /** Eventos devolvidos pelo calendario; 'throws' simula a fonte fora do ar. */
  calendar?: CalendarEvent[] | 'throws';
  newsGuard?: 'true' | 'false';
  decision: {
    recommendation: 'BUY' | 'SELL' | 'WAIT';
    confidence: number;
    rrDowngraded: boolean;
    newsDowngraded: boolean;
    newsEvent: string | null;
    validatorFlags: TradePlanRule[];
    calendarCalled: boolean;
  };
  reasons: string[];
  action: 'none' | 'fixed' | 'downgraded';
}

const cases: Case[] = [
  {
    name: 'BUY com evento High em 30 min vira WAIT',
    calendar: [event(30)],
    decision: { recommendation: 'WAIT', confidence: 45, rrDowngraded: false, newsDowngraded: true, newsEvent: 'USD CPI m/m (30min)', validatorFlags: [], calendarCalled: true },
    reasons: ['news_event'],
    action: 'downgraded',
  },
  {
    name: 'SELL com evento que saiu ha 15 min (limite) vira WAIT',
    input: { recommendation: 'SELL' },
    calendar: [event(-15)],
    decision: { recommendation: 'WAIT', confidence: 45, rrDowngraded: false, newsDowngraded: true, newsEvent: 'USD CPI m/m (-15min)', validatorFlags: [], calendarCalled: true },
    reasons: ['news_event'],
    action: 'downgraded',
  },
  {
    name: 'evento em 45 min (limite) vira WAIT',
    calendar: [event(45)],
    decision: { recommendation: 'WAIT', confidence: 45, rrDowngraded: false, newsDowngraded: true, newsEvent: 'USD CPI m/m (45min)', validatorFlags: [], calendarCalled: true },
    reasons: ['news_event'],
    action: 'downgraded',
  },
  {
    name: 'correcao de magnitude + evento: o rebaixamento aparece no lugar do fixed',
    input: { priceFixed: true },
    calendar: [event(10)],
    decision: { recommendation: 'WAIT', confidence: 45, rrDowngraded: false, newsDowngraded: true, newsEvent: 'USD CPI m/m (10min)', validatorFlags: [], calendarCalled: true },
    reasons: ['news_event'],
    action: 'downgraded',
  },
  {
    name: 'tendencia fraca: teto de 60 e depois o do news guard (45)',
    input: { trendStrength: 'weak', flooredConfidence: 80 },
    calendar: [event(5)],
    decision: { recommendation: 'WAIT', confidence: 45, rrDowngraded: false, newsDowngraded: true, newsEvent: 'USD CPI m/m (5min)', validatorFlags: [], calendarCalled: true },
    reasons: ['news_event'],
    action: 'downgraded',
  },
  {
    name: 'confianca abaixo de 45 nao sobe',
    input: { flooredConfidence: 38 },
    calendar: [event(20)],
    decision: { recommendation: 'WAIT', confidence: 38, rrDowngraded: false, newsDowngraded: true, newsEvent: 'USD CPI m/m (20min)', validatorFlags: [], calendarCalled: true },
    reasons: ['news_event'],
    action: 'downgraded',
  },
  {
    name: 'flag que so mede segue registrada junto do motivo do news guard',
    input: { planFailures: ['stop_inside_invalidation'] },
    calendar: [event(30)],
    decision: { recommendation: 'WAIT', confidence: 45, rrDowngraded: false, newsDowngraded: true, newsEvent: 'USD CPI m/m (30min)', validatorFlags: ['stop_inside_invalidation'], calendarCalled: true },
    reasons: ['news_event'],
    action: 'downgraded',
  },
  {
    name: 'evento em 46 min fica fora da janela',
    calendar: [event(46)],
    decision: { recommendation: 'BUY', confidence: 70, rrDowngraded: false, newsDowngraded: false, newsEvent: null, validatorFlags: [], calendarCalled: true },
    reasons: [],
    action: 'none',
  },
  {
    name: 'evento que saiu ha 16 min fica fora da janela',
    calendar: [event(-16)],
    decision: { recommendation: 'BUY', confidence: 70, rrDowngraded: false, newsDowngraded: false, newsEvent: null, validatorFlags: [], calendarCalled: true },
    reasons: [],
    action: 'none',
  },
  {
    name: 'evento Medium nao rebaixa',
    calendar: [event(10, 'Medium')],
    decision: { recommendation: 'BUY', confidence: 70, rrDowngraded: false, newsDowngraded: false, newsEvent: null, validatorFlags: [], calendarCalled: true },
    reasons: [],
    action: 'none',
  },
  {
    name: 'calendario fora do ar nao bloqueia',
    calendar: 'throws',
    decision: { recommendation: 'BUY', confidence: 70, rrDowngraded: false, newsDowngraded: false, newsEvent: null, validatorFlags: [], calendarCalled: true },
    reasons: [],
    action: 'none',
  },
  {
    name: 'ENABLE_NEWS_GUARD=false ignora o evento',
    newsGuard: 'false',
    calendar: [event(10)],
    decision: { recommendation: 'BUY', confidence: 70, rrDowngraded: false, newsDowngraded: false, newsEvent: null, validatorFlags: [], calendarCalled: false },
    reasons: [],
    action: 'none',
  },
  {
    name: 'R/R guard rebaixa antes: o calendario nem e consultado',
    input: { riskRewardTp1: 0.8, riskRewardTp2: 1.1 },
    calendar: [event(10)],
    decision: { recommendation: 'WAIT', confidence: 45, rrDowngraded: true, newsDowngraded: false, newsEvent: null, validatorFlags: [], calendarCalled: false },
    reasons: ['rr_below_min'],
    action: 'downgraded',
  },
  {
    name: 'validador do plano rebaixa antes: o calendario nem e consultado',
    input: { planFailures: ['implausible_price'] },
    calendar: [event(10)],
    decision: { recommendation: 'WAIT', confidence: 45, rrDowngraded: false, newsDowngraded: false, newsEvent: null, validatorFlags: [], calendarCalled: false },
    reasons: ['implausible_price'],
    action: 'downgraded',
  },
  {
    name: 'WAIT do modelo nao consulta o calendario',
    input: { recommendation: 'WAIT', flooredConfidence: 55 },
    calendar: [event(10)],
    decision: { recommendation: 'WAIT', confidence: 55, rrDowngraded: false, newsDowngraded: false, newsEvent: null, validatorFlags: [], calendarCalled: false },
    reasons: [],
    action: 'none',
  },
];

describe('decideSignal: news guard', () => {
  const saved = { news: process.env.ENABLE_NEWS_GUARD, rr: process.env.ENABLE_RR_GUARD };

  beforeEach(() => {
    process.env.ENABLE_RR_GUARD = 'true';
    getEventsForSymbol.mockReset();
  });

  afterAll(() => {
    for (const [key, value] of [['ENABLE_NEWS_GUARD', saved.news], ['ENABLE_RR_GUARD', saved.rr]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function run(c: Case) {
    process.env.ENABLE_NEWS_GUARD = c.newsGuard ?? 'true';
    if (c.calendar === 'throws') getEventsForSymbol.mockRejectedValue(new Error('calendar down'));
    else getEventsForSymbol.mockResolvedValue({ events: c.calendar ?? [], degraded: false });
    return decideSignal({ ...base, ...c.input });
  }

  describe('decisao (igual antes e depois do registro do motivo)', () => {
    it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
      const d = await run(c);
      expect({
        recommendation: d.recommendation,
        confidence: d.confidence,
        rrDowngraded: d.rrDowngraded,
        newsDowngraded: d.newsDowngraded,
        newsEvent: d.newsEvent,
        validatorFlags: d.validatorFlags,
        calendarCalled: getEventsForSymbol.mock.calls.length > 0,
      }).toEqual(c.decision);
    });

    it('consulta o calendario pelo simbolo, agora, janela de 2 horas', async () => {
      await run(cases[0]);
      expect(getEventsForSymbol).toHaveBeenCalledTimes(1);
      const [symbol, now, hours] = getEventsForSymbol.mock.calls[0];
      expect(symbol).toBe('EURUSD');
      expect(now).toBeInstanceOf(Date);
      expect(hours).toBe(2);
    });
  });

  describe('motivo registrado', () => {
    it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
      const d = await run(c);
      expect({ validatorReasons: d.validatorReasons as string[], validatorAction: d.validatorAction }).toEqual({
        validatorReasons: c.reasons,
        validatorAction: c.action,
      });
    });
  });
});

/**
 * D4 fase 1 (19/10/2026): o calendario do news guard sob relogio falso.
 * Caracteriza, sem mudar nada, o limite de 6 s (`raceTimeout`) e o que fica
 * indistinguivel no resultado: timeout, fonte degradada vazia e "sem evento"
 * saem iguais (sem rebaixar, sem motivo). `decideSignal` nao loga nada.
 */
describe('decideSignal: news guard sob timeout e cache (caracterizacao)', () => {
  const saved = { news: process.env.ENABLE_NEWS_GUARD, rr: process.env.ENABLE_RR_GUARD };
  const high = { impact: 'High', minutesUntil: 10, country: 'USD', title: 'CPI m/m' };

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.ENABLE_NEWS_GUARD = 'true';
    process.env.ENABLE_RR_GUARD = 'true';
    getEventsForSymbol.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  afterAll(() => {
    for (const [key, value] of [['ENABLE_NEWS_GUARD', saved.news], ['ENABLE_RR_GUARD', saved.rr]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const pick = (d: Awaited<ReturnType<typeof decideSignal>>) => ({
    recommendation: d.recommendation,
    confidence: d.confidence,
    newsDowngraded: d.newsDowngraded,
    validatorReasons: d.validatorReasons as string[],
    validatorAction: d.validatorAction,
  });
  const notDowngraded = { recommendation: 'BUY', confidence: 70, newsDowngraded: false, validatorReasons: [], validatorAction: 'none' };

  it('calendario sem resposta: espera exatamente 6 s e segue sem rebaixar (igual a "sem evento")', async () => {
    getEventsForSymbol.mockReturnValue(new Promise(() => undefined));
    let settled = false;
    const pending = decideSignal(base).then((d) => {
      settled = true;
      return d;
    });
    await jest.advanceTimersByTimeAsync(5_999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(pick(await pending)).toEqual(notDowngraded);
  });

  it('cache frio e depois quente: a 1a decisao estoura e nao rebaixa, a 2a ve o evento e rebaixa', async () => {
    let resolveFetch: (v: unknown) => void = () => undefined;
    const slowFetch = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    getEventsForSymbol.mockReturnValueOnce(slowFetch).mockResolvedValueOnce({ events: [high], degraded: false });

    const first = decideSignal(base);
    await jest.advanceTimersByTimeAsync(6_000);
    resolveFetch({ events: [high], degraded: false }); // a busca termina depois do limite
    const second = await decideSignal(base);

    expect(pick(await first)).toEqual(notDowngraded);
    expect(pick(second)).toEqual({
      recommendation: 'WAIT', confidence: 45, newsDowngraded: true, validatorReasons: ['news_event'], validatorAction: 'downgraded',
    });
  });

  it('fonte degradada sem cache (lista vazia): segue sem rebaixar, igual a "sem evento"', async () => {
    getEventsForSymbol.mockResolvedValue({ events: [], degraded: true });
    expect(pick(await decideSignal(base))).toEqual(notDowngraded);
  });

  it('fonte degradada com cache velho que tem o evento: rebaixa pelo cache', async () => {
    getEventsForSymbol.mockResolvedValue({ events: [high], degraded: true });
    expect(pick(await decideSignal(base)).recommendation).toBe('WAIT');
  });
});

/** D4 (19/10/2026): status do news guard em memoria; a decisao segue a mesma. */
describe('decideSignal: newsGuardStatus', () => {
  const saved = { news: process.env.ENABLE_NEWS_GUARD, rr: process.env.ENABLE_RR_GUARD };
  const high = { impact: 'High', minutesUntil: 10, country: 'USD', title: 'CPI m/m' };

  beforeEach(() => {
    process.env.ENABLE_RR_GUARD = 'true';
    getEventsForSymbol.mockReset();
  });
  afterEach(() => jest.useRealTimers());
  afterAll(() => {
    for (const [key, value] of [['ENABLE_NEWS_GUARD', saved.news], ['ENABLE_RR_GUARD', saved.rr]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each([
    ['disabled', 'false', base, () => getEventsForSymbol.mockResolvedValue({ events: [high], degraded: false }), 'BUY'],
    ['skipped (WAIT do modelo)', 'true', { ...base, recommendation: 'WAIT' as const }, (): void => undefined, 'WAIT'],
    ['skipped (R/R rebaixou antes)', 'true', { ...base, riskRewardTp1: 0.8, riskRewardTp2: 1 }, (): void => undefined, 'WAIT'],
    ['no_event', 'true', base, () => getEventsForSymbol.mockResolvedValue({ events: [], degraded: false }), 'BUY'],
    ['event', 'true', base, () => getEventsForSymbol.mockResolvedValue({ events: [high], degraded: false }), 'WAIT'],
    ['degraded_no_event', 'true', base, () => getEventsForSymbol.mockResolvedValue({ events: [], degraded: true }), 'BUY'],
    ['degraded_event', 'true', base, () => getEventsForSymbol.mockResolvedValue({ events: [high], degraded: true }), 'WAIT'],
    ['error', 'true', base, (): void => { getEventsForSymbol.mockRejectedValue(new Error('boom')); }, 'BUY'],
  ] as const)('%s', async (label, flag, input, arrange, recommendation) => {
    process.env.ENABLE_NEWS_GUARD = flag;
    arrange();
    const d = await decideSignal(input);
    expect(d.newsGuardStatus).toBe(label.split(' ')[0]);
    expect(d.recommendation).toBe(recommendation);
  });

  it('timeout: status timeout, distinto de erro e de sem evento', async () => {
    jest.useFakeTimers();
    process.env.ENABLE_NEWS_GUARD = 'true';
    getEventsForSymbol.mockReturnValue(new Promise(() => undefined));
    const pending = decideSignal(base);
    await jest.advanceTimersByTimeAsync(6_000);
    const d = await pending;
    expect(d.newsGuardStatus).toBe('timeout');
    expect(d.recommendation).toBe('BUY');
  });

  it('erro com a mesma mensagem do timeout continua sendo erro (a classificacao e pelo tipo, nao pelo texto)', async () => {
    process.env.ENABLE_NEWS_GUARD = 'true';
    getEventsForSymbol.mockRejectedValue(new Error('calendar timed out'));
    expect((await decideSignal(base)).newsGuardStatus).toBe('error');
  });
});
