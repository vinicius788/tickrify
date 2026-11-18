/**
 * D4 (19/10/2026): worker com o ADAPTER REAL e so o cliente da OpenAI falso.
 *
 * Fase 1 (caracterizacao, antes da correcao) mediu, em toda analise que chega
 * a decidir: 2 validateTradePlan, 2 decideSignal e, com compra/venda, 2
 * consultas ao calendario do news guard; a 1a decisao (adapter) era descartada
 * e a 2a (worker) gravada. Divergencia medida: confianca 72.4 no adapter x 72
 * gravada.
 *
 * Correcao D4: para resultado vindo do adapter, a decisao do adapter e a unica.
 * O worker so valida o plano (validateTradePlan, puro, protege fonte que nao
 * passa pelo adapter) e grava a decisao do adapter com a confianca inteira.
 * A fonte de demonstracao (fora de producao) segue com decisao propria.
 */

jest.mock('bullmq', () => ({
  Job: class {},
  UnrecoverableError: class UnrecoverableError extends Error {},
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}));

jest.mock('dotenv/config', () => ({}));

jest.mock('@prisma/client', () => {
  function createAutoMock(): any {
    const target: any = function autoMockFn() {
      return Promise.resolve(undefined);
    };
    return new Proxy(target, {
      get(obj, prop) {
        if (prop === 'then') return undefined;
        if (prop in obj) return obj[prop];
        return createAutoMock();
      },
    });
  }
  class MockPrismaClient {
    constructor(..._args: unknown[]) {
      const client = createAutoMock();
      client.analysis = createAutoMock();
      client.analysis.update = jest.fn().mockResolvedValue({ createdAt: new Date('2026-10-19T00:00:00Z') });
      (globalThis as any).__prisma = client;
      return client;
    }
  }
  const { Prisma } = jest.requireActual('@prisma/client');
  return { PrismaClient: MockPrismaClient, Prisma: { ...Prisma, sql: Prisma.sql, empty: Prisma.empty, join: Prisma.join, DbNull: 'DbNull', JsonNull: 'JsonNull' } };
});

jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class { constructor(..._args: unknown[]) {} } }));
jest.mock('../modules/database/prisma.datasource', () => ({ resolvePrismaDatasourceUrl: () => 'postgres://mock' }));
jest.mock('../common/flags/feature-flags', () => ({
  ...jest.requireActual('../common/flags/feature-flags'),
  startFlagRefresh: jest.fn(),
}));
jest.mock('../common/utils/ai-runtime', () => ({
  ...jest.requireActual('../common/utils/ai-runtime'),
  // Sem chave + fallback ligado = fonte de demonstracao (nao passa pelo adapter).
  hasValidOpenAiKey: () => !(globalThis as any).__demoSource,
  canUseDemoFallback: () => Boolean((globalThis as any).__demoSource),
}));
jest.mock('../../worker/outcome.sweeper', () => ({ ...jest.requireActual('../../worker/outcome.sweeper'), startOutcomeSweeper: jest.fn() }));

// Cliente OpenAI falso: o adapter real monta a requisicao e le a resposta daqui.
jest.mock('openai', () => ({
  __esModule: true,
  default: class FakeOpenAI {
    chat = { completions: { create: (...args: unknown[]) => (globalThis as any).__openaiCreate(...args) } };
  },
}));

// Calendario: uma funcao so, contada. hours=2 e o news guard; hours=24 e o contexto do deep.
jest.mock('../modules/calendar/calendar.service', () => ({
  EconomicCalendarService: jest.fn().mockImplementation(() => ({
    getEventsForSymbol: (...args: unknown[]) => (globalThis as any).__calendar(...args),
  })),
}));

// Espioes que chamam a implementacao real (adapter e worker importam o mesmo modulo).
jest.mock('../common/utils/signal-decision', () => {
  const actual = jest.requireActual('../common/utils/signal-decision');
  return { ...actual, decideSignal: jest.fn(actual.decideSignal) };
});
jest.mock('../common/utils/trade-plan-validator', () => {
  const actual = jest.requireActual('../common/utils/trade-plan-validator');
  return { ...actual, validateTradePlan: jest.fn(actual.validateTradePlan) };
});

import { decideSignal } from '../common/utils/signal-decision';
import { validateTradePlan } from '../common/utils/trade-plan-validator';
import { AIAdapter } from '../modules/ai/ai.adapter';
import { makeRawSqlPrisma } from './raw-sql-mock';
import { __resetFlagCacheForTests, applyFlagOverrideLocally } from '../common/flags/feature-flags';
import { SETUP_CONTINUATION_FLAG } from '../modules/ai/setup-continuation';

type Event = { impact: string; minutesUntil: number; country: string; title: string };

