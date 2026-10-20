import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TRADING_SYSTEM_PROMPT } from '../../common/prompts/trading-system-prompt';
import { AnalysisType } from '../ticks/tick-packages';

const DETERMINISTIC_CONSISTENCY_INSTRUCTION = `
# CONSISTÊNCIA OBRIGATÓRIA
Seja determinístico. Para o mesmo gráfico, sempre gere a mesma análise.
Não varie sua recomendação entre chamadas para a mesma imagem.
Se a estrutura indica COMPRA, indique COMPRA. Não mude para AGUARDAR sem razão técnica clara.
`.trim();

// Apenas para análise DEEP. Enriquece o executiveSummary com leitura em camadas.
// O executiveSummary é renderizado com quebras de linha (whitespace-pre-wrap),
// então a estrutura rotulada abaixo aparece de forma escaneável sem mudar a UI.
export const DEEP_ENRICHMENT_INSTRUCTION = `
# ANÁLISE DEEP — LEITURA EM CAMADAS
Esta é uma análise DEEP. No campo "executiveSummary", entregue uma leitura COMPLETA e ESCANEÁVEL, em camadas, cada bloco em sua própria linha e com rótulo no idioma de saída:
1) Leitura: estrutura e contexto do que está visível no gráfico.
2) Volatilidade: classifique o regime (baixa / normal / alta / em expansão) com base no tamanho e na variação das velas visíveis, e relacione à distância de stop sugerida. Se não for possível inferir pelo gráfico, diga isso.
3) Cenários: descreva o caminho de ALTA (se romper/sustentar tal nível), o caminho de BAIXA (se perder tal nível) e o nível de INVALIDAÇÃO. Mostre SEMPRE os dois lados.
4) Multi-timeframe: dê um veredito de ALINHAMENTO ou CONFLITO entre o contexto maior e o timeframe do gráfico. Se só houver um timeframe na imagem, infira o contexto maior com cautela e rotule como inferência.
5) Fase de mercado (Wyckoff): identifique a fase provável — acumulação / distribuição / markup / markdown — e cite o sinal que a sustenta (ex.: spring, upthrust, teste de suporte/resistência, range). Se não for possível determinar, diga "fase indefinida".
6) Volume / Área de valor: SE houver volume visível no gráfico, estime a zona de maior negociação (POC / área de valor) e trate-a como suporte/resistência dinâmico — rotule explicitamente como ESTIMATIVA. Se NÃO houver volume visível na imagem, diga "volume não visível" e não invente.
7) Risco de reversão: avalie EVIDÊNCIAS VISÍVEIS de reversão contra a tendência atual — CHoCH ou quase-CHoCH, varrida de liquidez (sweep) em topo/fundo, candle de exaustão/rejeição em zona-chave, divergência SE houver indicador visível, fase de Wyckoff compatível (spring/upthrust), e sentimento extremo SE houver dado real no contexto. Classifique como BAIXO / MODERADO / ALTO citando quais evidências sustentam a classificação, e diga explicitamente O QUE confirmaria a reversão (ex.: "fechamento acima de X com volume"). REGRA: evidência ausente NÃO conta — nunca declare reversão sem confirmação; sem evidências visíveis, escreva "risco de reversão baixo — sem sinais visíveis".
REGRAS: comente APENAS o que está visível; NÃO invente volume, indicadores ou dados que não aparecem na imagem; todo número derivado visualmente é estimativa. Ao final, reforce em uma linha que a direção é uma HIPÓTESE e a decisão é do usuário.
RÓTULOS (contrato fixo com a interface): no executiveSummary, use EXATAMENTE estes rótulos em INGLÊS, um por linha, nesta ordem: "READING:", "VOLATILITY:", "SCENARIOS:", "MULTI-TIMEFRAME:", "MARKET PHASE:", "VOLUME:", "REVERSAL RISK:". NUNCA traduza os rótulos — a interface os traduz automaticamente. O CONTEÚDO de cada bloco, porém, deve ser escrito no OUTPUT LANGUAGE definido em USER_CONTEXT, assim como a linha final (que reforça que a direção é uma hipótese e a decisão é do usuário). Se houver DADOS REAIS no contexto, cite ao menos um número real no texto, rotulado como "dado real" (no idioma de saída).
`.trim();

