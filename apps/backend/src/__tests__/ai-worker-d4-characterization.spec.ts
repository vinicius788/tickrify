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
  return { PrismaClient: MockPrismaClient, Prisma: { DbNull: 'DbNull', JsonNull: 'JsonNull' } };
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
jest.mock('../../worker/outcome.sweeper', () => ({ startOutcomeSweeper: jest.fn() }));

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

type Event = { impact: string; minutesUntil: number; country: string; title: string };

const openaiCreate = jest.fn();
const calendar = jest.fn();
(globalThis as any).__openaiCreate = openaiCreate;
(globalThis as any).__calendar = calendar;

function modelReply(recommendation: string, confidence: unknown, analysis: Record<string, unknown>) {
  return {
    model: 'gpt-5.6-luna',
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify({
        is_financial_chart: true,
        recommendation,
        confidence,
        analysis: {
          symbol: 'TEST', timeframe: '30m', marketStructure: { bias: 'bullish' },
          trendStrength: 'strong', factorsPresent: 6,
          ...analysis,
        },
      }) },
    }],
  };
}

const buyPlan = {
  currentPrice: 101, entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120,
  probabilityTp1: 55, probabilityTp2: 30, probabilityStop: 45,
};
const sellPlan = {
  currentPrice: 99, entry: 100, stopLoss: 105, takeProfit1: 90, takeProfit2: 80,
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
}

const scenarios: Scenario[] = [
  { name: 'compra valida', replies: [modelReply('BUY', 70, buyPlan)] },
  { name: 'venda valida', replies: [modelReply('SELL', 70, { ...sellPlan, marketStructure: { bias: 'bearish' } })] },
  { name: 'WAIT original', replies: [modelReply('HOLD', 55, { currentPrice: 101 })] },
  {
    name: 'rebaixamento por R (melhor alvo abaixo de 1.2R)',
    replies: [modelReply('BUY', 70, { ...buyPlan, takeProfit1: 101, takeProfit2: 102 })],
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
    replies: [modelReply('BUY', 70, {
      symbol: 'BTCUSDT', currentPrice: 1065, entry: 1064, stopLoss: 1058, takeProfit1: 1076, takeProfit2: 1088,
    })],
  },
];

