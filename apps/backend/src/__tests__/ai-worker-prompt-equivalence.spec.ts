/**
 * VNext, Etapa 1 (19/10/2026): caracterizacao do que o WORKER entrega ao
 * adapter. O worker e o caminho real de producao (RUN_EMBEDDED_WORKER=true);
 * o caminho sincrono do ai.service monta o prompt por outro codigo
 * (PromptBuilderService.buildPromptByVersion) e fica FORA deste teste.
 *
 * Roda o processor real do BullMQ (capturado do construtor mockado de
 * `Worker`), com Prisma e adapter simulados, e confere byte a byte:
 *   - o prompt (2o argumento de analyzeImage);
 *   - os outros argumentos de analyzeImage (imagem, tipo, HTFs, perfil, opcoes);
 *   - as consultas a PromptConfig (qual metodo, com que filtro).
 *
 * Duas provas, as duas precisam passar antes e depois de qualquer refatoracao:
 *   1. Oraculo legivel: cada caso recalcula a saida pelas regras ATUAIS do
 *      worker, escritas aqui de proposito (inclusive as que divergem da API:
 *      sem "CONSISTENCIA OBRIGATORIA", override sem idioma, versao ausente cai
 *      no prompt do codigo e nao no ativo, prompt sem trim).
 *   2. Digest de referencia: sha256 de todos os casos, gravado com o codigo de
 *      2ea57bd ANTES da extracao do montador. Se mudar, mudou comportamento.
 *
 * Mudanca intencional depois do baseline (a unica ate aqui):
 *   - D2 (19/10/2026): o override recebe o idioma no {{USER_CONTEXT}}, como o
 *     caminho sincrono. `baselinePrompt` continua sendo a regra de 2ea57bd; o
 *     teste refaz o digest de 2ea57bd trocando so o prompt pelo do baseline
 *     (prova de que nada mais mudou) e confere que so os casos de override com
 *     placeholder mudaram. `D2_DIGEST` e o digest do comportamento novo.
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
      // As duas consultas que o worker faz para montar o prompt; cada caso
      // define o que elas devolvem.
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

import { createHash } from 'crypto';
import { AIAdapter } from '../modules/ai/ai.adapter';
import { TRADING_SYSTEM_PROMPT } from '../common/prompts/trading-system-prompt';
import { DEEP_ENRICHMENT_INSTRUCTION } from '../modules/prompt/prompt-builder.service';
import type { StrategyProfile } from '../common/strategy/strategy-profile';

// sha256 do conjunto de casos de `cases` com o worker de 2ea57bd, antes da extracao.
const BASELINE_DIGEST = '027da2a42882062c7ac12f6d4c668ebd446a9111271ef71c4067792aedc5176b';
// sha256 dos mesmos casos com D2 aplicado (override com idioma).
const D2_DIGEST = 'df005b42c7771bb53db450a8c50e23650300521a0b5a578d9e1325b46695c0d7';

const DEEP_MARKER = 'ANÁLISE DEEP — LEITURA EM CAMADAS';

// Regra atual do worker: so estes 6 codigos, exatos; qualquer outro vira English.
const LANGUAGE_NAMES: Record<string, string> = {
  pt: 'Portuguese (Brazil)',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
};

function languageContext(langName: string): string {
  return `OUTPUT LANGUAGE: ${langName}\nWrite ALL analysis fields (technicalAnalysis, executiveSummary, identifiedPatterns, riskFactors, whyNotOpposite, structureValidation, keyIndicators, invalidationNote, entryCondition, partialExitStrategy, alternativeScenario, breakevenTrigger, trendStrengthNote, marketRegimeNote, multiTimeframeAlignment, sessionNote, reasoning, marketStructure.lastStructure, marketStructure.breakOfStructure, marketStructure.priceZone, marketStructure.orderBlock) in ${langName}. Do NOT translate symbol names, timeframes, or technical terms (BOS, CHoCH, OB, FVG). Keep numbers and prices in their original format.`;
}

type PromptRow = { version: number; prompt: string } | null;

interface PromptSource {
  id: string;
  promptOverride?: string;
  promptVersion?: number;
  findUnique?: PromptRow;
  findFirst?: PromptRow;
  /** Texto que o worker usa como base (override ou prompt resolvido). */
  base: string;
  isOverride: boolean;
  query: 'none' | 'findUnique' | 'findFirst';
}

const DB_V12 = '\nDB PROMPT v12\n{{USER_CONTEXT}}\nfim v12\n';
const ACTIVE_V13 = 'ACTIVE PROMPT v13 {{USER_CONTEXT}} fim v13';
const OVERRIDE = '\n  OVERRIDE (A/B v9)\n{{USER_CONTEXT}}\nfim override  \n';

