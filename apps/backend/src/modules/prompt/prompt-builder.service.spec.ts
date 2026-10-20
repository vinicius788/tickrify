/**
 * D1 (VNext Etapa 2, 19/10/2026): a "CONSISTENCIA OBRIGATORIA" so existia no
 * caminho sincrono; o worker (producao) nunca a enviou. O sincrono agora pede
 * `consistency: false` e fica sem o bloco. O padrao continua acrescentando,
 * porque o /try (demo.service) e os scripts de medicao usam o padrao e nao
 * fazem parte desta rodada.
 *
 * A prova e por diferenca: em cada caso, o prompt do sincrono e EXATAMENTE o
 * prompt antigo sem o bloco. Idioma, override, versao e deep ficam iguais.
 * Desde a correcao do trim (19/10/2026, mais abaixo), o sincrono tambem nao faz
 * trim: a comparacao com o legado reaplica o trim antigo (`trimLikeBeforeFix`).
 */
import { TRADING_SYSTEM_PROMPT } from '../../common/prompts/trading-system-prompt';
import { buildAnalysisPrompt, DEEP_ENRICHMENT_INSTRUCTION, PromptBuilderService } from './prompt-builder.service';
import type { AnalysisType } from '../ticks/tick-packages';

// Texto do bloco no codigo de 2ea57bd (contrato documentado aqui de proposito).
const CONSISTENCY_BLOCK = [
  '# CONSISTÊNCIA OBRIGATÓRIA',
  'Seja determinístico. Para o mesmo gráfico, sempre gere a mesma análise.',
  'Não varie sua recomendação entre chamadas para a mesma imagem.',
  'Se a estrutura indica COMPRA, indique COMPRA. Não mude para AGUARDAR sem razão técnica clara.',
].join('\n');

const DB_V12 = '\nDB PROMPT v12\n{{USER_CONTEXT}}\nfim v12\n';
const ACTIVE_V13 = '  ACTIVE PROMPT v13 {{USER_CONTEXT}} fim v13\n';
const OVERRIDE = '\n  OVERRIDE (A/B v9)\n{{USER_CONTEXT}}\nfim override  \n';

type Row = { version: number; prompt: string } | null;

/** Trim que o sincrono fazia ate a correcao de 19/10/2026, para comparar com o legado. */
function trimLikeBeforeFix(prompt: string, type: AnalysisType): string {
  const deepSuffix = `\n\n${DEEP_ENRICHMENT_INSTRUCTION}`;
  if (type === 'deep' && prompt.endsWith(deepSuffix)) {
    return `${prompt.slice(0, -deepSuffix.length).trim()}${deepSuffix}`;
  }
  return prompt.trim();
}

const sources: Array<{ id: string; version?: number; override?: string; byVersion?: Row; active?: Row }> = [
  { id: 'override', override: OVERRIDE },
  { id: 'versao encontrada', version: 12, byVersion: { version: 12, prompt: DB_V12 }, active: { version: 13, prompt: ACTIVE_V13 } },
  { id: 'versao ausente', version: 99, byVersion: null, active: { version: 13, prompt: ACTIVE_V13 } },
  { id: 'prompt ativo', active: { version: 13, prompt: ACTIVE_V13 } },
  { id: 'sem ativo (codigo)', active: null },
];
const languages = ['pt', 'en', 'ja', 'xx', undefined];
const types: AnalysisType[] = ['quick', 'deep'];

function makeBuilder(source: (typeof sources)[number]) {
  const prisma = {
    promptConfig: {
      findUnique: jest.fn().mockResolvedValue(source.byVersion ?? null),
      findFirst: jest.fn().mockResolvedValue(source.active ?? null),
    },
  };
  return { prisma, builder: new PromptBuilderService(prisma as any) };
}

const cases = sources.flatMap((source) =>
  languages.flatMap((lang) => types.map((type) => ({ source, lang, type }))),
);