// ============================================================================
// MONTADOR DO PROMPT DA ANALISE (VNext, Etapa 1, 19/10/2026)
// ----------------------------------------------------------------------------
// Fonte unica do prompt que o WORKER (caminho de producao) entrega ao adapter.
// Reproduz byte a byte o `getPrompt` que morava em worker/ai.worker.ts; prova
// em src/__tests__/ai-worker-prompt-equivalence.spec.ts (480 casos + digest).
// O caminho sincrono (`buildPromptByVersion`, abaixo) ainda monta por conta
// propria e difere do worker em um ponto: com versao ausente, cai no prompt
// ativo (o worker cai no do codigo). Alinhar muda comportamento: fica para
// outra rodada. O trim do sincrono saiu em 19/10/2026 (so com consistency: false).
// A "CONSISTENCIA OBRIGATORIA" saiu do sincrono em 19/10/2026 (D1); o /try e
// os scripts de medicao ainda a recebem (padrao de buildPromptByVersion).
// D2 (19/10/2026): o override (perna B do A/B da v9) tambem recebe o idioma
// no {{USER_CONTEXT}}, como no sincrono; antes ia ao modelo com o placeholder
// literal. Override sem placeholder segue sem instrucao de idioma (igual a API).
// ============================================================================

/** Idiomas de saida aceitos; qualquer outro codigo vira English. */
export const OUTPUT_LANGUAGE_NAMES: Record<string, string> = {
  pt: 'Portuguese (Brazil)',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
};

export function outputLanguageInstruction(langName: string): string {
  return `OUTPUT LANGUAGE: ${langName}\nWrite ALL analysis fields (technicalAnalysis, executiveSummary, identifiedPatterns, riskFactors, whyNotOpposite, structureValidation, keyIndicators, invalidationNote, entryCondition, partialExitStrategy, alternativeScenario, breakevenTrigger, trendStrengthNote, marketRegimeNote, multiTimeframeAlignment, sessionNote, reasoning, marketStructure.lastStructure, marketStructure.breakOfStructure, marketStructure.priceZone, marketStructure.orderBlock) in ${langName}. Do NOT translate symbol names, timeframes, or technical terms (BOS, CHoCH, OB, FVG). Keep numbers and prices in their original format.`;
}

/** O pedaco do Prisma que o montador le (o PrismaClient do worker serve). */
export interface PromptConfigReader {
  promptConfig: {
    findUnique(args: { where: { version: number } }): PromiseLike<{ prompt: string } | null>;
    findFirst(args: {
      where: { isActive: true };
      orderBy: { version: 'desc' };
    }): PromiseLike<{ prompt: string } | null>;
  };
}

export interface AnalysisPromptInput {
  promptOverride?: string;
  promptVersion?: number;
  userLanguage?: string;
  analysisType?: AnalysisType;
}

export async function buildAnalysisPrompt(
  db: PromptConfigReader,
  { promptOverride, promptVersion, userLanguage, analysisType }: AnalysisPromptInput,
): Promise<string> {
  const withDeep = (p: string): string =>
    analysisType === 'deep' && !p.includes('ANÁLISE DEEP — LEITURA EM CAMADAS')
      ? `${p}\n\n${DEEP_ENRICHMENT_INSTRUCTION}`
      : p;

  // Inject language into USER_CONTEXT placeholder — English by default (global product)
  const langName = (userLanguage && OUTPUT_LANGUAGE_NAMES[userLanguage]) ? OUTPUT_LANGUAGE_NAMES[userLanguage] : 'English';
  const withLanguage = (p: string): string => p.replace('{{USER_CONTEXT}}', outputLanguageInstruction(langName));

  if (promptOverride) {
    return withDeep(withLanguage(promptOverride));
  }

  let basePrompt: string;

  if (promptVersion) {
    const promptConfig = await db.promptConfig.findUnique({
      where: { version: promptVersion },
    });
    if (promptConfig?.prompt) {
      basePrompt = promptConfig.prompt;
    } else {
      basePrompt = TRADING_SYSTEM_PROMPT;
    }
  } else {
    const activePrompt = await db.promptConfig.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    basePrompt = activePrompt?.prompt || TRADING_SYSTEM_PROMPT;
  }

  return withDeep(withLanguage(basePrompt));
}

