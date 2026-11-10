/**
 * Regressao do bug CRITICAL: job.data.strategyProfile chegava intacto ao
 * `queue.add` (ai.service.ts) mas o worker (worker/ai.worker.ts) o
 * descartava em dois lugares — no destructuring de `job.data` dentro de
 * `processAnalysis` e na chamada de `aiAdapter.analyzeImage` dentro de
 * `resolveAiSource`. Como RUN_EMBEDDED_WORKER=true por padrao em producao,
 * quase toda analise passa pela FILA (este arquivo), nao pelo caminho
 * sincrono de `ai.service.ts` — que sempre propagou o perfil corretamente e
 * por isso nunca teria pego este bug.
 *
 * O teste estatico existente (`strategy-profile.spec.ts`) so le o
 * texto-fonte de `ai.adapter.ts` e passava 13 de 13 com o bug presente,
 * porque nunca executa o worker. Este teste executa o processor de verdade
 * que o BullMQ chamaria por job (`new Worker('ai-analysis', processAnalysis, ...)`),
 * capturado a partir do construtor mockado de `Worker`, e verifica que
 * `strategyProfile` chega como QUINTO argumento de `analyzeImage`.
 *
 * Nao ha uma pasta `worker/__tests__` hoje (o diretorio `worker/` fica fora
 * do `rootDir: "src"` do jest.config em package.json, que so descobre
 * `*.spec.ts` dentro de `src/`). Colocado em `src/__tests__/` — o padrao
 * mais proximo ja usado no projeto (ver `src/common/flags/__tests__`,
 * `src/modules/auth/__tests__`, `src/modules/ticks/__tests__` etc.) — para
 * que `jest` (sem argumento) o descubra normalmente.
 */

// ─── Mocks de tudo que roda como efeito colateral no import de ai.worker.ts ──

jest.mock('bullmq', () => ({
  Job: class {},
  UnrecoverableError: class UnrecoverableError extends Error {},
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
}));

jest.mock('dotenv/config', () => ({}));

jest.mock('@prisma/client', () => {
  // Auto-mock recursivo: qualquer `prisma.<qualquer>.<qualquer>(...)` vira
  // uma funcao que resolve `undefined`. Cobre analysis.update,
  // tickTransaction.findFirst/create, userTicks.upsert, $transaction etc.
  // sem precisar listar cada chamada usada por processAnalysis.
  // Cada chamada fica registrada com o caminho (ex.: "analysis.update"), para o
  // teste de persistencia conferir o que o worker GRAVA, nao so o que ele pede.
  const calls: Array<{ path: string; args: unknown[] }> = [];
  (globalThis as any).__prismaCalls = calls;
  function createAutoMock(path: string[] = []): any {
    const target: any = function autoMockFn(...args: unknown[]) {
      calls.push({ path: path.join('.'), args });
      return Promise.resolve(undefined);
    };
    return new Proxy(target, {
      get(obj, prop) {
        if (prop === 'then') return undefined; // nunca parece um thenable
        if (prop in obj) return obj[prop];
        return createAutoMock([...path, String(prop)]);
      },
    });
  }

  class MockPrismaClient {
    static lastClient: any;
    constructor(..._args: unknown[]) {
      const client = createAutoMock();
      const analysis = createAutoMock();
      // Uma atualização Prisma devolve a linha, usada pelo evento de falha definitiva.
      analysis.update = jest.fn().mockResolvedValue({ createdAt: new Date('2026-09-23T00:00:00Z') });
      client.analysis = analysis;
      MockPrismaClient.lastClient = client;
      return client;
    }
  }

  return {
    PrismaClient: MockPrismaClient,
    Prisma: { DbNull: 'DbNull', JsonNull: 'JsonNull' },
  };
});

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class MockPrismaPg {
    constructor(..._args: unknown[]) {}
  },
}));

jest.mock('../modules/database/prisma.datasource', () => ({
  resolvePrismaDatasourceUrl: () => 'postgres://mock-datasource',
}));

jest.mock('../common/flags/feature-flags', () => {
  const actual = jest.requireActual('../common/flags/feature-flags');
  return {
    ...actual,
    // Sem isto o `setInterval` real do refresh de flags ficaria pendurado
    // depois do teste (open handle) e bateria no banco (auto-mockado, mas
    // desnecessario).
    startFlagRefresh: jest.fn(),
  };
});

jest.mock('../common/utils/ai-runtime', () => {
  const actual = jest.requireActual('../common/utils/ai-runtime');
  return {
    ...actual,
    // Forca resolveAiSource a entrar no ramo `aiAdapter.analyzeImage(...)`,
    // que e o ramo com o bug — sem depender de OPENAI_API_KEY real no .env.
    hasValidOpenAiKey: () => true,
  };
});

jest.mock('../../worker/outcome.sweeper', () => ({
  startOutcomeSweeper: jest.fn(),
}));

// O guard de noticias roda na conclusao e buscaria o feed real.
jest.mock('../modules/calendar/calendar.service', () => ({
  EconomicCalendarService: jest.fn().mockImplementation(() => ({
    getEventsForSymbol: jest.fn().mockResolvedValue({ events: [], degraded: false }),
  })),
}));

jest.mock('../modules/ai/ai.adapter', () => {
  const actual = jest.requireActual('../modules/ai/ai.adapter');
  return {
    ...actual,
    AIAdapter: jest.fn(),
  };
});