describe('PromptBuilderService.buildPromptByVersion: D1, sem CONSISTENCIA no caminho sincrono', () => {
  it.each(cases.map((c) => [`${c.source.id} | ${String(c.lang)} | ${c.type}`, c] as const))(
    '%s: o sincrono e o prompt antigo sem o bloco',
    async (_label, { source, lang, type }) => {
      const before = makeBuilder(source);
      const after = makeBuilder(source);

      const legacy = await before.builder.buildPromptByVersion(type, source.version, source.override, lang);
      const sync = await after.builder.buildPromptByVersion(type, source.version, source.override, lang, {
        consistency: false,
      });

      expect(legacy).toContain(CONSISTENCY_BLOCK);
      expect(sync).not.toContain('CONSISTÊNCIA OBRIGATÓRIA');
      expect(sync).not.toContain('Seja determinístico');
      expect(trimLikeBeforeFix(sync, type)).toBe(legacy.replace(`\n\n${CONSISTENCY_BLOCK}`, ''));
      // Mesmas consultas ao banco nos dois.
      expect(after.prisma.promptConfig.findUnique.mock.calls).toEqual(before.prisma.promptConfig.findUnique.mock.calls);
      expect(after.prisma.promptConfig.findFirst.mock.calls).toEqual(before.prisma.promptConfig.findFirst.mock.calls);
    },
  );

  it('padrao sem opcao (/try e scripts) continua acrescentando o bloco no fim', async () => {
    const { builder } = makeBuilder({ id: 'sem ativo (codigo)', active: null });
    const prompt = await builder.buildPromptByVersion('quick', undefined, undefined, 'en');
    expect(prompt.endsWith(`\n\n${CONSISTENCY_BLOCK}`)).toBe(true);
    expect(prompt.startsWith(TRADING_SYSTEM_PROMPT.trim().slice(0, 40))).toBe(true);
  });

  it('consistency: true explicito e igual ao padrao', async () => {
    const source = sources[1];
    const a = await makeBuilder(source).builder.buildPromptByVersion('deep', 12, undefined, 'es');
    const b = await makeBuilder(source).builder.buildPromptByVersion('deep', 12, undefined, 'es', { consistency: true });
    expect(b).toBe(a);
  });

  it.each(types)('worker (%s) nao tem o bloco, nem antes nem agora', async (type) => {
    for (const source of sources) {
      const { prisma } = makeBuilder(source);
      const prompt = await buildAnalysisPrompt(prisma as any, {
        promptOverride: source.override,
        promptVersion: source.version,
        userLanguage: 'pt',
        analysisType: type,
      });
      expect(prompt).not.toContain('CONSISTÊNCIA OBRIGATÓRIA');
    }
  });
});

/**
 * D2 (VNext Etapa 2, 19/10/2026): o override (na producao, so a perna B do A/B
 * da v9) chegava ao modelo pelo worker com o {{USER_CONTEXT}} literal e sem
 * idioma; o sincrono ja trocava o placeholder. Agora o worker troca tambem.
 * Override sem placeholder continua sem instrucao de idioma nos dois caminhos
 * (regra de `injectLanguage`, que o /try e os scripts tambem usam).
 */