const sources: PromptSource[] = [
  { id: 'override', promptOverride: OVERRIDE, base: OVERRIDE, isOverride: true, query: 'none' },
  {
    id: 'override-with-deep-marker',
    promptOverride: `override ja com ${DEEP_MARKER}`,
    base: `override ja com ${DEEP_MARKER}`,
    isOverride: true,
    query: 'none',
  },
  {
    id: 'override-and-version',
    promptOverride: OVERRIDE,
    promptVersion: 12,
    findUnique: { version: 12, prompt: DB_V12 },
    base: OVERRIDE,
    isOverride: true,
    query: 'none',
  },
  {
    id: 'version-found',
    promptVersion: 12,
    findUnique: { version: 12, prompt: DB_V12 },
    findFirst: { version: 13, prompt: ACTIVE_V13 },
    base: DB_V12,
    isOverride: false,
    query: 'findUnique',
  },
  {
    id: 'version-found-empty-prompt',
    promptVersion: 12,
    findUnique: { version: 12, prompt: '' },
    findFirst: { version: 13, prompt: ACTIVE_V13 },
    base: TRADING_SYSTEM_PROMPT,
    isOverride: false,
    query: 'findUnique',
  },
  {
    // Versao gravada que nao existe mais: o worker cai no prompt do CODIGO, nao no ativo.
    id: 'version-missing',
    promptVersion: 99,
    findUnique: null,
    findFirst: { version: 13, prompt: ACTIVE_V13 },
    base: TRADING_SYSTEM_PROMPT,
    isOverride: false,
    query: 'findUnique',
  },
  {
    id: 'version-zero',
    promptVersion: 0,
    findFirst: { version: 13, prompt: ACTIVE_V13 },
    base: ACTIVE_V13,
    isOverride: false,
    query: 'findFirst',
  },
  {
    id: 'active',
    findFirst: { version: 13, prompt: ACTIVE_V13 },
    base: ACTIVE_V13,
    isOverride: false,
    query: 'findFirst',
  },
  {
    id: 'active-empty-prompt',
    findFirst: { version: 13, prompt: '' },
    base: TRADING_SYSTEM_PROMPT,
    isOverride: false,
    query: 'findFirst',
  },
  { id: 'no-active', findFirst: null, base: TRADING_SYSTEM_PROMPT, isOverride: false, query: 'findFirst' },
  {
    id: 'active-with-deep-marker',
    findFirst: { version: 13, prompt: `ativo {{USER_CONTEXT}} ${DEEP_MARKER}` },
    base: `ativo {{USER_CONTEXT}} ${DEEP_MARKER}`,
    isOverride: false,
    query: 'findFirst',
  },
  {
    id: 'active-two-placeholders',
    findFirst: { version: 13, prompt: 'A {{USER_CONTEXT}} B {{USER_CONTEXT}} C' },
    base: 'A {{USER_CONTEXT}} B {{USER_CONTEXT}} C',
    isOverride: false,
    query: 'findFirst',
  },
];

const languages: Array<string | undefined> = ['pt', 'en', 'es', 'fr', 'de', 'ja', undefined, 'xx', 'PT', ''];
const analysisTypes: Array<string | undefined> = ['quick', 'deep', undefined, 'other'];

/** Regra do worker em 2ea57bd (baseline): override ia sem idioma. */
function baselinePrompt(source: PromptSource, userLanguage: string | undefined, analysisType: string | undefined): string {
  const langName = userLanguage && LANGUAGE_NAMES[userLanguage] ? LANGUAGE_NAMES[userLanguage] : 'English';
  const prompt = source.isOverride ? source.base : source.base.replace('{{USER_CONTEXT}}', languageContext(langName));
  return analysisType === 'deep' && !prompt.includes(DEEP_MARKER) ? `${prompt}\n\n${DEEP_ENRICHMENT_INSTRUCTION}` : prompt;
}