import { AIAdapter, AIAnalysisError } from '../modules/ai/ai.adapter';
import type { StrategyProfile } from '../common/strategy/strategy-profile';

describe('worker/ai.worker.ts — propagacao de strategyProfile pela fila', () => {
  const analyzeImageMock = jest.fn().mockRejectedValue(new Error('stop-after-capture'));


  beforeAll(() => {
    (AIAdapter as unknown as jest.Mock).mockImplementation(() => ({
      analyzeImage: analyzeImageMock,
    }));
  });

  afterEach(() => {
    analyzeImageMock.mockClear();
  });

  const strategyProfile: StrategyProfile = {
    timeframes: ['1h', '4h'],
    sessions: ['london'],
    instruments: ['forex'],
    setups: ['breakout'],
    direction: 'long',
    minRiskReward: 1.8,
  };

  function makeJob(data: Record<string, unknown>) {
    return {
      id: 'job-1',
      data,
      opts: { attempts: 1 },
      attemptsMade: 0,
    } as any;
  }

  /** Recupera o processor real que o Worker do BullMQ chamaria por job. */
  function getProcessor(): (job: any) => Promise<unknown> {
    const { Worker } = require('bullmq');
    const WorkerCtor = Worker as jest.Mock;
    expect(WorkerCtor).toHaveBeenCalledTimes(1);
    const [queueName, processor] = WorkerCtor.mock.calls[0];
    expect(queueName).toBe('ai-analysis');
    return processor;
  }

  it('repassa job.data.strategyProfile para analyzeImage como 5o argumento', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();

    const job = makeJob({
      analysisId: 'analysis-1',
      imageUrl: 'https://example.com/chart.png',
      analysisType: 'quick',
      userId: 'user-1',
      isDemo: true, // evita o caminho de refund de ticks no catch
      strategyProfile,
    });

    await expect(processAnalysis(job)).rejects.toThrow('stop-after-capture');

    expect(analyzeImageMock).toHaveBeenCalledTimes(1);
    const call = analyzeImageMock.mock.calls[0];
    expect(call[0]).toBe('https://example.com/chart.png');
    expect(call[1]).toContain('TICKRIFY ANALYSIS ENGINE v11');
    expect(call[2]).toBe('quick');
    expect(call[4]).toEqual(strategyProfile);

    const prismaClient = (require('@prisma/client').PrismaClient as any).lastClient;
    expect(prismaClient.analysis.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCode: 'processing_unclassified' }),
    }));
  });

  function mockPaidRefund() {
    const prismaClient = (require('@prisma/client').PrismaClient as any).lastClient;
    const tx = {
      tickTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'refund-1' }),
      },
      userTicks: { upsert: jest.fn().mockResolvedValue({ balance: 1 }) },
    };
    prismaClient.$transaction = jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    prismaClient.analysis.update.mockClear();
    return { prismaClient, tx };
  }

  it('reembolsa o tick e preserva o codigo quando o adapter recusa um plano incoerente', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const { prismaClient, tx } = mockPaidRefund();
    analyzeImageMock.mockRejectedValueOnce(new AIAnalysisError({
      code: 'invalid_trade_plan', message: 'Inconsistent levels', retriable: false,
    }));

    await expect(processAnalysis(makeJob({
      analysisId: 'analysis-invalid-plan', imageUrl: 'https://example.com/chart.png',
      analysisType: 'quick', userId: 'user-1', isDemo: false,
    }))).rejects.toThrow('Inconsistent levels');

    expect(prismaClient.analysis.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCode: 'invalid_trade_plan' }),
    }));
    expect(tx.userTicks.upsert).toHaveBeenCalledTimes(1);
    expect(tx.tickTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'REFUND', amount: 1, metadata: { analysisId: 'analysis-invalid-plan' } }),
    }));
  });

  it.each(['quick', 'deep'] as const)('preserves non_chart_image from the adapter in the %s worker', async (analysisType) => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const { prismaClient, tx } = mockPaidRefund();
    analyzeImageMock.mockRejectedValueOnce(new AIAnalysisError({
      code: 'non_chart_image', message: 'Not a financial chart', retriable: false,
    }));
    await expect(processAnalysis(makeJob({
      analysisId: 'analysis-non-chart', imageUrl: 'https://example.com/chart.png',
      analysisType, userId: 'user-1', isDemo: false,
    }))).rejects.toThrow('Not a financial chart');
    expect(analyzeImageMock).toHaveBeenCalledTimes(1);
    expect(prismaClient.analysis.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCode: 'non_chart_image' }),
    }));
    expect(prismaClient.analysis.update.mock.calls.some(([args]: any[]) => args.data.status === 'completed')).toBe(false);
    expect(tx.userTicks.upsert).toHaveBeenCalledTimes(1);
    expect(tx.tickTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'REFUND', amount: analysisType === 'deep' ? 3 : 1 }),
    }));
  });

  it('fonte que contorna o adapter: BUY sem watchPlan vira NO_TRADE', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const prismaClient = (require('@prisma/client').PrismaClient as any).lastClient;
    prismaClient.analysis.update.mockClear();
    analyzeImageMock.mockResolvedValueOnce({
      recommendation: 'BUY', confidence: 70,
      analysis: {
        symbol: 'USDJPY', timeframe: '30m', currentPrice: 155.306,
        entry: 155.304, stopLoss: 155.286, takeProfit1: 155.316, takeProfit2: 155.334,
        trendStrength: 'strong', factorsPresent: 6,
      },
    });
    await processAnalysis(makeJob({
      analysisId: 'analysis-precision', imageUrl: 'https://example.com/chart.png',
      analysisType: 'quick', userId: 'user-1', isDemo: true,
    }));
    const completed = prismaClient.analysis.update.mock.calls.find(([args]: any[]) => args.data.status === 'completed');
    expect(completed).toBeDefined();
    expect(completed[0].data.recommendation).toBe('WAIT');
    expect(completed[0].data.result.signalState).toBe('NO_TRADE');
    expect(completed[0].data.result.analysis.entry).toBeNull();
  });

  it.each([true, false])('runs the real Deep adapter into the worker and serializer (financial chart=%s)', async (isChart) => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const { prismaClient } = mockPaidRefund();
    const { AIAdapter: RealAdapter } = jest.requireActual('../modules/ai/ai.adapter');
    const { OpenAiVisionModel } = jest.requireActual('../modules/ai/vision-model');
    const { AiService } = jest.requireActual('../modules/ai/ai.service');
    const adapter = new RealAdapter();
    // v11: plano na escala lida (100x); fundo real em 1,0765 (a invalidacao
    // encaixa); preco real 1,0792 (ATR 0,002): ENTER_NOW a mercado, stop 1,076
    // (1,0765 - 0,25 ATR), TP1 1,083 (1,19R), TP2 1,0895. Forex: 6 PASS.
    const watchPlan = { direction: 'long', triggerType: 'zone_reaction', zoneLow: 107.7, zoneHigh: 107.8, invalidation: 107.65,
      target1: 108.3, target2: 108.95, validForCandles: 16, trigger: 'Bullish close at 1.0770-1.0780' };
    const raw = { is_financial_chart: isChart, watchPlan, recommendation: 'BUY', confidence: 70, analysis: {
      symbol: 'EURUSD', timeframe: 'H1', currentPrice: 107.88, entry: 107.855, entryType: 'market', stopLoss: 107.7,
      takeProfit1: 108.02, takeProfit2: 108.12, invalidationLevel: 107.72,
      factorsPresent: 6, trendStrength: 'strong', marketStructure: { bias: 'bullish' },
      structureValidation: 'C1 PASS: 4h; C2 PASS: discount; C3 PASS: pullback; C4 PASS: buyers; C5 FAIL: retested; C6 PASS: 1 ATR; C7 PASS: room',
    } };
    const create = jest.fn().mockResolvedValue({ model: 'test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }] });
    adapter.visionModel = new OpenAiVisionModel({ chat: { completions: { create } } });
    adapter.buildMarketEnrichment = jest.fn().mockResolvedValue({
      block: 'SYNTHETIC CONTEXT', assetClass: 'forex', marketContext: 'injected', calendar: 'no_events_returned', candles: 'injected',
      stats: { v: 1, symbol: 'EURUSD', interval: '1h', coverage: 'injected', numbers: {
        lastClose: 1.0792, atr14: 0.002, swings: [{ kind: 'low', price: 1.0765 }], late: { long: false, short: false },
      } },
    });
    analyzeImageMock.mockImplementationOnce(adapter.analyzeImage.bind(adapter));
    const oldEnrichment = process.env.ENABLE_MARKET_ENRICHMENT;
    process.env.ENABLE_MARKET_ENRICHMENT = 'true';
    try {
      const pending = processAnalysis(makeJob({
        analysisId: 'analysis-deep-p1', imageUrl: 'data:image/png;base64,AA==',
        analysisType: 'deep', userId: 'user-1', isDemo: false,
      }));
      if (isChart) await pending;
      else await expect(pending).rejects.toThrow('financial chart');
      expect(create).toHaveBeenCalledTimes(1);
      expect(adapter.buildMarketEnrichment).toHaveBeenCalledTimes(1);
      const stored = prismaClient.analysis.update.mock.calls.find(([args]: any[]) => args.data.status === (isChart ? 'completed' : 'failed'))[0].data;
      // Use the real API serializer on the worker-produced record, with only I/O mocked.
      const serializer = Object.create(AiService.prototype);
      serializer.getSignedImageUrl = jest.fn().mockResolvedValue(null);
      serializer.getOutcomeById = jest.fn().mockResolvedValue(null);
      const delivered = await serializer.serializeAnalysis({
        id: 'analysis-deep-p1', ...JSON.parse(JSON.stringify(stored)),
        ...(isChart ? {} : { result: null }), createdAt: new Date(), updatedAt: new Date(),
      });
      if (isChart) {
        const engine = { entry: 1.0792, stopLoss: 1.076, takeProfit1: 1.083, takeProfit2: 1.0895 };
        for (const key of ['entry', 'stopLoss', 'takeProfit1', 'takeProfit2'] as const) {
          expect(stored.result.analysis[key]).toBeCloseTo(engine[key], 8);
          expect(delivered[key]).toBe(stored.result.analysis[key]);
        }
        expect(stored.result.engine.contract).toMatchObject({ no_trade_reason: null, no_trade_reason_code: null, no_trade_reason_params: {} });
        expect(JSON.parse(JSON.stringify(stored.result)).displayMessages).toEqual({});
        expect(stored.result.analysis.invalidationLevel).toBe(107.72 * 0.01);
        expect(delivered).toMatchObject({ recommendation: 'BUY', riskRewardTp1: 1.19, riskRewardTp2: 3.22, errorCode: null });
      } else {
        expect(prismaClient.analysis.update.mock.calls.some(([args]: any[]) => args.data.status === 'completed')).toBe(false);
        expect(delivered).toMatchObject({ status: 'failed', errorCode: 'non_chart_image', entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null });
      }
    } finally {
      if (oldEnrichment === undefined) delete process.env.ENABLE_MARKET_ENRICHMENT;
      else process.env.ENABLE_MARKET_ENRICHMENT = oldEnrichment;
    }
  });

  it('NO_TRADE com velas reais: o worker grava result.levelMap e a API entrega (caminho da fila)', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const { prismaClient } = mockPaidRefund();
    const { AIAdapter: RealAdapter } = jest.requireActual('../modules/ai/ai.adapter');
    const { OpenAiVisionModel } = jest.requireActual('../modules/ai/vision-model');
    const { AiService } = jest.requireActual('../modules/ai/ai.service');
    const adapter = new RealAdapter();
    // O modelo pede WATCH e a invalidacao fica longe de qualquer swing: o validador recusa.
    const watchPlan = { direction: 'long', triggerType: 'zone_reaction', zoneLow: 98, zoneHigh: 99, invalidation: 80, target1: 110, target2: null, validForCandles: 12, trigger: 'Reaction at 98.' };
    // Ativo sem faixa de preco conhecida: o preco 100 nao passa pela correcao de ordem de grandeza.
    const raw = { is_financial_chart: true, signalState: 'WATCH', watchPlan, recommendation: 'HOLD', confidence: 40, analysis: {
      symbol: 'ABCUSDT', timeframe: '1h', currentPrice: 100, entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null,
      factorsPresent: 2, trendStrength: 'weak', marketStructure: { bias: 'neutral' },
    } };
    const create = jest.fn().mockResolvedValue({ model: 'test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }] });
    adapter.visionModel = new OpenAiVisionModel({ chat: { completions: { create } } });
    adapter.buildMarketEnrichment = jest.fn().mockResolvedValue({
      block: 'SYNTHETIC CONTEXT', assetClass: 'crypto', marketContext: 'injected', calendar: 'no_events_returned', candles: 'injected',
      stats: { v: 1, symbol: 'BTCUSDT', interval: '1h', coverage: 'injected', numbers: {
        lastClose: 100, atr14: 2, windowHigh: 112, windowLow: 90, swingHighs: [], swingLows: [],
        swings: [{ kind: 'high', price: 104 }, { kind: 'high', price: 108 }, { kind: 'low', price: 97 }, { kind: 'low', price: 94 }],
        late: { long: false, short: false },
      } },
    });
    analyzeImageMock.mockImplementationOnce(adapter.analyzeImage.bind(adapter));
    const oldEnrichment = process.env.ENABLE_MARKET_ENRICHMENT;
    process.env.ENABLE_MARKET_ENRICHMENT = 'true';
    try {
      await processAnalysis(makeJob({
        analysisId: 'analysis-level-map', imageUrl: 'data:image/png;base64,AA==',
        analysisType: 'deep', userId: 'user-1', isDemo: false,
      }));
      const stored = prismaClient.analysis.update.mock.calls.find(([args]: any[]) => args.data.status === 'completed')[0].data;
      expect(stored.result.signalState).toBe('NO_TRADE');
      expect(stored.result.dataMode).toBe('real_data');
      expect(stored.result.levelMap).toEqual({
        price: 100, atr: 2,
        above: { level: 104, atr: 2, next: 108, nextAtr: 4 },
        below: { level: 97, atr: 1.5, next: 94, nextAtr: 3 },
      });
      const serializer = Object.create(AiService.prototype);
      serializer.getSignedImageUrl = jest.fn().mockResolvedValue(null);
      serializer.getOutcomeById = jest.fn().mockResolvedValue(null);
      const delivered = await serializer.serializeAnalysis({
        id: 'analysis-level-map', ...JSON.parse(JSON.stringify(stored)), createdAt: new Date(), updatedAt: new Date(),
      });
      expect(delivered.fullResponse.levelMap).toEqual(stored.result.levelMap);
      expect(stored.result.aiLevel).toMatchObject({ price: 99 });
      expect(delivered.fullResponse.aiLevel).toEqual(stored.result.aiLevel);
      expect(stored.result.rejectedPlan).toMatchObject({ modelState: 'WATCH', reason: 'invalidation_unsnapped', plan: { zoneLow: 98, invalidation: 80 } });
    } finally {
      if (oldEnrichment === undefined) delete process.env.ENABLE_MARKET_ENRICHMENT;
      else process.env.ENABLE_MARKET_ENRICHMENT = oldEnrichment;
    }
  });

  describe('reanalise com o preco na zona do WATCH (ENGINE_ENTER_AT_LEVEL)', () => {
    const plan = { direction: 'long', triggerType: 'zone_reaction', zoneLow: 98, zoneHigh: 99, invalidation: 97, target1: 104, target2: null, validForCandles: 12, trigger: 'Reaction at 98.' };
    const passes = [1, 2, 3, 4, 5, 6, 7].map((n) => `C${n} PASS: 98.5`).join('; ');
    const run = async (id: string, flag: 'true' | 'false', late: boolean) => {
      const processAnalysis = (require('../../worker/ai.worker'), getProcessor());
      const { prismaClient } = mockPaidRefund();
      const { AIAdapter: RealAdapter } = jest.requireActual('../modules/ai/ai.adapter');
      const { OpenAiVisionModel } = jest.requireActual('../modules/ai/vision-model');
      const adapter = new RealAdapter();
      const raw = { is_financial_chart: true, signalState: 'WATCH', watchPlan: plan, recommendation: 'HOLD', confidence: 50, analysis: {
        symbol: 'ABCUSDT', timeframe: '1h', currentPrice: 98.5, entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null,
        factorsPresent: 7, trendStrength: 'strong', marketStructure: { bias: 'bullish' }, structureValidation: passes,
        executiveSummary: 'Price is back at the zone.\nPRIOR_PLAN_STATUS: CONFIRMED',
      } };
      adapter.visionModel = new OpenAiVisionModel({ chat: { completions: { create: jest.fn().mockResolvedValue({ model: 'test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }] }) } } });
      adapter.buildMarketEnrichment = jest.fn().mockResolvedValue({
        block: 'SYNTHETIC CONTEXT', assetClass: 'crypto', marketContext: 'injected', calendar: 'no_events_returned', candles: 'injected',
        stats: { v: 1, symbol: 'BTCUSDT', interval: '1h', coverage: 'injected', numbers: {
          lastClose: 98.5, atr14: 2, windowHigh: 112, windowLow: 90, swingHighs: [], swingLows: [],
          swings: [{ kind: 'high', price: 104 }, { kind: 'low', price: 97 }], late: { long: late, short: false },
        } },
      });
      const priorPlan = { setupId: 's1', priorAnalysisId: 'a0', symbol: 'BTCUSDT', createdAt: new Date('2026-11-09T10:00:00Z'), plan, alert: null };
      analyzeImageMock.mockImplementationOnce((...args: any[]) => { args[5] = { ...args[5], priorPlan }; return adapter.analyzeImage(...args); });
      const saved = { flag: process.env.ENGINE_ENTER_AT_LEVEL, enrichment: process.env.ENABLE_MARKET_ENRICHMENT };
      process.env.ENGINE_ENTER_AT_LEVEL = flag;
      process.env.ENABLE_MARKET_ENRICHMENT = 'true';
      try {
        await processAnalysis(makeJob({ analysisId: id, imageUrl: 'data:image/png;base64,AA==', analysisType: 'deep', userId: 'user-1', isDemo: false }));
      } finally {
        for (const [key, value] of [['ENGINE_ENTER_AT_LEVEL', saved.flag], ['ENABLE_MARKET_ENRICHMENT', saved.enrichment]] as const) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
      const updates = prismaClient.analysis.update.mock.calls.map(([args]: any[]) => args.data);
      return updates.find((d: any) => d.status === 'completed' || d.status === 'failed');
    };

    it('ligada: movimento atrasado vira ENTER_NOW gravado', async () => {
      const stored = await run('at-level-on', 'true', true);
      expect(stored.status).toBe('completed');
      expect(stored.result).toMatchObject({ signalState: 'ENTER_NOW', enterAtLevel: true });
      expect(stored.result.analysis).toMatchObject({ entry: 98.5, takeProfit2: null });
    });

    it('desligada: o atrasado segura em WATCH, como hoje', async () => {
      const stored = await run('at-level-off', 'false', true);
      expect(stored.status).toBe('completed');
      expect(stored.result.signalState).toBe('WATCH');
      expect(stored.result.enterAtLevel).toBeUndefined();
    });

    it('ENTER_NOW sem TP2 e gravado com a chave desligada (antes falhava com validation_failed)', async () => {
      const stored = await run('no-tp2-off', 'false', false);
      expect(stored.status).toBe('completed');
      expect(stored.result.signalState).toBe('ENTER_NOW');
      expect(stored.result.enterAtLevel).toBeUndefined();
      expect(stored.result.analysis).toMatchObject({ entry: 98.5, takeProfit2: null });
    });
  });

  it('persists the same safe fallback as synchronous processing after the final retry', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const { prismaClient } = mockPaidRefund();
    analyzeImageMock.mockRejectedValueOnce(new Error('private diagnostic'));
    const job = makeJob({ analysisId: 'safe-failure', imageUrl: 'https://example.com/chart.png', analysisType: 'quick', userId: 'user-1', isDemo: true });
    job.opts = { attempts: 1 };
    job.attemptsMade = 0;
    await expect(processAnalysis(job)).rejects.toThrow('private diagnostic');
    const saved = prismaClient.analysis.update.mock.calls.find(([args]: any[]) => args.data.status === 'failed')[0].data;
    expect(JSON.parse(JSON.stringify(saved))).toMatchObject({
      errorCode: 'processing_unclassified', errorMessage: 'Analysis failed. Please try again.', reasoning: 'Analysis failed. Please try again.',
    });
    expect(JSON.stringify(saved)).not.toContain('private diagnostic');
  });

  it('reembolsa uma analise paga rejeitada pela validacao final do worker', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const { prismaClient, tx } = mockPaidRefund();
    analyzeImageMock.mockResolvedValueOnce({
      recommendation: 'WAIT', confidence: 50,
      analysis: { symbol: 'TEST', timeframe: '30m', currentPrice: 0 },
    });

    await processAnalysis(makeJob({
      analysisId: 'analysis-validation-failed', imageUrl: 'https://example.com/chart.png',
      analysisType: 'quick', userId: 'user-1', isDemo: false,
    }));

    expect(prismaClient.analysis.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCode: 'validation_failed',
        result: { displayMessages: { validationErrors: [{ code: 'validation_invalid_value', params: { field: 'currentPrice', value: '0' }, text: 'currentPrice inválido: 0' }] } },
      }),
    }));
    expect(tx.userTicks.upsert).toHaveBeenCalledTimes(1);
    expect(tx.tickTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'REFUND', amount: 1, metadata: { analysisId: 'analysis-validation-failed' } }),
    }));
  });

  it('recusa niveis contraditorios mesmo se a fonte alternativa contornar o adapter', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const { prismaClient, tx } = mockPaidRefund();
    analyzeImageMock.mockResolvedValueOnce({
      recommendation: 'BUY', confidence: 75,
      analysis: {
        symbol: 'TEST', timeframe: '30m', currentPrice: 100,
        entry: 100, stopLoss: 95, takeProfit1: 90, takeProfit2: 120,
      },
    });

    await expect(processAnalysis(makeJob({
      analysisId: 'analysis-worker-invalid-plan', imageUrl: 'https://example.com/chart.png',
      analysisType: 'quick', userId: 'user-1', isDemo: false,
    }))).rejects.toThrow('níveis incoerentes');

    expect(prismaClient.analysis.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCode: 'invalid_trade_plan' }),
    }));
    expect(tx.tickTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'REFUND', amount: 1, metadata: { analysisId: 'analysis-worker-invalid-plan' } }),
    }));
  });

  it('reembolsa tres ticks no deep e nao duplica um reembolso ja registrado', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const { tx } = mockPaidRefund();
    analyzeImageMock.mockRejectedValueOnce(new AIAnalysisError({
      code: 'invalid_trade_plan', message: 'Inconsistent levels', retriable: false,
    }));

    await expect(processAnalysis(makeJob({
      analysisId: 'analysis-deep-invalid', imageUrl: 'https://example.com/chart.png',
      analysisType: 'deep', userId: 'user-1', isDemo: false,
    }))).rejects.toThrow('Inconsistent levels');
    expect(tx.tickTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'REFUND', amount: 3, metadata: { analysisId: 'analysis-deep-invalid' } }),
    }));

    tx.tickTransaction.findFirst.mockResolvedValue({ id: 'refund-1' });
    analyzeImageMock.mockRejectedValueOnce(new AIAnalysisError({
      code: 'invalid_trade_plan', message: 'Inconsistent levels', retriable: false,
    }));
    await expect(processAnalysis(makeJob({
      analysisId: 'analysis-deep-invalid', imageUrl: 'https://example.com/chart.png',
      analysisType: 'deep', userId: 'user-1', isDemo: false,
    }))).rejects.toThrow('Inconsistent levels');
    expect(tx.userTicks.upsert).toHaveBeenCalledTimes(1);
    expect(tx.tickTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('nao publica R:R escrito pelo modelo em uma resposta WAIT concluida', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const prismaClient = (require('@prisma/client').PrismaClient as any).lastClient;
    prismaClient.analysis.update.mockClear();
    analyzeImageMock.mockResolvedValueOnce({
      recommendation: 'WAIT', confidence: 50,
      analysis: {
        symbol: 'TEST', timeframe: '30m', currentPrice: 100,
        entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120,
        riskRewardRatio: '1:99',
      },
    });

    await processAnalysis(makeJob({
      analysisId: 'analysis-wait-rr', imageUrl: 'https://example.com/chart.png',
      analysisType: 'quick', userId: 'user-1', isDemo: false,
    }));

    const completed = prismaClient.analysis.update.mock.calls.find(
      ([args]: any[]) => args.data.status === 'completed',
    );
    expect(completed).toBeDefined();
    expect(completed[0].data.result.analysis).toEqual(expect.objectContaining({
      riskRewardRatio: null, riskRewardTp1: null, riskRewardTp2: null,
      probabilityTp1: null, probabilityTp2: null, probabilityStop: null,
    }));
  });

  it('validador: alvo absurdo vira NO_TRADE, stop antes da invalidacao so marca, e grava o contrato v3 com os tempos', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const prismaClient = (require('@prisma/client').PrismaClient as any).lastClient;
    prismaClient.analysis.update.mockClear();
    analyzeImageMock.mockResolvedValueOnce({
      recommendation: 'BUY', confidence: 70,
      analysis: {
        symbol: 'TEST', timeframe: '30m', currentPrice: 100,
        entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 1200,
        invalidationLevel: 94, executiveSummary: 'Buyers defend 95.',
        trendStrength: 'strong', factorsPresent: 6,
      },
      engineMeta: { validatorAction: 'downgraded', validatorReasons: ['stop_inside_invalidation'], groundingMs: 5, modelMs: 900, parseMs: 2, validationMs: 1 },
    });

    process.env.PROMPT_VARIANT_B_PERCENT = '100';
    await processAnalysis(makeJob({
      analysisId: 'analysis-validator', imageUrl: 'https://example.com/chart.png',
      analysisType: 'quick', userId: 'user-1', isDemo: false,
      intake: { receivedAt: Date.now() - 2_000, imagePrepMs: 150, intakeMs: 400 },
    }));

    const completed = prismaClient.analysis.update.mock.calls.find(
      ([args]: any[]) => args.data.status === 'completed',
    );
    expect(completed).toBeDefined();
    expect(completed[0].data.recommendation).toBe('WAIT');
    delete process.env.PROMPT_VARIANT_B_PERCENT;
    const engine = JSON.parse(JSON.stringify(completed[0].data.result)).engine;
    expect(engine.prompt_variant).toBe('B');
    expect(engine).toMatchObject({
      version: '4.0.0',
      data_mode: 'print',
      validator_action: 'downgraded',
      validator_reasons: ['implausible_price'],
      validator_flags: ['stop_inside_invalidation'],
      timings: { image_prep_ms: 150, intake_ms: 400, grounding_ms: 5, model_ms: 900 },
      contract: {
        verdict: 'NEUTRAL', asset: 'TEST', timeframe: '30m', entry: null, targets: [],
        no_trade_reason: 'A price level is outside a plausible range of the chart price.',
        no_trade_reason_code: 'engine_implausible_price', no_trade_reason_params: {},
      },
    });
    expect(engine.timings.server_total_ms).toBeGreaterThanOrEqual(2_000);
    expect(engine.timings.validation_ms).toBeGreaterThanOrEqual(0);
  });

  // Setup acompanhado (12/10/2026): a FILA e o caminho real. O vinculo foi
  // gravado na criacao; aqui so pode registrar a versao depois de gravar a
  // analise concluida, sem reescrever o setupId e sem mandar nada ao motor.
  it('versao de setup: registra depois de concluir, sem setupId no update nem no motor', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const prismaClient = (require('@prisma/client').PrismaClient as any).lastClient;
    prismaClient.analysis.update.mockClear();
    const calls = (globalThis as any).__prismaCalls as Array<{ path: string; args: unknown[] }>;
    calls.length = 0;
    analyzeImageMock.mockResolvedValueOnce({
      recommendation: 'WAIT', confidence: 40,
      analysis: { symbol: 'EURUSD', timeframe: '1H', currentPrice: 1.09, entryCondition: 'Close above 1.0950' },
    });

    await processAnalysis(makeJob({
      analysisId: 'analysis-setup-2', imageUrl: 'https://example.com/chart.png',
      analysisType: 'quick', userId: 'user-1', isDemo: true,
      setupId: 'setup-123456',
    }));
    await new Promise((resolve) => setImmediate(resolve));

    const completed = prismaClient.analysis.update.mock.calls.find(([args]: any[]) => args.data.status === 'completed');
    expect(completed).toBeDefined();
    expect(completed[0].data).not.toHaveProperty('setupId');
    // O motor nao recebe nada do setup: os 5 argumentos de sempre + a opcao de comparacao.
    expect(analyzeImageMock.mock.calls[0]).toHaveLength(6);
    expect(analyzeImageMock.mock.calls[0][5]).toEqual({ compareProviders: true });
    const versionQuery = calls.find((c) => c.path === '$queryRaw' && (c.args[1] === 'setup-123456' || (c.args as unknown[]).includes('setup-123456')));
    expect(versionQuery).toBeDefined();
  });

  // Telemetria (12/10/2026): a FILA e o caminho real; o teste confere o que e
  // GRAVADO, por SQL e fora do `result` que a tela le.
  it('telemetria: grava o modelo que respondeu e os numeros do grounding depois de concluir', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const prismaClient = (require('@prisma/client').PrismaClient as any).lastClient;
    prismaClient.analysis.update.mockClear();
    const calls = (globalThis as any).__prismaCalls as Array<{ path: string; args: unknown[] }>;
    calls.length = 0;
    const groundingStats = {
      v: 1, symbol: 'XAUUSD', interval: '15m', coverage: 'injected',
      numbers: { candles: 120, atr14: 6.5, swingHighs: [], swingLows: [] },
    };
    analyzeImageMock.mockResolvedValueOnce({
      recommendation: 'WAIT', confidence: 40,
      analysis: { symbol: 'XAUUSD', timeframe: '15m', currentPrice: 4150 },
      respondedModel: 'gpt-5.6-luna-2026-09-01',
      groundingStats,
    });

    await processAnalysis(makeJob({
      analysisId: 'analysis-telemetry', imageUrl: 'https://example.com/chart.png',
      analysisType: 'quick', userId: 'user-1', isDemo: false,
    }));

    const completed = prismaClient.analysis.update.mock.calls.find(([args]: any[]) => args.data.status === 'completed');
    expect(completed).toBeDefined();
    expect(completed[0].data.result).not.toHaveProperty('respondedModel');
    expect(completed[0].data.result).not.toHaveProperty('groundingStats');
    const write = calls.find((c) => c.path === '$executeRaw' && c.args.includes('analysis-telemetry'));
    expect(write).toBeDefined();
    expect(write!.args.slice(1)).toEqual(['gpt-5.6-luna-2026-09-01', JSON.stringify(groundingStats), 'analysis-telemetry']);
  });

  it('sem setup: nenhuma consulta de setup depois de concluir', async () => {
    require('../../worker/ai.worker');
    const processAnalysis = getProcessor();
    const calls = (globalThis as any).__prismaCalls as Array<{ path: string; args: unknown[] }>;
    calls.length = 0;
    analyzeImageMock.mockResolvedValueOnce({
      recommendation: 'WAIT', confidence: 40,
      analysis: { symbol: 'EURUSD', timeframe: '1H', currentPrice: 1.09 },
    });
    await processAnalysis(makeJob({
      analysisId: 'analysis-plain', imageUrl: 'https://example.com/chart.png',
      analysisType: 'quick', userId: 'user-1', isDemo: false,
    }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls.some((c) => c.path === '$queryRaw' && (c.args as unknown[]).includes('setup-123456'))).toBe(false);
  });

  // Segundo bug do mesmo recurso (24/09/2026): o perfil chegava a IA, a IA
  // devolvia o selo, e o worker o descartava ao montar o resultado salvo. O
  // teste acima passava; nenhum conferia o que era GRAVADO.
  it('grava o selo validado (strategyFit) no resultado salvo da analise', async () => {
    const prismaClient = (require('@prisma/client').PrismaClient as any).lastClient;
    prismaClient.analysis.update.mockClear();
    analyzeImageMock.mockResolvedValueOnce({
      recommendation: 'WAIT',
      confidence: 42,
      rawResponse: {
        is_financial_chart: true,
        recommendation: 'HOLD',
        confidence: 42,
        analysis: {
          symbol: 'EURUSD',
          timeframe: '1H',
          currentPrice: 1.08,
          reasoning: 'Range, no trigger.',
          marketStructure: { bias: 'neutral' },
        },
      },
      rawContent: '{}',
      strategyFit: 'poor',
      strategyFitReason: 'Range setup; the profile trades breakouts.',
      evidence: {
        version: 1, additionalChartsDelivered: 0, candleFeedAttached: false,
        marketContextAttached: false, calendar: 'not_confirmed',
      },
    });

    const processAnalysis = getProcessor();
    await processAnalysis(
      makeJob({
        analysisId: 'analysis-2',
        imageUrl: 'https://example.com/chart.png',
        analysisType: 'quick',
        userId: 'user-1',
        isDemo: false,
        strategyProfile,
      }),
    );

    const saved = prismaClient.analysis.update.mock.calls.find(
      ([args]: any[]) => args.data.status === 'completed',
    );
    expect(saved).toBeDefined();
    expect(saved![0].data.result).toMatchObject({
      strategyFit: 'poor',
      strategyFitReason: 'Range setup; the profile trades breakouts.',
      evidence: { version: 1, additionalChartsDelivered: 0 },
    });
    // TRAVA 1: o selo nunca muda a recomendacao.
    expect(saved![0].data.recommendation).toBe('WAIT');
  });

  // D3 (19/10/2026): caracterizacao do preco atual no worker. Nao muda regra nenhuma.
  describe('currentPrice no worker (caracterizacao)', () => {
    function runWith(analysisId: string, recommendation: string, analysis: Record<string, unknown>) {
      require('../../worker/ai.worker');
      const processAnalysis = getProcessor();
      const prismaClient = (require('@prisma/client').PrismaClient as any).lastClient;
      prismaClient.analysis.update.mockClear();
      analyzeImageMock.mockResolvedValueOnce({ recommendation, confidence: 50, analysis });
      return { prismaClient, run: () => processAnalysis(makeJob({
        analysisId, imageUrl: 'https://example.com/chart.png',
        analysisType: 'quick', userId: 'user-1', isDemo: true,
      })) };
    }
    const failedUpdate = (prismaClient: any) =>
      prismaClient.analysis.update.mock.calls.find(([args]: any[]) => args.data.status === 'failed');

    it.each([
      ['0', 0],
      ['null', null],
      ['ausente', undefined],
      ['string vazia', ''],
      ['texto nao numerico', 'abc'],
    ] as const)('preco %s chega ao worker, vira 0 e falha a validacao final, mesmo num WAIT', async (_name, price) => {
      const analysis: Record<string, unknown> = { symbol: 'TEST', timeframe: '30m' };
      if (price !== undefined) analysis.currentPrice = price;
      const { prismaClient, run } = runWith('analysis-price', 'WAIT', analysis);
      await run();
      const failed = failedUpdate(prismaClient);
      expect(failed).toBeDefined();
      expect(failed[0].data).toMatchObject({
        status: 'failed',
        errorCode: 'validation_failed',
        errorMessage: 'Validação falhou: currentPrice inválido: 0',
      });
    });

    it('BUY com niveis coerentes e preco 0: falha so pelo preco (o validador do plano nao checa a faixa sem preco)', async () => {
      const { prismaClient, run } = runWith('analysis-buy-price-zero', 'BUY', {
        symbol: 'TEST', timeframe: '30m', currentPrice: 0,
        entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120,
      });
      await run();
      expect(failedUpdate(prismaClient)[0].data.errorMessage).toBe('Validação falhou: currentPrice inválido: 0');
    });

    it('WAIT com preco valido conclui normalmente', async () => {
      const { prismaClient, run } = runWith('analysis-wait-price-ok', 'WAIT', {
        symbol: 'TEST', timeframe: '30m', currentPrice: 123.45,
      });
      await run();
      expect(failedUpdate(prismaClient)).toBeUndefined();
      const completed = prismaClient.analysis.update.mock.calls.find(([args]: any[]) => args.data.status === 'completed');
      expect(completed[0].data.result.analysis.currentPrice).toBe(123.45);
    });
  });
});