const openaiCreate = jest.fn();
const calendar = jest.fn();
(globalThis as any).__openaiCreate = openaiCreate;
(globalThis as any).__calendar = calendar;

// v11: o plano do modelo (zona, alvos) e o preco real que o grounding entrega,
// ATR 2, com fundo real em 98,5 e topo em 101,5 (a invalidacao encaixa).
// Compra a mercado no preco real 101,2: stop 98 (invalidacao 98,5 - 0,25 ATR),
// TP1 105 (1,19R), TP2 111,5 (3,22R): o ENTER_NOW do modelo fica. Venda: o
// espelho a 98,8.
const LONG_PLAN = {
  direction: 'long', triggerType: 'zone_reaction', zoneLow: 99, zoneHigh: 100, invalidation: 98.5,
  target1: 105, target2: 111.5, validForCandles: 16, trigger: 'Bullish close in the top third at 99-100',
};
const SHORT_PLAN = {
  direction: 'short', triggerType: 'zone_reaction', zoneLow: 100, zoneHigh: 101, invalidation: 101.5,
  target1: 95, target2: 88.5, validForCandles: 16, trigger: 'Bearish close in the bottom third at 100-101',
};
type Market = 'long' | 'short' | 'btc';
function marketFor(market: Market) {
  const price = market === 'short' ? 98.8 : 101.2;
  const k = market === 'btc' ? 100 : 1;
  return {
    block: 'REAL DATA', candles: 'injected', marketContext: 'unavailable', assetClass: 'crypto',
    stats: { v: 1, symbol: 'TEST', interval: '30m', coverage: 'injected', numbers: {
      lastClose: price * k, atr14: 2 * k, late: { long: false, short: false },
      swings: [{ kind: 'low', price: 98.5 * k }, { kind: 'high', price: 101.5 * k }],
    } },
  };
}
const CHECKLIST = 'C1 PASS: 4h; C2 PASS: discount; C3 PASS: pullback; C4 PASS: control; C5 FAIL: retested; C6 PASS: 1 ATR; C7 PASS: room. 6/7';

function modelReply(recommendation: string, confidence: unknown, analysis: Record<string, unknown>, top: Record<string, unknown> = {}) {
  const watchPlan = recommendation === 'BUY' ? LONG_PLAN : recommendation === 'SELL' ? SHORT_PLAN : null;
  return {
    model: 'gpt-5.6-luna',
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify({
        is_financial_chart: true,
        watchPlan,
        recommendation,
        confidence,
        analysis: {
          symbol: 'TEST', timeframe: '30m', marketStructure: { bias: 'bullish' },
          trendStrength: 'strong', factorsPresent: 6, structureValidation: CHECKLIST,
          ...analysis,
        },
        ...top,
      }) },
    }],
  };
}

const buyPlan = {
  currentPrice: 101, entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120, entryType: 'market',
  probabilityTp1: 55, probabilityTp2: 30, probabilityStop: 45,
};
const sellPlan = {
  currentPrice: 99, entry: 100, stopLoss: 105, takeProfit1: 90, takeProfit2: 80, entryType: 'market',
  probabilityTp1: 55, probabilityTp2: 30, probabilityStop: 45,
};
const high: Event = { impact: 'High', minutesUntil: 10, country: 'USD', title: 'CPI m/m' };

/** O que o calendario do news guard faz no cenario. */
type CalendarMode =
  | { kind: 'events'; events: Event[]; degraded?: boolean }
  | { kind: 'timeout' }
  | { kind: 'error' };

interface Scenario {
  name: string;
  replies: unknown[];
  analysisType?: 'quick' | 'deep';
  userLanguage?: string;
  calendar?: CalendarMode;
  market?: Market;
  setupId?: string;
}