// Cache TTL: 60 segundos — evita DB round-trip em cada análise sem sacrificar atualizações
const PROMPT_CACHE_TTL_MS = 60_000;

interface PromptCacheEntry {
  version: number | undefined;
  prompt: string;
  fetchedAt: number;
}

@Injectable()
export class PromptBuilderService {
  private promptCache: PromptCacheEntry | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async resolveActivePrompt(): Promise<string> {
    const now = Date.now();

    if (this.promptCache && now - this.promptCache.fetchedAt < PROMPT_CACHE_TTL_MS) {
      return this.promptCache.prompt;
    }

    const activeConfig = await this.prisma.promptConfig.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });

    const prompt = activeConfig?.prompt || TRADING_SYSTEM_PROMPT;

    this.promptCache = { version: activeConfig?.version, prompt, fetchedAt: now };

    return prompt;
  }

  /**
   * Resolves the prompt using a specific version number (synchronous path, /try and scripts).
   * Falls back to the active prompt if the version isn't found.
   *
   * `consistency: false` (caminho sincrono da analise): monta como o worker,
   * sem a "CONSISTENCIA OBRIGATORIA" (D1) e sem trim, com o bloco deep juntado
   * como no `buildAnalysisPrompt` (19/10/2026). O padrao (/try e scripts) segue
   * com o bloco e o trim.
   */
  async buildPromptByVersion(
    analysisType: AnalysisType,
    promptVersion?: number,
    override?: string,
    userLanguage?: string,
    options: { consistency?: boolean } = {},
  ): Promise<string> {
    const finish = (prompt: string): string => {
      if (options.consistency !== false) {
        return this.appendDeepEnrichment(this.appendConsistencyInstruction(prompt), analysisType);
      }
      // Mesma regra do `withDeep` de buildAnalysisPrompt (worker), sem trim.
      return analysisType === 'deep' && !prompt.includes('ANÁLISE DEEP — LEITURA EM CAMADAS')
        ? `${prompt}\n\n${DEEP_ENRICHMENT_INSTRUCTION}`
        : prompt;
    };

    if (override) {
      return finish(this.injectLanguage(override, userLanguage));
    }

    if (promptVersion) {
      const config = await this.prisma.promptConfig.findUnique({
        where: { version: promptVersion },
      });
      if (config?.prompt) {
        return finish(this.injectLanguage(config.prompt, userLanguage));
      }
    }

    const base = await this.resolveActivePrompt();
    return finish(this.injectLanguage(base, userLanguage));
  }

  private injectLanguage(prompt: string, userLanguage?: string): string {
    const langName = (userLanguage && OUTPUT_LANGUAGE_NAMES[userLanguage]) ? OUTPUT_LANGUAGE_NAMES[userLanguage] : 'English';
    return prompt.replace('{{USER_CONTEXT}}', outputLanguageInstruction(langName));
  }

  private appendConsistencyInstruction(prompt: string): string {
    const normalized = String(prompt || '').trim();
    if (!normalized) {
      return DETERMINISTIC_CONSISTENCY_INSTRUCTION;
    }

    if (normalized.includes('Seja determinístico. Para o mesmo gráfico')) {
      return normalized;
    }

    return `${normalized}\n\n${DETERMINISTIC_CONSISTENCY_INSTRUCTION}`;
  }

  /**
   * Apenas para análise DEEP: anexa a instrução de leitura em camadas.
   * Para quick (ou qualquer outro tipo) retorna o prompt inalterado — garante
   * que o caminho rápido continue exatamente como hoje.
   */
  private appendDeepEnrichment(prompt: string, analysisType: AnalysisType): string {
    if (analysisType !== 'deep') {
      return prompt;
    }
    const normalized = String(prompt || '').trim();
    if (normalized.includes('ANÁLISE DEEP — LEITURA EM CAMADAS')) {
      return normalized;
    }
    return `${normalized}\n\n${DEEP_ENRICHMENT_INSTRUCTION}`;
  }
}
