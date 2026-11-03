import { TRADING_SYSTEM_PROMPT } from '../../common/prompts/trading-system-prompt';
import { AnalysisType } from '../ticks/tick-packages';

// ============================================================================
// MONTADOR UNICO DO PROMPT DA ANALISE (26/10/2026)
// ----------------------------------------------------------------------------
// Worker (fila), caminho sincrono, /try e scripts de medicao montam o prompt
// por aqui e so por aqui: o que se mede e o que roda. Antes o sincrono, o /try
// e os scripts recebiam um bloco extra de "consistencia" que o worker nao
// tinha, e a medicao nao reproduzia producao.
// O {{USER_CONTEXT}} recebe o idioma de saida e, na deep, o bloco do modo
// deep. REAL DATA e perfil de estrategia entram depois, no adapter, antes do
// </user_context> (ver `splitUserContextClose`).
// ============================================================================

const USER_CONTEXT_PLACEHOLDER = '{{USER_CONTEXT}}';
const USER_CONTEXT_CLOSE = '</user_context>';

// So na analise DEEP. Mesmo contrato e mesmos estados: a profundidade
// muda a leitura, nunca o veredito. Os rotulos em ingles sao contrato com a
// interface, que os traduz.
export const DEEP_ANALYSIS_INSTRUCTION = `
ANALYSIS MODE: DEEP
The decision rules, the four states and the JSON contract are unchanged. Depth goes into the reading, never into a different state.
In executiveSummary, write seven labeled lines in this order, up to 1200 characters in total. Keep these labels in English exactly; write their content in the OUTPUT LANGUAGE:
READING: structure and context visible on the chart, with prices.
VOLATILITY: low, normal, high or expanding, from ATR (real data when provided) and candle ranges, and how it relates to the stop distance.
SCENARIOS: the bullish path (hold or break of a named level), the bearish path (loss of a named level) and the invalidation level. Always both sides.
MULTI-TIMEFRAME: alignment or conflict between the higher timeframe and the chart timeframe. With a single chart, label the higher timeframe as inferred.
MARKET PHASE: accumulation, distribution, markup, markdown or undefined, with the signal that supports it.
VOLUME: value area or POC only from visible or real volume, labeled as an estimate; otherwise write that volume is not visible.
REVERSAL RISK: low, moderate or high, citing the evidence present and what would confirm a reversal. Absent evidence does not count.
After the seven lines, end with the action sentence the decision requires (for WATCH, the level to watch).
When REAL DATA is present, cite at least one real number and call it real data.
`.trim();

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
  return `OUTPUT LANGUAGE: ${langName}\nWrite ALL analysis fields (technicalAnalysis, executiveSummary, identifiedPatterns, riskFactors, whyNotOpposite, structureValidation, keyIndicators, invalidationNote, entryCondition, partialExitStrategy, alternativeScenario, breakevenTrigger, trendStrengthNote, marketRegimeNote, multiTimeframeAlignment, sessionNote, reasoning, marketStructure.lastStructure, marketStructure.breakOfStructure, marketStructure.priceZone, marketStructure.orderBlock, watchPlan.trigger) in ${langName}. Do NOT translate symbol names, timeframes, or technical terms (BOS, CHoCH, OB, FVG). Keep numbers and prices in their original format.`;
}

export interface AnalysisPromptInput {
  userLanguage?: string;
  analysisType?: AnalysisType;
}

/**
 * Monta o prompt a partir de um texto-base no formato do motor (com
 * {{USER_CONTEXT}}). Producao so usa o TRADING_SYSTEM_PROMPT; os scripts de
 * medicao passam o texto de um prompt candidato, sem tocar no oficial.
 */
export function assembleAnalysisPrompt(base: string, { userLanguage, analysisType }: AnalysisPromptInput): string {
  const langName = (userLanguage && OUTPUT_LANGUAGE_NAMES[userLanguage]) ? OUTPUT_LANGUAGE_NAMES[userLanguage] : 'English';
  const deep = analysisType === 'deep' ? [DEEP_ANALYSIS_INSTRUCTION] : [];
  if (base.includes(USER_CONTEXT_PLACEHOLDER)) {
    const userContext = [outputLanguageInstruction(langName), ...deep].join('\n\n');
    return base.replace(USER_CONTEXT_PLACEHOLDER, () => userContext);
  }
  // Candidato sem placeholder: sem idioma.
  return [base, ...deep].join('\n\n');
}

/**
 * O prompt da analise: sempre o do codigo (27/10/2026). Nao existe prompt
 * ativo no banco, versao escolhida por job nem override: a tabela PromptConfig
 * so numera a versao (PromptSyncService) para o promptVer de cada analise.
 */
export function buildAnalysisPrompt(input: AnalysisPromptInput): string {
  return assembleAnalysisPrompt(TRADING_SYSTEM_PROMPT, input);
}

/**
 * Separa o fechamento do </user_context> do fim do prompt, para os blocos
 * variaveis (REAL DATA, perfil de estrategia) entrarem DENTRO dele e depois
 * da parte fixa (o cache de prompt do provedor pega o prefixo inteiro).
 * Prompt que nao termina na tag volta inteiro, com `close` null.
 */
export function splitUserContextClose(prompt: string): { instructions: string; close: string | null } {
  const trimmed = prompt.trimEnd();
  if (!trimmed.endsWith(USER_CONTEXT_CLOSE)) return { instructions: prompt, close: null };
  return { instructions: trimmed.slice(0, -USER_CONTEXT_CLOSE.length).trimEnd(), close: USER_CONTEXT_CLOSE };
}
