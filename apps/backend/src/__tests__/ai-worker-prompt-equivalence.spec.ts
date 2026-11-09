/**
 * Montador unico (26/10/2026): o WORKER entrega ao adapter exatamente o que
 * `buildAnalysisPrompt` monta, o mesmo montador do caminho sincrono, do /try
 * e dos scripts de medicao.
 *
 * Roda o processor real do BullMQ (capturado do construtor mockado de
 * `Worker`), com Prisma e adapter simulados, e confere:
 *   - o prompt (2o argumento de analyzeImage) contra o montador;
 *   - os outros argumentos de analyzeImage (imagem, tipo, HTFs, perfil, opcoes);
 *   - que o worker NUNCA le PromptConfig: o prompt e sempre o do codigo.
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
      // O worker nao pode consultar: o teste confere que ninguem chama.
      client.promptConfig = { findUnique: jest.fn(), findFirst: jest.fn() };
      (globalThis as any).__promptConfig = client.promptConfig;
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
  return { ...actual, startFlagRefresh: jest.fn() };
});

jest.mock('../common/utils/ai-runtime', () => {
  const actual = jest.requireActual('../common/utils/ai-runtime');
  return { ...actual, hasValidOpenAiKey: () => true };
});

jest.mock('../../worker/outcome.sweeper', () => ({
  startOutcomeSweeper: jest.fn(),
}));

jest.mock('../modules/calendar/calendar.service', () => ({
  EconomicCalendarService: jest.fn().mockImplementation(() => ({
    getEventsForSymbol: jest.fn().mockResolvedValue({ events: [], degraded: false }),
  })),
}));

jest.mock('../modules/ai/ai.adapter', () => {
  const actual = jest.requireActual('../modules/ai/ai.adapter');
  return { ...actual, AIAdapter: jest.fn() };
});

import { AIAdapter } from '../modules/ai/ai.adapter';
import { TRADING_SYSTEM_PROMPT } from '../common/prompts/trading-system-prompt';
import { buildAnalysisPrompt } from '../modules/prompt/prompt-builder.service';
import type { StrategyProfile } from '../common/strategy/strategy-profile';

const languages: Array<string | undefined> = ['pt', 'en', 'es', 'fr', 'de', 'ja', undefined, 'xx', 'PT', ''];
const analysisTypes: Array<string | undefined> = ['quick', 'deep', undefined, 'other'];

/** O que o montador unico devolve para a mesma entrada. */
function expectedPrompt(userLanguage: string | undefined, analysisType: string | undefined): string {
  return buildAnalysisPrompt({ userLanguage, analysisType: analysisType === 'deep' ? 'deep' : 'quick' });
}

describe('worker/ai.worker.ts: prompt e argumentos entregues ao adapter (montador unico)', () => {
  const analyzeImageMock = jest.fn();

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (AIAdapter as unknown as jest.Mock).mockImplementation(() => ({ analyzeImage: analyzeImageMock }));
    require('../../worker/ai.worker');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  function getProcessor(): (job: any) => Promise<unknown> {
    const { Worker } = require('bullmq');
    const [queueName, processor] = (Worker as jest.Mock).mock.calls[0];
    expect(queueName).toBe('ai-analysis');
    return processor;
  }

  async function run(data: Record<string, unknown>) {
    const promptConfig = (globalThis as any).__promptConfig;
    promptConfig.findUnique.mockReset();
    promptConfig.findFirst.mockReset();
    analyzeImageMock.mockReset().mockRejectedValue(new Error('stop-after-capture'));

    await expect(getProcessor()({ id: 'job-1', data, opts: { attempts: 1 }, attemptsMade: 0 })).rejects.toThrow(
      'stop-after-capture',
    );

    expect(analyzeImageMock).toHaveBeenCalledTimes(1);
    expect(promptConfig.findUnique).not.toHaveBeenCalled();
    expect(promptConfig.findFirst).not.toHaveBeenCalled();
    return { args: analyzeImageMock.mock.calls[0] as unknown[] };
  }

  const cases = languages.flatMap((userLanguage) => analysisTypes.map((analysisType) => ({ userLanguage, analysisType })));

  it(`entrega o prompt do montador unico nos ${cases.length} casos, sem ler o banco`, async () => {
    for (const { userLanguage, analysisType } of cases) {
      const label = `${String(userLanguage)}|${String(analysisType)}`;
      const { args } = await run({
        analysisId: `analysis-${label}`,
        imageUrl: 'https://example.com/chart.png',
        analysisType,
        userId: 'user-1',
        isDemo: true,
        userLanguage,
      });
      expect({ label, prompt: args[1] }).toEqual({ label, prompt: expectedPrompt(userLanguage, analysisType) });
      expect({ label, analysisType: args[2] }).toEqual({ label, analysisType: analysisType === 'deep' ? 'deep' : 'quick' });
    }
  });

  it('campos antigos no job (promptOverride, promptVersion) sao ignorados: o prompt e o do codigo', async () => {
    const { args } = await run({
      analysisId: 'a-v10', imageUrl: 'https://example.com/c.png', analysisType: 'quick', userId: 'u', isDemo: true,
      userLanguage: 'pt', promptOverride: 'OVERRIDE {{USER_CONTEXT}}', promptVersion: 12,
    });
    const prompt = args[1] as string;
    expect(prompt.startsWith(TRADING_SYSTEM_PROMPT.split('{{USER_CONTEXT}}')[0])).toBe(true);
    expect(prompt).toContain('OUTPUT LANGUAGE: Portuguese (Brazil)');
    expect(prompt).not.toContain('OVERRIDE');
    expect(prompt.trimEnd().endsWith('</user_context>')).toBe(true);
  });

  it.each([['0', 'A'], ['100', 'B']] as const)('com %s%% na B, o worker entrega o prompt %s', async (percent, variant) => {
    process.env.PROMPT_VARIANT_B_PERCENT = percent;
    try {
      const { args } = await run({ analysisId: 'a-ab', imageUrl: 'https://example.com/c.png', analysisType: 'quick', userId: 'user-1', isDemo: true, userLanguage: 'en' });
      expect(args[1]).toBe(buildAnalysisPrompt({ userLanguage: 'en', analysisType: 'quick' }, variant));
    } finally {
      delete process.env.PROMPT_VARIANT_B_PERCENT;
    }
  });

  const profile: StrategyProfile = {
    timeframes: ['1h', '4h'],
    sessions: ['london'],
    instruments: ['forex'],
    setups: ['breakout'],
    direction: 'long',
    minRiskReward: 1.8,
  };

  it.each([
    ['sem HTF e sem perfil', {}, [], undefined],
    ['HTF vazio e perfil nulo', { htfImageUrls: [], strategyProfile: null }, [], null],
    [
      'dois HTFs e perfil',
      { htfImageUrls: ['https://example.com/h4.png', 'https://example.com/d1.png'], strategyProfile: profile },
      ['https://example.com/h4.png', 'https://example.com/d1.png'],
      profile,
    ],
  ] as const)('repassa os outros argumentos de analyzeImage sem mudar (%s)', async (_name, extra, htf, strategy) => {
    const { args } = await run({
      analysisId: 'analysis-args',
      imageUrl: 'https://example.com/exec.png',
      analysisType: 'deep',
      userId: 'user-1',
      isDemo: true,
      userLanguage: 'es',
      ...extra,
    });

    expect(args).toEqual([
      'https://example.com/exec.png',
      expectedPrompt('es', 'deep'),
      'deep',
      htf,
      strategy,
      { compareProviders: true },
    ]);
  });
});