const scenarios: Scenario[] = [
  { name: 'compra valida', replies: [modelReply('BUY', 70, buyPlan)] },
  { name: 'venda valida', market: 'short', replies: [modelReply('SELL', 70, { ...sellPlan, marketStructure: { bias: 'bearish' } })] },
  { name: 'WAIT original', replies: [modelReply('HOLD', 55, { currentPrice: 101 })] },
  {
    name: 'sem geometria (alvo a menos de 1R das duas entradas)',
    replies: [modelReply('BUY', 70, buyPlan, { watchPlan: { ...LONG_PLAN, target1: 101.9, target2: null } })],
  },
  {
    name: 'ARMED do modelo vira WATCH (a ordem limit nao e mais emitida)',
    replies: [modelReply('BUY', 70, { ...buyPlan, entryType: 'limit' })],
  },
  {
    name: 'noticia: evento encontrado (rebaixa)',
    replies: [modelReply('BUY', 70, buyPlan)],
    calendar: { kind: 'events', events: [high] },
  },
  {
    name: 'noticia: nenhum evento',
    replies: [modelReply('BUY', 70, buyPlan)],
    calendar: { kind: 'events', events: [] },
  },
  {
    name: 'noticia: timeout de 6 s (segue sem rebaixar, status timeout)',
    replies: [modelReply('BUY', 70, buyPlan)],
    calendar: { kind: 'timeout' },
  },
  {
    name: 'noticia: erro do calendario (segue sem rebaixar, status error)',
    replies: [modelReply('BUY', 70, buyPlan)],
    calendar: { kind: 'error' },
  },
  {
    name: 'noticia: fonte degradada sem evento',
    replies: [modelReply('BUY', 70, buyPlan)],
    calendar: { kind: 'events', events: [], degraded: true },
  },
  {
    name: 'noticia: fonte degradada com o evento no cache velho (rebaixa)',
    replies: [modelReply('BUY', 70, buyPlan)],
    calendar: { kind: 'events', events: [high], degraded: true },
  },
  { name: 'confianca decimal (72.4)', replies: [modelReply('BUY', 72.4, buyPlan)] },
  { name: 'confianca em texto ("70%")', replies: [modelReply('BUY', '70%', buyPlan)] },
  {
    name: 'preco corrigido por escala (BTC lido 100x menor)',
    market: 'btc',
    replies: [modelReply('BUY', 70, {
      symbol: 'BTCUSDT', currentPrice: 1012, entry: 1011, stopLoss: 985, takeProfit1: 1050, takeProfit2: 1115, entryType: 'market',
    }, { watchPlan: Object.fromEntries(Object.entries(LONG_PLAN).map(([k, v]) => [k, typeof v === 'number' && k !== 'validForCandles' ? v * 10 : v])) })],
  },
];