describe('D2: idioma no override (worker = sincrono)', () => {
  const LANG_NAMES: Record<string, string> = { pt: 'Portuguese (Brazil)', es: 'Spanish', ja: 'Japanese', en: 'English' };
  const languageLine = (name: string) => `OUTPUT LANGUAGE: ${name}\nWrite ALL analysis fields (`;
  const noDb = () => ({ promptConfig: { findUnique: jest.fn(), findFirst: jest.fn() } });
  const worker = (override: string, userLanguage: string | undefined, analysisType: AnalysisType = 'quick') =>
    buildAnalysisPrompt(noDb() as any, { promptOverride: override, userLanguage, analysisType });
  const sync = (override: string, userLanguage: string | undefined, analysisType: AnalysisType = 'quick') =>
    new PromptBuilderService(noDb() as any).buildPromptByVersion(analysisType, undefined, override, userLanguage, {
      consistency: false,
    });

  it('override em portugues recebe a instrucao de idioma no lugar do placeholder', async () => {
    const prompt = await worker('INICIO {{USER_CONTEXT}} FIM', 'pt');
    expect(prompt.startsWith(`INICIO ${languageLine('Portuguese (Brazil)')}`)).toBe(true);
    expect(prompt.endsWith(' FIM')).toBe(true);
    expect(prompt).not.toContain('{{USER_CONTEXT}}');
  });

  it.each(['es', 'ja'])('override em outro idioma (%s)', async (lang) => {
    const prompt = await worker('A {{USER_CONTEXT}} B', lang);
    expect(prompt).toContain(languageLine(LANG_NAMES[lang]));
    expect(prompt).toContain(`in ${LANG_NAMES[lang]}. Do NOT translate`);
    expect(prompt).not.toContain('Portuguese');
  });

  it('idioma ausente ou desconhecido vira English, como no prompt sem override', async () => {
    expect(await worker('A {{USER_CONTEXT}} B', undefined)).toContain(languageLine('English'));
    expect(await worker('A {{USER_CONTEXT}} B', 'xx')).toContain(languageLine('English'));
  });

  it('com dois placeholders troca so o primeiro (mesma regra do sincrono)', async () => {
    const prompt = await worker('A {{USER_CONTEXT}} B {{USER_CONTEXT}} C', 'pt');
    expect(prompt.split('{{USER_CONTEXT}}')).toHaveLength(2);
    expect(prompt).toBe(await sync('A {{USER_CONTEXT}} B {{USER_CONTEXT}} C', 'pt'));
  });

  it('override sem placeholder fica igual: sem instrucao de idioma nos dois caminhos', async () => {
    expect(await worker('SEM PLACEHOLDER', 'pt')).toBe('SEM PLACEHOLDER');
    expect(await sync('SEM PLACEHOLDER', 'pt')).toBe('SEM PLACEHOLDER');
  });

  it('o prompt v9 real (unico override de producao) sai sem placeholder e com o idioma', async () => {
    const { TRADING_SYSTEM_PROMPT_V9 } = await import('../../common/prompts/trading-system-prompt-v9');
    expect(TRADING_SYSTEM_PROMPT_V9.split('{{USER_CONTEXT}}')).toHaveLength(2);
    for (const type of ['quick', 'deep'] as const) {
      const prompt = await worker(TRADING_SYSTEM_PROMPT_V9, 'pt', type);
      expect(prompt).not.toContain('{{USER_CONTEXT}}');
      expect(prompt).toContain(languageLine('Portuguese (Brazil)'));
    }
  });

  const overrides = [
    'A {{USER_CONTEXT}} B',
    '{{USER_CONTEXT}}',
    'SEM PLACEHOLDER',
    'A {{USER_CONTEXT}} B {{USER_CONTEXT}} C',
    'A {{USER_CONTEXT}} ANÁLISE DEEP — LEITURA EM CAMADAS',
  ];
  const equivalence = overrides.flatMap((o) =>
    ['pt', 'en', 'es', 'fr', 'de', 'ja', undefined, 'xx'].flatMap((lang) =>
      (['quick', 'deep'] as const).map((type) => [o, String(lang), type, lang] as const),
    ),
  );

  it.each(equivalence)('worker e sincrono iguais: %s | %s | %s', async (override, _l, type, lang) => {
    expect(await worker(override, lang, type)).toBe(await sync(override, lang, type));
  });

  it('com espaco em volta do override, worker e sincrono iguais (sem trim desde 19/10)', async () => {
    const padded = '\n  A {{USER_CONTEXT}} B  \n';
    for (const type of ['quick', 'deep'] as const) {
      expect(await sync(padded, 'pt', type)).toBe(await worker(padded, 'pt', type));
    }
  });

  it('/try e scripts (padrao, com override) seguem como antes: idioma, trim e CONSISTENCIA', async () => {
    const builder = new PromptBuilderService(noDb() as any);
    const injected = `A ${languageLine('Spanish')}`;
    const quick = await builder.buildPromptByVersion('quick', undefined, '  A {{USER_CONTEXT}}  ', 'es');
    expect(quick.startsWith(injected)).toBe(true);
    expect(quick.endsWith(`Keep numbers and prices in their original format.\n\n${CONSISTENCY_BLOCK}`)).toBe(true);
  });
});

/**
 * Trim (19/10/2026). Antes da correcao, o sincrono fazia trim e o worker nao;
 * a diferenca medida era: prompt do codigo quick = worker com 1 \n a mais em
 * cada ponta; deep = 1 \n a mais no inicio e 1 antes do bloco deep; override
 * v9 = 1 \n no inicio e 2 no fim; na OpenAI so o fim chegava (+1 ou +2 \n
 * antes do contexto) e, no deep, +1 \n antes do bloco deep. Prompt do banco
 * gravado pelo sync do boot (com trim) nao tinha diferenca.
 * Agora, com `consistency: false`, o sincrono monta como o worker: os casos
 * abaixo sao byte a byte iguais, no montador e na mensagem system da OpenAI.
 * Fica fora: versao ausente (sincrono cai no ativo, worker no codigo).
 */
