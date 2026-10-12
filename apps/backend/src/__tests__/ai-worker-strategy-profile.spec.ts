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
      promptOverride: 'PROMPT DE TESTE', // evita bater no prisma.promptConfig
      analysisType: 'quick',
      userId: 'user-1',
      isDemo: true, // evita o caminho de refund de ticks no catch
      strategyProfile,
    });

    await expect(processAnalysis(job)).rejects.toThrow('stop-after-capture');

    expect(analyzeImageMock).toHaveBeenCalledTimes(1);
    const call = analyzeImageMock.mock.calls[0];
    expect(call[0]).toBe('https://example.com/chart.png');
    expect(call[1]).toBe('PROMPT DE TESTE');
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
      promptOverride: 'PROMPT DE TESTE', analysisType: 'quick', userId: 'user-1', isDemo: false,
    }))).rejects.toThrow('Inconsistent levels');

    expect(prismaClient.analysis.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCode: 'invalid_trade_plan' }),
    }));
    expect(tx.userTicks.upsert).toHaveBeenCalledTimes(1);
    expect(tx.tickTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'REFUND', amount: 1, metadata: { analysisId: 'analysis-invalid-plan' } }),
    }));
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
      promptOverride: 'PROMPT DE TESTE', analysisType: 'quick', userId: 'user-1', isDemo: false,
    }));

    expect(prismaClient.analysis.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCode: 'validation_failed' }),
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
      promptOverride: 'PROMPT DE TESTE', analysisType: 'quick', userId: 'user-1', isDemo: false,
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
      promptOverride: 'PROMPT DE TESTE', analysisType: 'deep', userId: 'user-1', isDemo: false,
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
      promptOverride: 'PROMPT DE TESTE', analysisType: 'deep', userId: 'user-1', isDemo: false,
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
      promptOverride: 'PROMPT DE TESTE', analysisType: 'quick', userId: 'user-1', isDemo: false,
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
      promptOverride: 'PROMPT DE TESTE', analysisType: 'quick', userId: 'user-1', isDemo: true,
      setupId: 'setup-123456',
    }));
    await new Promise((resolve) => setImmediate(resolve));

    const completed = prismaClient.analysis.update.mock.calls.find(([args]: any[]) => args.data.status === 'completed');
    expect(completed).toBeDefined();
    expect(completed[0].data).not.toHaveProperty('setupId');
    expect(analyzeImageMock.mock.calls[0]).toHaveLength(5);
    const versionQuery = calls.find((c) => c.path === '$queryRaw' && (c.args[1] === 'setup-123456' || (c.args as unknown[]).includes('setup-123456')));
    expect(versionQuery).toBeDefined();
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
      promptOverride: 'PROMPT DE TESTE', analysisType: 'quick', userId: 'user-1', isDemo: false,
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
        promptOverride: 'PROMPT DE TESTE',
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
});