describe('worker + adapter real: uma decisao autoritativa (D4)', () => {
  const saved = {
    news: process.env.ENABLE_NEWS_GUARD,
    rr: process.env.ENABLE_RR_GUARD,
    grounding: process.env.ENABLE_QUICK_GROUNDING,
  };
  let adapterResults: any[] = [];
  let logLines: string[] = [];

  beforeAll(() => {
    process.env.ENABLE_NEWS_GUARD = 'true';
    process.env.ENABLE_RR_GUARD = 'true';
    process.env.ENABLE_QUICK_GROUNDING = 'false';
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
      ['ENABLE_NEWS_GUARD', saved.news], ['ENABLE_RR_GUARD', saved.rr], ['ENABLE_QUICK_GROUNDING', saved.grounding],
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
      analysisId: 'analysis-d4', imageUrl: 'data:image/png;base64,AA==', promptOverride: 'PROMPT',
      analysisType: scenario.analysisType ?? 'quick', userLanguage: scenario.userLanguage, userId: 'user-1', isDemo: true,
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
    const fields = { ...buyPlan, invalidationLevel: 94, entryType: 'stop',
      entryCondition: 'Enter after a candle close above 100.',
      structureValidation: '✅ HTF | ❌ Zone | ✅ ICT | ✅ Anti-retail | ✅ Structure | ✅ R:R | ❌ MTF → 4/7',
      factorsPresent: 4, confluenceScore: 57.14, executiveSummary: narrative,
      reasoning: narrative, multiTimeframeAlignment: 'H1 bullish | H4 bullish | D1 neutral' };
    const reply = modelReply('BUY', 60, fields);
    const raw = reply.choices[0].message.content;
    await run({ name: 'incremental', replies: [reply], analysisType, userLanguage });
    const done = (globalThis as any).__prisma.analysis.update.mock.calls.map(([args]: any[]) => args.data).find((d: any) => d.status === 'completed');
    expect(done).toBeDefined(); expect(done.recommendation).toBe('BUY');
    expect(done.fullResponse).toBe(raw);
    expect(done.result.analysis).toMatchObject({ entry: 100, stopLoss: 95, invalidationLevel: 94,
      takeProfit1: 110, takeProfit2: 120, factorsPresent: 5, confluenceScore: 71.43,
      executiveSummary: presented, reasoning: presented });
    expect(done.result.analysis.multiTimeframeAlignment).not.toBe(fields.multiTimeframeAlignment);
    expect(done.result.engine.validator_flags).toContain('stop_inside_invalidation');
    expect(done.result.engine.validator_action).toBe('none');
    expect(done.result).not.toHaveProperty('observation');
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(logLines.some(l => l.includes('price_order_requires_close'))).toBe(true);
    expect(logLines.some(l => l.includes('persistence_candidate'))).toBe(true);
  });


  it.each(['quick', 'deep'].flatMap(analysisType => ['en', 'pt', 'es', 'fr', 'de', 'ja'].flatMap(userLanguage => [false, true].map(optional => ({ analysisType: analysisType as 'quick' | 'deep', userLanguage, optional })))))('B1 keeps LIMIT data and observational optional=$optional for $analysisType/$userLanguage', async ({ analysisType, userLanguage, optional }) => {
    const conditions: Record<string, [string, string]> = {
    "en": [
        "Place limit 100 only after a sweep and rejection.",
        "Limit 100; preferably enter after a sweep and rejection."
    ],
    "pt": [
        "Coloque limit 100 somente após varredura e rejeição.",
        "Limit 100; preferencialmente entrar após varredura e rejeição."
    ],
    "es": [
        "Orden limit 100 solo después de barrida y rechazo.",
        "Limit 100; preferiblemente entrar después de barrida y rechazo."
    ],
    "fr": [
        "Ordre limit 100 uniquement après balayage et rejet.",
        "Limit 100; de préférence entrer après balayage et rejet."
    ],
    "de": [
        "Limit 100 erst nach Sweep und Ablehnung platzieren.",
        "Limit 100; vorzugsweise nach Sweep und Ablehnung einsteigen."
    ],
    "ja": [
        "リミット100、スイープと反発の確認後のみ注文。",
        "リミット100、できればスイープと反発の確認後に注文。"
    ]
};
    const entryCondition = conditions[userLanguage][optional ? 1 : 0];
    const narrative = 'Checklist 4/7.';
    const presented = 'Checklist 5/7.';
    const fields = { ...buyPlan, invalidationLevel: 94, entryType: 'limit',
      entryCondition,
      structureValidation: '✅ HTF | ❌ Zone | ✅ ICT | ✅ Anti-retail | ✅ Structure | ✅ R:R | ❌ MTF → 4/7',
      factorsPresent: 4, confluenceScore: 57.14, executiveSummary: narrative,
      reasoning: narrative, multiTimeframeAlignment: 'H1 bullish | H4 bullish | D1 neutral' };
    const reply = modelReply('BUY', 60, fields);
    const raw = reply.choices[0].message.content;
    await run({ name: 'incremental', replies: [reply], analysisType, userLanguage });
    const done = (globalThis as any).__prisma.analysis.update.mock.calls.map(([args]: any[]) => args.data).find((d: any) => d.status === 'completed');
    expect(done).toBeDefined(); expect(done.recommendation).toBe('BUY');
    expect(done.fullResponse).toBe(raw);
    expect(done.result.analysis).toMatchObject({ entry: 100, stopLoss: 95, invalidationLevel: 94,
      takeProfit1: 110, takeProfit2: 120, factorsPresent: 5, confluenceScore: 71.43,
      executiveSummary: presented, reasoning: presented });
    expect(done.result.analysis.multiTimeframeAlignment).not.toBe(fields.multiTimeframeAlignment);
    expect(done.result.engine.validator_flags).toContain('stop_inside_invalidation');
    expect(done.result.engine.validator_action).toBe('none');
    expect(done.result).not.toHaveProperty('observation');
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(done.result.analysis).toMatchObject({ entryType: 'limit', entryCondition });
    expect(logLines.some(l => l.includes('[AnalysisObservation]') && l.includes('touch_requires_confirmation'))).toBe(!optional);
    expect(done.result).not.toHaveProperty('limitCondition');
    expect(logLines.some(l => l.includes('persistence_candidate'))).toBe(true);
  });

  // Contagens depois da correcao: 1 modelo, 2 validateTradePlan (adapter + worker,
  // puro), 1 decideSignal (so o adapter) e 1 consulta ao calendario com compra/venda.
  const calls = (validateTradePlan: number, decideSignal: number, newsCalendar: number, model = 1) => ({
    model, validateTradePlan, decideSignal, newsCalendar, otherCalendar: 0,
  });
  const tradeSaved = (recommendation: string, confidence: number, action: string, rr: [number, number], probabilities: unknown[] = [55, 30, 45]) => ({
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
    'compra valida': ok(calls(2, 1, 1), adapterSaid('BUY', 70, 'none', [], 'no_event'), tradeSaved('BUY', 70, 'none', [2, 4]), 'no_event'),
    'venda valida': ok(calls(2, 1, 1), adapterSaid('SELL', 70, 'none', [], 'no_event'), tradeSaved('SELL', 70, 'none', [2, 4]), 'no_event'),
    // 55.00000000000001: a confianca vai 0..1 no worker e volta x100 ao gravar (problema separado, ja existia).
    'WAIT original': ok(calls(2, 1, 0), adapterSaid('WAIT', 55, 'none', [], 'skipped'), waitSaved(55.00000000000001, 'none', []), 'skipped'),
    'rebaixamento por R (melhor alvo abaixo de 1.2R)': ok(
      calls(2, 1, 0), adapterSaid('WAIT', 45, 'downgraded', ['rr_below_min'], 'skipped'),
      waitSaved(45, 'downgraded', ['rr_below_min']), 'skipped',
    ),
    'noticia: evento encontrado (rebaixa)': ok(
      calls(2, 1, 1), adapterSaid('WAIT', 45, 'downgraded', ['news_event'], 'event'),
      waitSaved(45, 'downgraded', ['news_event']), 'event',
    ),
    'noticia: nenhum evento': ok(calls(2, 1, 1), adapterSaid('BUY', 70, 'none', [], 'no_event'), tradeSaved('BUY', 70, 'none', [2, 4]), 'no_event'),
    'noticia: timeout de 6 s (segue sem rebaixar, status timeout)': ok(
      calls(2, 1, 1), adapterSaid('BUY', 70, 'none', [], 'timeout'), tradeSaved('BUY', 70, 'none', [2, 4]), 'timeout',
    ),
    'noticia: erro do calendario (segue sem rebaixar, status error)': ok(
      calls(2, 1, 1), adapterSaid('BUY', 70, 'none', [], 'error'), tradeSaved('BUY', 70, 'none', [2, 4]), 'error',
    ),
    'noticia: fonte degradada sem evento': ok(
      calls(2, 1, 1), adapterSaid('BUY', 70, 'none', [], 'degraded_no_event'), tradeSaved('BUY', 70, 'none', [2, 4]), 'degraded_no_event',
    ),
    'noticia: fonte degradada com o evento no cache velho (rebaixa)': ok(
      calls(2, 1, 1), adapterSaid('WAIT', 45, 'downgraded', ['news_event'], 'degraded_event'),
      waitSaved(45, 'downgraded', ['news_event']), 'degraded_event',
    ),
    // O adapter decide 72.4; o worker grava inteiro (72), como sempre gravou.
    'confianca decimal (72.4)': ok(calls(2, 1, 1), adapterSaid('BUY', 72.4, 'none', [], 'no_event'), tradeSaved('BUY', 72, 'none', [2, 4]), 'no_event'),
    // O parser zera o texto antes de decidir: piso de 30.
    'confianca em texto ("70%")': ok(calls(2, 1, 1), adapterSaid('BUY', 30, 'none', [], 'no_event'), tradeSaved('BUY', 30, 'none', [2, 4]), 'no_event'),
    'preco corrigido por escala (BTC lido 100x menor)': ok(
      calls(2, 1, 1), adapterSaid('BUY', 70, 'fixed', [], 'no_event'), tradeSaved('BUY', 70, 'fixed', [2, 4], [null, null, null]),
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

  // 19/10/2026: o que o worker GRAVA quando o modelo erra a aritmetica (resposta
  // real do luna: stop de venda com percentual positivo, 6 ✅ com total 5).
  it('grava percentuais pelos precos, o total do checklist pela lista e a marca do limit com confirmacao', async () => {
    const checklist = '✅ HTF: bearish. ✅ Zone: premium. ✅ OB: 101. ✅ Liquidity: swept. ' +
      '✅ BOS: confirmed. ✅ R:R: 2. ❌ MTF: one chart. → 5/7 → SELL.';
    const result = await run({
      name: 'aritmetica',
      replies: [modelReply('SELL', 70, {
        ...sellPlan, stopLossPercent: 5, takeProfit1Percent: 5, takeProfit2Percent: 20,
        factorsPresent: 5, confluenceScore: 71.43, structureValidation: checklist,
        entryType: 'limit', entryCondition: 'Sell limit at 100 only after a sweep and rejection; no rejection, no trade.',
      })],
    });
    expect(result.persisted).toMatchObject({ recommendation: 'SELL', action: 'none', reasons: [], flags: ['limit_needs_confirmation'] });
    const done = (globalThis as any).__prisma.analysis.update.mock.calls
      .map(([args]: any[]) => args.data).find((d: any) => d.status === 'completed');
    expect(done.result.analysis).toMatchObject({
      stopLossPercent: -5, takeProfit1Percent: 10, takeProfit2Percent: 20, factorsPresent: 6, confluenceScore: 85.71,
    });
  });

  it('fonte de demonstracao (nao passa pelo adapter): o worker valida e decide sozinho, uma vez', async () => {
    (globalThis as any).__demoSource = true;
    const random = jest.spyOn(Math, 'random').mockReturnValue(0); // COMPRA, confianca 0.7, preco 42000
    try {
      const result = await run({ name: 'demo', replies: [] });
      expect(result.calls).toEqual({ model: 0, validateTradePlan: 1, decideSignal: 1, newsCalendar: 1, otherCalendar: 0 });
      expect(result.adapter).toBeNull();
      expect(result.decisions).toHaveLength(1);
      expect(result.persisted).toMatchObject({
        recommendation: result.decisions[0].recommendation,
        confidence: result.decisions[0].confidence,
      });
      expect(result.newsGuardLogs).toHaveLength(1);
      expect(result.newsGuardLogs[0]).toMatch(/^\[news-guard\] status=no_event symbol=/);
    } finally {
      random.mockRestore();
    }
  });
});