/** Regra atual: igual ao baseline, mais D2 (override tambem recebe o idioma). */
function expectedPrompt(source: PromptSource, userLanguage: string | undefined, analysisType: string | undefined): string {
  if (!source.isOverride) return baselinePrompt(source, userLanguage, analysisType);
  const langName = userLanguage && LANGUAGE_NAMES[userLanguage] ? LANGUAGE_NAMES[userLanguage] : 'English';
  const prompt = source.base.replace('{{USER_CONTEXT}}', languageContext(langName));
  return analysisType === 'deep' && !prompt.includes(DEEP_MARKER) ? `${prompt}\n\n${DEEP_ENRICHMENT_INSTRUCTION}` : prompt;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('worker/ai.worker.ts: prompt e argumentos entregues ao adapter (VNext Etapa 1)', () => {
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

  async function run(data: Record<string, unknown>, source?: PromptSource) {
    const promptConfig = (globalThis as any).__promptConfig;
    promptConfig.findUnique.mockReset().mockResolvedValue(source?.findUnique ?? null);
    promptConfig.findFirst.mockReset().mockResolvedValue(source?.findFirst ?? null);
    analyzeImageMock.mockReset().mockRejectedValue(new Error('stop-after-capture'));

    await expect(getProcessor()({ id: 'job-1', data, opts: { attempts: 1 }, attemptsMade: 0 })).rejects.toThrow(
      'stop-after-capture',
    );

    expect(analyzeImageMock).toHaveBeenCalledTimes(1);
    return {
      args: analyzeImageMock.mock.calls[0] as unknown[],
      findUnique: promptConfig.findUnique.mock.calls as unknown[][],
      findFirst: promptConfig.findFirst.mock.calls as unknown[][],
    };
  }

  const cases = sources.flatMap((source) =>
    languages.flatMap((userLanguage) =>
      analysisTypes.map((analysisType) => ({ source, userLanguage, analysisType })),
    ),
  );

  it(`monta o prompt igual ao oraculo nos ${cases.length} casos e bate com o digest de referencia`, async () => {
    const lines: string[] = [];
    const baselineLines: string[] = [];
    const changed: string[] = [];

    for (const { source, userLanguage, analysisType } of cases) {
      const label = `${source.id}|${String(userLanguage)}|${String(analysisType)}`;
      const { args, findUnique, findFirst } = await run(
        {
          analysisId: `analysis-${label}`,
          imageUrl: 'https://example.com/chart.png',
          promptOverride: source.promptOverride,
          promptVersion: source.promptVersion,
          analysisType,
          userId: 'user-1',
          isDemo: true,
          userLanguage,
        },
        source,
      );

      const prompt = args[1] as string;
      expect({ label, prompt }).toEqual({ label, prompt: expectedPrompt(source, userLanguage, analysisType) });
      expect({ label, analysisType: args[2] }).toEqual({ label, analysisType: analysisType === 'deep' ? 'deep' : 'quick' });

      if (source.query === 'none') {
        expect({ label, findUnique, findFirst }).toEqual({ label, findUnique: [], findFirst: [] });
      } else if (source.query === 'findUnique') {
        expect({ label, findUnique, findFirst }).toEqual({
          label,
          findUnique: [[{ where: { version: source.promptVersion } }]],
          findFirst: [],
        });
      } else {
        expect({ label, findUnique, findFirst }).toEqual({
          label,
          findUnique: [],
          findFirst: [[{ where: { isActive: true }, orderBy: { version: 'desc' } }]],
        });
      }

      const rest = [JSON.stringify([args[0], args[2], args[3], args[4], args[5], args.length]), JSON.stringify({ findUnique, findFirst })];
      const before = baselinePrompt(source, userLanguage, analysisType);
      lines.push([label, sha256(prompt), prompt.length, ...rest].join('\t'));
      baselineLines.push([label, sha256(before), before.length, ...rest].join('\t'));
      if (before !== prompt) changed.push(label);
    }

    expect(lines).toHaveLength(cases.length);
    // Trocando so o prompt pelo do baseline, volta o digest de 2ea57bd: nada alem de D2 mudou.
    expect(sha256(baselineLines.join('\n'))).toBe(BASELINE_DIGEST);
    // D2 mudou exatamente os overrides com {{USER_CONTEXT}} (o com marcador deep nao tem placeholder).
    const expectedChanged = cases
      .filter(({ source }) => source.isOverride && source.base.includes('{{USER_CONTEXT}}'))
      .map(({ source, userLanguage, analysisType }) => `${source.id}|${String(userLanguage)}|${String(analysisType)}`);
    expect(changed).toEqual(expectedChanged);
    expect(changed).toHaveLength(80);
    expect(sha256(lines.join('\n'))).toBe(D2_DIGEST);
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
    const source = sources.find((s) => s.id === 'active')!;
    const { args } = await run(
      {
        analysisId: 'analysis-args',
        imageUrl: 'https://example.com/exec.png',
        analysisType: 'deep',
        userId: 'user-1',
        isDemo: true,
        userLanguage: 'es',
        ...extra,
      },
      source,
    );

    expect(args).toEqual([
      'https://example.com/exec.png',
      expectedPrompt(source, 'es', 'deep'),
      'deep',
      htf,
      strategy,
      { compareProviders: true },
    ]);
  });
});