describe('worker + adapter real: uma decisao autoritativa (D4)', () => {
  const saved = {
    news: process.env.ENABLE_NEWS_GUARD,
  };
  let adapterResults: any[] = [];
  let logLines: string[] = [];

  beforeAll(() => {
    process.env.ENABLE_NEWS_GUARD = 'true';
    const capture = (...args: unknown[]) => {
      logLines.push(args.map(String).join(' '));
    };
    jest.spyOn(console, 'log').mockImplementation(capture);
    jest.spyOn(console, 'warn').mockImplementation(capture);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { Logger } = require('@nestjs/common');
    jest.spyOn(Logger.prototype, 'log').mockImplementation(capture as any);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture as any);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // Esta fixture modela a analise principal, sem uma resposta auxiliar de simbolo:
    // o grounding entrega direto as velas reais do cenario.
    jest.spyOn(AIAdapter.prototype as any, 'extractSymbol').mockResolvedValue(null);
    const market = () => marketFor((globalThis as any).__market ?? 'long');
    jest.spyOn(AIAdapter.prototype as any, 'buildQuickGrounding').mockImplementation(async () => market());
    jest.spyOn(AIAdapter.prototype as any, 'buildMarketEnrichment').mockImplementation(async () => ({ ...market(), calendar: 'not_attempted' }));
    // Guarda o que o adapter devolveu (a decisao autoritativa), chamando o metodo real.
    const original = AIAdapter.prototype.analyzeImage;
    jest.spyOn(AIAdapter.prototype, 'analyzeImage').mockImplementation(async function (this: AIAdapter, ...args: any[]) {
      const result = await (original as any).apply(this, args);
      adapterResults.push(result);
      return result;
    });
    require('../../worker/ai.worker');
  });

  afterEach(() => {
    jest.useRealTimers();
    (globalThis as any).__demoSource = false;
  });

  afterAll(() => {
    jest.restoreAllMocks();
    for (const [key, value] of [
      ['ENABLE_NEWS_GUARD', saved.news],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function processor(): (job: any) => Promise<unknown> {
    const { Worker } = require('bullmq');
    return (Worker as jest.Mock).mock.calls[0][1];
  }

  async function run(scenario: Scenario) {
    adapterResults = [];
    logLines = [];
    (globalThis as any).__market = scenario.market ?? 'long';
    openaiCreate.mockReset();
    for (const reply of scenario.replies) openaiCreate.mockResolvedValueOnce(reply);
    const mode = scenario.calendar ?? { kind: 'events', events: [] };
    calendar.mockReset();
    if (mode.kind === 'timeout') calendar.mockReturnValue(new Promise(() => undefined));
    else if (mode.kind === 'error') calendar.mockRejectedValue(new Error('calendar exploded'));
    else calendar.mockResolvedValue({ events: mode.events, degraded: Boolean(mode.degraded) });
    (validateTradePlan as jest.Mock).mockClear();
    (decideSignal as jest.Mock).mockClear();
    const prisma = (globalThis as any).__prisma;
    prisma.analysis.update.mockClear();

    let thrown: unknown = null;
    if (mode.kind === 'timeout') jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const job = processor()({ id: 'job-1', data: {
      analysisId: 'analysis-d4', imageUrl: 'data:image/png;base64,AA==',
      analysisType: scenario.analysisType ?? 'quick', userLanguage: scenario.userLanguage, userId: 'user-1', isDemo: true,
      ...(scenario.setupId ? { setupId: scenario.setupId } : {}),
    }, opts: { attempts: 1 }, attemptsMade: 0 }).catch((error: unknown) => {
      thrown = error;
    });
    if (mode.kind === 'timeout') await jest.advanceTimersByTimeAsync(6_000);
    await job;

    const updates = prisma.analysis.update.mock.calls.map(([args]: any[]) => args.data);
    const done = updates.find((d: any) => d.status === 'completed');
    const failed = updates.find((d: any) => d.status === 'failed');
    const decisions = await Promise.all((decideSignal as jest.Mock).mock.results.map((r) => r.value));
    const adapter = adapterResults[0];
    return {
      calls: {
        model: openaiCreate.mock.calls.length,
        validateTradePlan: (validateTradePlan as jest.Mock).mock.calls.length,
        decideSignal: (decideSignal as jest.Mock).mock.calls.length,
        newsCalendar: calendar.mock.calls.filter((c) => c[2] === 2).length,
        otherCalendar: calendar.mock.calls.filter((c) => c[2] !== 2).length,
      },
      decisions: decisions.map((d: any) => ({ recommendation: d.recommendation, confidence: d.confidence })),
      adapter: adapter
        ? {
            recommendation: adapter.recommendation,
            confidence: adapter.confidence,
            action: adapter.engineMeta?.validatorAction,
            reasons: adapter.engineMeta?.validatorReasons,
            flags: adapter.engineMeta?.validatorFlags,
            newsGuard: adapter.engineMeta?.newsGuardStatus,
          }
        : null,
      persisted: done
        ? {
            recommendation: done.recommendation,
            confidence: done.confidence,
            action: done.result.engine.validator_action,
            reasons: done.result.engine.validator_reasons,
            flags: done.result.engine.validator_flags,
            rrTp1: done.result.analysis.riskRewardTp1,
            rrTp2: done.result.analysis.riskRewardTp2,
            rrRatio: done.result.analysis.riskRewardRatio,
            probabilities: [
              done.result.analysis.probabilityTp1,
              done.result.analysis.probabilityTp2,
              done.result.analysis.probabilityStop,
            ],
          }
        : null,
      newsGuardLogs: logLines.filter((l) => l.startsWith('[news-guard]')),
      failed: failed ? { errorCode: failed.errorCode } : null,
      thrown: thrown ? String((thrown as Error).message) : null,
    };
  }

  it.each(['quick', 'deep'].flatMap(analysisType => ['en', 'pt', 'es', 'fr', 'de', 'ja'].map(userLanguage => ({ analysisType: analysisType as 'quick' | 'deep', userLanguage }))))('incremental coherence persists raw, decision and levels for $analysisType/$userLanguage', async ({ analysisType, userLanguage }) => {
    const labels: Record<string, [string, string, string]> = {
      en: ['Current checklist ', 'Previous checklist ', 'If checklist '],
      pt: ['Placar atual ', 'Placar anterior ', 'Se placar '],
      es: ['Confluencia actual ', 'Confluencia anterior ', 'Si confluencia '],
      fr: ['Checklist actuel ', 'Checklist précédent ', 'Si checklist '],
      de: ['Aktuelle Faktoren ', 'Vorherige Faktoren ', 'Wenn Faktoren '],
      ja: ['現在のチェックリスト', '過去のチェックリスト', 'もしチェックリスト'],
    };
    const [current, historical, hypothetical] = labels[userLanguage];
    const narrative = `${current}4/7. ${historical}4/7. ${hypothetical}4/7, wait.`;
    const presented = `${current}5/7. ${historical}4/7. ${hypothetical}4/7, wait.`;
    const fields = { ...buyPlan, invalidationLevel: 94,
      entryCondition: 'Buy at market while 101 holds.',
      structureValidation: 'C1 PASS: 4h; C2 PASS: zone; C3 PASS: setup; C4 FAIL: mixed; C5 FAIL: retested; C6 PASS: 1 ATR; C7 PASS: room → 4/7',
      factorsPresent: 4, confluenceScore: 57.14, executiveSummary: narrative,
      reasoning: narrative, multiTimeframeAlignment: 'H1 bullish | H4 bullish | D1 neutral' };
    const reply = modelReply('BUY', 60, fields);
    const raw = reply.choices[0].message.content;
    await run({ name: 'incremental', replies: [reply], analysisType, userLanguage });
    const done = (globalThis as any).__prisma.analysis.update.mock.calls.map(([args]: any[]) => args.data).find((d: any) => d.status === 'completed');
    expect(done).toBeDefined(); expect(done.recommendation).toBe('BUY');
    expect(done.fullResponse).toBe(raw);
    expect(done.result.analysis).toMatchObject({ invalidationLevel: 94, entryType: 'market', takeProfit1: 105, takeProfit2: 111.5,
      factorsPresent: 5, confluenceScore: 71.43, executiveSummary: presented, reasoning: presented });
    expect(done.result.analysis.entry).toBeCloseTo(101.2);
    expect(done.result.analysis.stopLoss).toBeCloseTo(98);
    expect(done.result.analysis.multiTimeframeAlignment).not.toBe(fields.multiTimeframeAlignment);
    expect(done.result.engine.validator_flags).toContain('stop_inside_invalidation');
    expect(done.result.engine.validator_action).toBe('none');
    expect(done.result).not.toHaveProperty('observation');
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(logLines.some(l => l.includes('persistence_candidate'))).toBe(true);
  });


  // Contagens depois da correcao: 1 modelo, 2 validateTradePlan (adapter + worker,
  // puro), 1 decideSignal (so o adapter) e 1 consulta ao calendario com compra/venda.
  const calls = (validateTradePlan: number, decideSignal: number, newsCalendar: number, model = 1) => ({
    model, validateTradePlan, decideSignal, newsCalendar, otherCalendar: 0,
  });
  // probabilityTp1 fica a 3 pontos da confianca (55 -> 67 com confianca 70) e o stop em no maximo 100 - TP1.
  const tradeSaved = (recommendation: string, confidence: number, action: string, rr: [number, number], probabilities: unknown[] = [67, 30, 33]) => ({
    recommendation, confidence, action, reasons: [], flags: [],
    rrTp1: rr[0], rrTp2: rr[1], rrRatio: `1:${rr[1].toFixed(1)}`, probabilities,
  });
  const waitSaved = (confidence: number, action: string, reasons: string[]) => ({
    recommendation: 'WAIT', confidence, action, reasons, flags: [],
    rrTp1: null, rrTp2: null, rrRatio: null, probabilities: [null, null, null],
  });
  const adapterSaid = (recommendation: string, confidence: number, action: string, reasons: string[], newsGuard: string) => ({
    recommendation, confidence, action, reasons, flags: [], newsGuard,
  });
  const ok = (c: object, adapter: object, persisted: object, newsGuard: string | null, level = '') => ({
    calls: c,
    decisions: [{ recommendation: (adapter as any).recommendation, confidence: (adapter as any).confidence }],
    adapter,
    persisted,
    newsGuardLogs: newsGuard ? [`[news-guard] status=${newsGuard} symbol=${level || 'TEST'}`] : [],
    failed: null,
    thrown: null,
  });

  const expected: Record<string, unknown> = {
    'compra valida': ok(calls(2, 1, 1), adapterSaid('BUY', 70, 'none', [], 'no_event'), tradeSaved('BUY', 70, 'none', [1.19, 3.22]), 'no_event'),
    'venda valida': ok(calls(2, 1, 1), adapterSaid('SELL', 70, 'none', [], 'no_event'), tradeSaved('SELL', 70, 'none', [1.19, 3.22]), 'no_event'),
    // HOLD sem cenario alternativo e NO_TRADE: confianca no maximo 49.
    'WAIT original': ok(calls(2, 1, 0), adapterSaid('WAIT', 49, 'none', [], 'skipped'), waitSaved(49, 'none', []), 'skipped'),
    'sem geometria (alvo a menos de 1R das duas entradas)': ok(
      calls(2, 1, 0), adapterSaid('WAIT', 49, 'downgraded', ['market_entry_invalid', 'no_valid_geometry'], 'skipped'),
      waitSaved(49, 'downgraded', ['market_entry_invalid', 'no_valid_geometry']), 'skipped',
    ),
    // ARMED do modelo (ordem limit) vira WATCH com o plano, sem niveis.
    'ARMED do modelo vira WATCH (a ordem limit nao e mais emitida)': ok(
      calls(2, 1, 0), adapterSaid('WAIT', 49, 'downgraded', ['limit_order_retired'], 'skipped'),
      waitSaved(49, 'downgraded', ['limit_order_retired']), 'skipped',
    ),
    'noticia: evento encontrado (rebaixa)': ok(
      calls(2, 1, 1), adapterSaid('WAIT', 49, 'downgraded', ['news_event'], 'event'),
      waitSaved(49, 'downgraded', ['news_event']), 'event',
    ),
    'noticia: nenhum evento': ok(calls(2, 1, 1), adapterSaid('BUY', 70, 'none', [], 'no_event'), tradeSaved('BUY', 70, 'none', [1.19, 3.22]), 'no_event'),
    'noticia: timeout de 6 s (segue sem rebaixar, status timeout)': ok(
      calls(2, 1, 1), adapterSaid('BUY', 70, 'none', [], 'timeout'), tradeSaved('BUY', 70, 'none', [1.19, 3.22]), 'timeout',
    ),
    'noticia: erro do calendario (segue sem rebaixar, status error)': ok(
      calls(2, 1, 1), adapterSaid('BUY', 70, 'none', [], 'error'), tradeSaved('BUY', 70, 'none', [1.19, 3.22]), 'error',
    ),
    'noticia: fonte degradada sem evento': ok(
      calls(2, 1, 1), adapterSaid('BUY', 70, 'none', [], 'degraded_no_event'), tradeSaved('BUY', 70, 'none', [1.19, 3.22]), 'degraded_no_event',
    ),
    'noticia: fonte degradada com o evento no cache velho (rebaixa)': ok(
      calls(2, 1, 1), adapterSaid('WAIT', 49, 'downgraded', ['news_event'], 'degraded_event'),
      waitSaved(49, 'downgraded', ['news_event']), 'degraded_event',
    ),
    // Tendencia forte: teto 72.
    'confianca decimal (72.4)': ok(calls(2, 1, 1), adapterSaid('BUY', 72, 'none', [], 'no_event'), tradeSaved('BUY', 72, 'none', [1.19, 3.22], [69, 30, 31]), 'no_event'),
    // O parser zera o texto; sem o piso antigo de 30, o sinal fica com confianca 0.
    'confianca em texto ("70%")': ok(calls(2, 1, 1), adapterSaid('BUY', 0, 'none', [], 'no_event'), tradeSaved('BUY', 0, 'none', [1.19, 3.22], [3, 3, 45]), 'no_event'),
    'preco corrigido por escala (BTC lido 100x menor)': ok(
      calls(2, 1, 1), adapterSaid('BUY', 70, 'fixed', [], 'no_event'), tradeSaved('BUY', 70, 'fixed', [1.19, 3.22], [null, null, null]),
      'no_event', 'BTCUSDT',
    ),
  };

  it.each(scenarios.map((s) => [s.name, s] as const))('%s', async (name, scenario) => {
    const summary = await run(scenario);
    expect({ name, summary }).toEqual({ name, summary: expected[name] });
  });

  it.each(scenarios.map((s) => [s.name, s] as const))('o gravado e a decisao do adapter: %s', async (_name, scenario) => {
    const { adapter, persisted } = await run(scenario);
    expect(adapter).not.toBeNull();
    expect(persisted).not.toBeNull();
    expect(persisted!.recommendation).toBe(adapter!.recommendation);
    expect(Math.round(persisted!.confidence)).toBe(Math.round(adapter!.confidence));
    expect(persisted!.action).toBe(adapter!.action);
    expect(persisted!.reasons).toEqual(adapter!.reasons);
    expect(persisted!.flags).toEqual(adapter!.flags);
  });

  it('plano invalido (TP1 abaixo da entrada): o adapter repete e falha antes da decisao', async () => {
    const bad = modelReply('BUY', 70, { ...buyPlan, takeProfit1: 90 });
    const result = await run({ name: 'plano invalido', replies: [bad, bad] });
    expect(result).toEqual({
      calls: calls(2, 0, 0, 2),
      decisions: [],
      adapter: null,
      persisted: null,
      newsGuardLogs: [],
      failed: { errorCode: 'invalid_trade_plan' },
      thrown: 'A IA retornou níveis incoerentes de entrada, stop ou alvo (direction).',
    });
  });

  // 19/10/2026: o que o worker GRAVA quando o modelo erra a soma (resposta real
  // do luna: 6 ✅ com total 5).
  it('grava o total do checklist pela lista', async () => {
    const checklist = 'C1 PASS: bearish. C2 PASS: premium. C3 PASS: OB 101. C4 PASS: sellers. ' +
      'C5 FAIL: retested. C6 PASS: 1 ATR. C7 PASS: room to 97. → 5/7 → SELL.';
    const result = await run({
      name: 'aritmetica',
      market: 'short',
      replies: [modelReply('SELL', 70, {
        ...sellPlan, factorsPresent: 5, confluenceScore: 71.43, structureValidation: checklist,
      })],
    });
    expect(result.persisted).toMatchObject({ recommendation: 'SELL', action: 'none', reasons: [], flags: [] });
    const done = (globalThis as any).__prisma.analysis.update.mock.calls
      .map(([args]: any[]) => args.data).find((d: any) => d.status === 'completed');
    expect(done.result.analysis).toMatchObject({ factorsPresent: 6, confluenceScore: 85.71 });
  });

  it('WATCH com velas reais: o worker grava o setup e o alerta entry no nivel do plano', async () => {
    const client = (globalThis as any).__prisma;
    const scaled = Object.fromEntries(Object.entries(LONG_PLAN).map(([k, v]) => [k, typeof v === 'number' && k !== 'validForCandles' ? v * 100 : v]));
    const row = { id: 'setup-worker001', userId: 'user-1', status: 'tracking', symbol: 'BTCUSDT', timeframe: '30m', rootAnalysisId: 'analysis-d4', createdAt: new Date(), lastAnalysisAt: new Date() };
    let setupCreated = false;
    const fake = makeRawSqlPrisma([
      ['SELECT "lastPrice", "checkedAt" FROM', () => [{ lastPrice: 10120, checkedAt: new Date() }]],
      ['a."groundingStats"', () => [{ id: 'analysis-d4', setupId: null, createdAt: new Date(), groundingInterval: '30m', clerkUserId: 'clerk_1' }]],
      ['COUNT(DISTINCT "setupId")', () => [{ n: 0 }]],
      ['COUNT(*)::int AS "n"', () => [{ n: 0 }]],
      ['AS "ok"', () => [{ ok: false }]],
      ['INSERT INTO "tickrify"."TrackedSetup"', () => { setupCreated = true; return 1; }],
      ['FROM "tickrify"."TrackedSetup"', () => (setupCreated ? [row] : [])],
      ['WHERE a."id" =', () => [{ id: 'alert-worker001', setupId: row.id, analysisId: 'analysis-d4', symbol: 'BTCUSDT', level: 10000, label: 'entry', side: 'below', status: 'active', createdAt: new Date() }]],
    ]);
    const restore = { $queryRaw: client.$queryRaw, $executeRaw: client.$executeRaw, $transaction: client.$transaction, adminAudit: client.adminAudit, count: client.analysis.count };
    Object.assign(client, { $queryRaw: fake.prisma.$queryRaw, $executeRaw: fake.prisma.$executeRaw, $transaction: fake.prisma.$transaction, adminAudit: { findFirst: jest.fn(async () => null) } });
    client.analysis.count = jest.fn(async () => 0);
    try {
      const out = await run({
        name: 'watch-auto', market: 'btc',
        replies: [modelReply('BUY', 70, {
          symbol: 'BTCUSDT', currentPrice: 10120, entry: 10000, stopLoss: 9500, takeProfit1: 11000, takeProfit2: 12000, entryType: 'limit',
        }, { watchPlan: scaled })],
      });
      expect(out.thrown).toBeNull();
      const saved = client.analysis.update.mock.calls.map(([args]: any[]) => args.data).find((d: any) => d.status === 'completed');
      expect(saved.result).toMatchObject({ signalState: 'WATCH', dataMode: 'real_data' });
      expect(fake.calls.some((c) => c.text.includes('INSERT INTO "tickrify"."TrackedSetup"'))).toBe(true);
      const insert = fake.calls.find((c) => c.text.includes('INSERT INTO "tickrify"."SetupAlert"'));
      expect(insert?.values).toEqual(expect.arrayContaining(['user-1', row.id, 'analysis-d4', 10000, 'entry', 'below', 10120, true]));
      expect(logLines.join('\n')).toContain('[alerts] watch-auto analysis=analysis-d4 outcome=created');
    } finally {
      Object.assign(client, { $queryRaw: restore.$queryRaw, $executeRaw: restore.$executeRaw, $transaction: restore.$transaction, adminAudit: restore.adminAudit });
      client.analysis.count = restore.count;
    }
  });

  describe('continuacao do setup', () => {
    const reply = () => modelReply('BUY', 70, { ...buyPlan, executiveSummary: 'Price held the zone.\nPRIOR_PLAN_STATUS: CONFIRMED' });
    const request = () => JSON.stringify(openaiCreate.mock.calls[0][0].messages);
    const priorRow = (symbol: string) => ({
      id: 'prior-d4', createdAt: new Date(), recommendation: 'WAIT', groundingInterval: '30m',
      result: { signalState: 'WATCH', watchPlan: { ...LONG_PLAN, trigger: `Reclaim ${'y'.repeat(300)}` }, analysis: { symbol, timeframe: '30m' } },
    });
    const withDb = async (symbol: string, fn: () => Promise<void>) => {
      const client = (globalThis as any).__prisma;
      const restore = { $queryRaw: client.$queryRaw, $executeRaw: client.$executeRaw };
      const fake = makeRawSqlPrisma([['"id" <>', () => [priorRow(symbol)]]]);
      Object.assign(client, { $queryRaw: fake.prisma.$queryRaw, $executeRaw: fake.prisma.$executeRaw });
      try {
        await fn();
      } finally {
        Object.assign(client, restore);
      }
    };
    const saved = () => (globalThis as any).__prisma.analysis.update.mock.calls.map(([args]: any[]) => args.data).find((d: any) => d.status === 'completed');
    afterEach(() => __resetFlagCacheForTests());

    it('chave desligada: com setupId o prompt fica byte a byte igual e nada e gravado', async () => {
      await run({ name: 'base', replies: [reply()] });
      const base = request();
      await withDb('TEST', async () => {
        await run({ name: 'off', replies: [reply()], setupId: 'setup-d4' });
      });
      expect(request()).toBe(base);
      expect(saved().result).not.toHaveProperty('continuation');
      expect(saved().result.engine).not.toHaveProperty('continuation');
    });

    it('chave ligada e mesmo ativo: o bloco entra depois da parte fixa e o status e gravado', async () => {
      await run({ name: 'base', replies: [reply()] });
      const base = JSON.parse(request());
      applyFlagOverrideLocally(SETUP_CONTINUATION_FLAG, 'true');
      await withDb('TEST', async () => {
        await run({ name: 'on', replies: [reply()], setupId: 'setup-d4' });
      });
      const prompt = request();
      const after = JSON.parse(prompt);
      const fixed = base[0].content.slice(0, base[0].content.lastIndexOf('</user_context>')).trimEnd();
      expect(after[0].content.startsWith(fixed)).toBe(true);
      expect(prompt).toContain('# PRIOR PLAN');
      expect(prompt.indexOf('# PRIOR PLAN')).toBeGreaterThan(prompt.indexOf('REAL DATA'));
      expect(prompt.indexOf('# PRIOR PLAN')).toBeLessThan(prompt.lastIndexOf('</user_context>'));
      expect(prompt).toContain(`Earlier trigger: Reclaim ${'y'.repeat(192)}`);
      expect(prompt).not.toContain('y'.repeat(193));
      expect(saved().result.continuation).toEqual({ setupId: 'setup-d4', priorAnalysisId: 'prior-d4', status: 'CONFIRMED', direction: 'long', level: 100 });
      expect(saved().result.engine.continuation).toBe(true);
      expect(saved().result.analysis.executiveSummary).not.toContain('PRIOR_PLAN_STATUS');
    });

    it('ativo diferente: nao injeta e o prompt fica igual', async () => {
      await run({ name: 'base', replies: [reply()] });
      const base = request();
      applyFlagOverrideLocally(SETUP_CONTINUATION_FLAG, 'true');
      await withDb('ETHUSDT', async () => {
        await run({ name: 'other', replies: [reply()], setupId: 'setup-d4' });
      });
      expect(request()).toBe(base);
      expect(saved().result).not.toHaveProperty('continuation');
    });

    it('motivo ligado: mesma chamada, frase salva e marcadores fora do texto exibido', async () => {
      applyFlagOverrideLocally(SETUP_CONTINUATION_FLAG, 'true');
      applyFlagOverrideLocally('SETUP_CONTINUATION_REASON', '1');
      await withDb('TEST', async () => {
        await run({ name: 'reason', replies: [modelReply('BUY', 70, { ...buyPlan, executiveSummary: 'Price held.\nPRIOR_PLAN_REASON: Price returned to the zone with a bullish close.\nPRIOR_PLAN_STATUS: CONFIRMED' })], setupId: 'setup-d4' });
      });
      expect(openaiCreate).toHaveBeenCalledTimes(1);
      expect(request()).toContain('PRIOR_PLAN_REASON');
      expect(saved().result.continuation.reason).toBe('Price returned to the zone with a bullish close.');
      expect(saved().result.analysis.executiveSummary).not.toMatch(/PRIOR_PLAN_(REASON|STATUS)/);
    });
  });

  it('fonte de demonstracao (nao passa pelo adapter): o worker valida e decide sozinho, uma vez', async () => {
    (globalThis as any).__demoSource = true;
    const random = jest.spyOn(Math, 'random').mockReturnValue(0); // COMPRA, confianca 0.7, preco 42000
    try {
      const result = await run({ name: 'demo', replies: [] });
      // validateTradePlan (puro) roda na resposta e de novo na analise ja decidida.
      // Sem velas reais nem plano, a compra da demo nao vira sinal: o news guard nem consulta.
      expect(result.calls).toEqual({ model: 0, validateTradePlan: 2, decideSignal: 1, newsCalendar: 0, otherCalendar: 0 });
      expect(result.adapter).toBeNull();
      expect(result.decisions).toHaveLength(1);
      expect(result.persisted).toMatchObject({
        recommendation: result.decisions[0].recommendation,
        confidence: result.decisions[0].confidence,
      });
      expect(result.newsGuardLogs).toHaveLength(1);
      expect(result.newsGuardLogs[0]).toMatch(/^\[news-guard\] status=skipped symbol=/);
    } finally {
      random.mockRestore();
    }
  });
});
