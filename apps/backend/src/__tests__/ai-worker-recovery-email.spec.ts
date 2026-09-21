/**
 * O e-mail de recuperacao precisa sair pelo WORKER, que e o caminho de
 * producao (RUN_EMBEDDED_WORKER=true). Ate 21/09/2026 so o AiService (fallback
 * sem fila) chamava, entao em producao ninguem recebia o e-mail ao terminar a
 * terceira analise gratis. Este teste roda um job ate o fim (analise demo, sem
 * OpenAI) e confere que a checagem e feita so para analise gratis.
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
      return createAutoMock();
    }
  }
  return { PrismaClient: MockPrismaClient, Prisma: { DbNull: 'DbNull', JsonNull: 'JsonNull' } };
});

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class MockPrismaPg {
    constructor(..._args: unknown[]) {}
  },
}));

jest.mock('../modules/database/prisma.datasource', () => ({
  resolvePrismaDatasourceUrl: () => 'postgres://mock-datasource',
}));

jest.mock('../common/flags/feature-flags', () => ({
  ...jest.requireActual('../common/flags/feature-flags'),
  startFlagRefresh: jest.fn(),
}));

jest.mock('../common/utils/ai-runtime', () => ({
  ...jest.requireActual('../common/utils/ai-runtime'),
  hasValidOpenAiKey: () => false,
  canUseDemoFallback: () => true,
}));

jest.mock('../../worker/outcome.sweeper', () => ({ startOutcomeSweeper: jest.fn() }));

jest.mock('../modules/ai/ai.adapter', () => ({
  ...jest.requireActual('../modules/ai/ai.adapter'),
  AIAdapter: jest.fn().mockImplementation(() => ({})),
}));

// O guard de noticias roda em toda analise e buscaria o feed real.
jest.mock('../modules/calendar/calendar.service', () => ({
  EconomicCalendarService: jest.fn().mockImplementation(() => ({
    getEventsForSymbol: jest.fn().mockResolvedValue({ events: [], degraded: false }),
  })),
}));

jest.mock('../common/analytics/free-funnel', () => ({
  ...jest.requireActual('../common/analytics/free-funnel'),
  trackFreeAnalysisCompleted: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../modules/mail/recovery-email', () => ({
  notifyIfFreeQuotaExhausted: jest.fn().mockResolvedValue(undefined),
}));

import { notifyIfFreeQuotaExhausted } from '../modules/mail/recovery-email';

describe('worker/ai.worker.ts: e-mail de recuperacao ao concluir analise gratis', () => {
  const notify = notifyIfFreeQuotaExhausted as jest.Mock;

  function getProcessor(): (job: any) => Promise<unknown> {
    require('../../worker/ai.worker');
    const { Worker } = require('bullmq');
    return (Worker as jest.Mock).mock.calls[0][1];
  }

  function job(isDemo: boolean) {
    return {
      id: 'job-1',
      data: {
        analysisId: 'analysis-1',
        imageUrl: 'https://example.com/chart.png',
        promptOverride: 'PROMPT DE TESTE',
        analysisType: 'quick',
        userId: 'user-1',
        isDemo,
      },
      opts: { attempts: 1 },
      attemptsMade: 0,
    } as any;
  }

  afterEach(() => notify.mockClear());

  it('analise gratis concluida: checa a cota e dispara pelo caminho compartilhado', async () => {
    const processAnalysis = getProcessor();
    await processAnalysis(job(true));

    expect(notify).toHaveBeenCalledTimes(1);
    const [deps, userId] = notify.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(typeof deps.hasPaidAccess).toBe('function');
    expect(typeof deps.mail.sendRecovery).toBe('function');
  });

  it('analise de assinante: nunca checa nem envia', async () => {
    const processAnalysis = getProcessor();
    await processAnalysis(job(false));

    expect(notify).not.toHaveBeenCalled();
  });
});
