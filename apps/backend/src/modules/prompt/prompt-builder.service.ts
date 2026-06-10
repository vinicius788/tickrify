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
REGRAS: comente APENAS o que está visível; NÃO invente volume, indicadores ou dados que não aparecem na imagem; todo número derivado visualmente é estimativa. Ao final, reforce em uma linha que a direção é uma HIPÓTESE e a decisão é do usuário.
IDIOMA: escreva TODO o executiveSummary — inclusive os RÓTULOS das camadas (Leitura/Reading, Volatilidade/Volatility, Cenários/Scenarios, Multi-timeframe, Fase de mercado/Market phase, Volume) — no OUTPUT LANGUAGE definido em USER_CONTEXT. Se houver DADOS REAIS no contexto, cite ao menos um número real no texto, rotulado como "dado real" (traduzido para o idioma de saída).
`.trim();

const PARTS_SEPARATOR = '\n\n---\n\n';

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

  /**
   * Resolves the final prompt following the hierarchy:
   * 1. promptOverride (if provided) → used directly
   * 2. Active PromptConfig for the analysisType → used as base
   * 3. TRADING_SYSTEM_PROMPT default → fallback
   *
   * DETERMINISTIC_CONSISTENCY_INSTRUCTION is always appended at the end.
   */
  async buildPrompt(analysisType: AnalysisType, override?: string): Promise<string> {
    if (override) {
      return this.appendDeepEnrichment(this.appendConsistencyInstruction(override), analysisType);
    }

    const base = await this.resolveActivePrompt();
    return this.appendDeepEnrichment(this.appendConsistencyInstruction(base), analysisType);
  }

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
   * Resolves the prompt using a specific version number (used by the worker/queue path).
   * Falls back to buildPrompt if the version isn't found.
   */
  async buildPromptByVersion(
    analysisType: AnalysisType,
    promptVersion?: number,
    override?: string,
    userLanguage?: string,
  ): Promise<string> {
    if (override) {
      return this.appendDeepEnrichment(this.appendConsistencyInstruction(this.injectLanguage(override, userLanguage)), analysisType);
    }

    if (promptVersion) {
      const config = await this.prisma.promptConfig.findUnique({
        where: { version: promptVersion },
      });
      if (config?.prompt) {
        return this.appendDeepEnrichment(this.appendConsistencyInstruction(this.injectLanguage(config.prompt, userLanguage)), analysisType);
      }
    }

    const base = await this.resolveActivePrompt();
    return this.appendDeepEnrichment(this.appendConsistencyInstruction(this.injectLanguage(base, userLanguage)), analysisType);
  }

  private injectLanguage(prompt: string, userLanguage?: string): string {
    const LANGUAGE_NAMES: Record<string, string> = {
      pt: 'Portuguese (Brazil)',
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      ja: 'Japanese',
    };
    const langName = (userLanguage && LANGUAGE_NAMES[userLanguage]) ? LANGUAGE_NAMES[userLanguage] : 'Portuguese (Brazil)';
    const languageContext = `OUTPUT LANGUAGE: ${langName}\nWrite ALL analysis fields (technicalAnalysis, executiveSummary, identifiedPatterns, riskFactors, whyNotOpposite, structureValidation, keyIndicators, invalidationNote, entryCondition, partialExitStrategy, alternativeScenario, breakevenTrigger, trendStrengthNote, marketRegimeNote, multiTimeframeAlignment, sessionNote, reasoning, marketStructure.lastStructure, marketStructure.breakOfStructure, marketStructure.priceZone, marketStructure.orderBlock) in ${langName}. Do NOT translate symbol names, timeframes, or technical terms (BOS, CHoCH, OB, FVG). Keep numbers and prices in their original format.`;
    return prompt.replace('{{USER_CONTEXT}}', languageContext);
  }

  /**
   * Concatenates prompt parts with a visual separator.
   */
  composePromptParts(parts: string[]): string {
    return parts
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .join(PARTS_SEPARATOR);
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
