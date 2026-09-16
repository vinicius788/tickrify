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
  function createAutoMock(): any {
    const target: any = function autoMockFn() {
      return Promise.resolve(undefined);
    };
    return new Proxy(target, {
      get(obj, prop) {
        if (prop === 'then') return undefined; // nunca parece um thenable
        if (prop in obj) return obj[prop];
        return createAutoMock();
      },
    });
  }

  class MockPrismaClient {
    constructor(..._args: unknown[]) {
      return createAutoMock();
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

jest.mock('../modules/ai/ai.adapter', () => {
  const actual = jest.requireActual('../modules/ai/ai.adapter');
  return {
    ...actual,
    AIAdapter: jest.fn(),
  };
});

import { AIAdapter } from '../modules/ai/ai.adapter';
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
  });
});