describe('trim: worker e sincrono byte a byte iguais', () => {
  const db = (active: { version: number; prompt: string } | null, byVersion: { version: number; prompt: string } | null = null) => ({
    promptConfig: { findUnique: jest.fn().mockResolvedValue(byVersion), findFirst: jest.fn().mockResolvedValue(active) },
  });

  /** Mensagem system que a OpenAI receberia (vision-model.ts real, cliente falso). */
  async function openAiSystem(instructions: string, context: string[]): Promise<string> {
    const { OpenAiVisionModel } = await import('../ai/vision-model');
    const create = jest.fn().mockResolvedValue({ model: 'm', choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
    await new OpenAiVisionModel({ chat: { completions: { create } } } as any).complete({
      tier: 'quick', instructions, context, userContent: [{ type: 'text', text: 'x' }], maxTokens: 100, timeoutMs: 5000,
    });
    return create.mock.calls[0][0].messages[0].content;
  }

  const edges = (s: string) => ({
    lead: s.slice(0, s.length - s.trimStart().length),
    trail: s.slice(s.trimEnd().length),
  });

  it('prompts reais com espaco nas pontas: v7.6 (codigo) e v9 (override)', async () => {
    const { TRADING_SYSTEM_PROMPT_V9 } = await import('../../common/prompts/trading-system-prompt-v9');
    expect(edges(TRADING_SYSTEM_PROMPT)).toEqual({ lead: '\n', trail: '\n' });
    expect(edges(TRADING_SYSTEM_PROMPT_V9)).toEqual({ lead: '\n', trail: '\n\n' });
  });

  const origins = async () => {
    const { TRADING_SYSTEM_PROMPT_V9 } = await import('../../common/prompts/trading-system-prompt-v9');
    return [
      { id: 'banco, gravado pelo sync do boot (trim)', active: { version: 14, prompt: TRADING_SYSTEM_PROMPT.trim() } },
      { id: 'banco, linha do /admin com espaco', active: { version: 15, prompt: TRADING_SYSTEM_PROMPT } },
      { id: 'banco, versao gravada encontrada', version: 14, byVersion: { version: 14, prompt: `\n${TRADING_SYSTEM_PROMPT.trim()}\n\n` } },
      { id: 'codigo (sem linha ativa)', active: null },
      { id: 'override v9', override: TRADING_SYSTEM_PROMPT_V9, active: null },
    ] as Array<{ id: string; active?: { version: number; prompt: string } | null; version?: number;
      byVersion?: { version: number; prompt: string }; override?: string }>;
  };

  const contexts: string[][] = [[], ['DADOS REAIS: bloco de grounding'], ['DADOS REAIS', 'PERFIL DE ESTRATEGIA']];

  it.each(['quick', 'deep'] as const)('%s: montador e mensagem system da OpenAI iguais em todas as origens', async (type) => {
    for (const o of await origins()) {
      for (const lang of ['en', 'pt']) {
        const w = await buildAnalysisPrompt(db(o.active ?? null, o.byVersion ?? null) as any, {
          promptOverride: o.override, promptVersion: o.version, userLanguage: lang, analysisType: type,
        });
        const s = await new PromptBuilderService(db(o.active ?? null, o.byVersion ?? null) as any).buildPromptByVersion(
          type, o.version, o.override, lang, { consistency: false },
        );
        expect({ origem: o.id, lang, prompt: s }).toEqual({ origem: o.id, lang, prompt: w });
        for (const ctx of contexts) {
          expect({ origem: o.id, ctx: ctx.length, system: await openAiSystem(s, ctx) }).toEqual({
            origem: o.id, ctx: ctx.length, system: await openAiSystem(w, ctx),
          });
        }
      }
    }
  });

  it('o sincrono nao faz mais trim: o prompt do codigo sai com o \\n das pontas, como no worker', async () => {
    const s = await new PromptBuilderService(db(null) as any).buildPromptByVersion('quick', undefined, undefined, 'en', {
      consistency: false,
    });
    expect(edges(s)).toEqual({ lead: '\n', trail: '\n' });
    const d = await new PromptBuilderService(db(null) as any).buildPromptByVersion('deep', undefined, undefined, 'en', {
      consistency: false,
    });
    expect(d).toContain('END OF PROMPT v7.6\n\n\n# ANÁLISE DEEP — LEITURA EM CAMADAS');
  });

  it('o padrao (/try e scripts) continua com trim e com o bloco', async () => {
    const quick = await new PromptBuilderService(db(null) as any).buildPromptByVersion('quick', undefined, undefined, 'en');
    expect(edges(quick)).toEqual({ lead: '', trail: '' });
    const deep = await new PromptBuilderService(db(null) as any).buildPromptByVersion('deep', undefined, undefined, 'en');
    expect(deep).toContain('Não mude para AGUARDAR sem razão técnica clara.\n\n# ANÁLISE DEEP — LEITURA EM CAMADAS');
    expect(deep.startsWith('You are')).toBe(true);
  });

  it('versao ausente continua divergente (fora desta rodada): sincrono usa o ativo, worker o codigo', async () => {
    const active = { version: 13, prompt: 'ATIVO {{USER_CONTEXT}}' };
    const w = await buildAnalysisPrompt(db(active, null) as any, { promptVersion: 99, userLanguage: 'en', analysisType: 'quick' });
    const s = await new PromptBuilderService(db(active, null) as any).buildPromptByVersion('quick', 99, undefined, 'en', {
      consistency: false,
    });
    expect(w.startsWith('\nYou are')).toBe(true);
    expect(s.startsWith('ATIVO OUTPUT LANGUAGE: English')).toBe(true);
  });
});
