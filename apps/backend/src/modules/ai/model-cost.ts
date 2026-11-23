/**
 * Estimativa de custo por análise, calculada a partir do `usage` da resposta e
 * da tabela pública. A fatura pode variar por cache, tier e descontos.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O plano é US$ 29 por 200 ticks, ou seja **US$ 0,145 de receita por tick**.
 * Um deep custa 3 ticks (US$ 0,435 de receita). Saber se isso fecha exige o
 * uso real, e até 31/08/2026 ele nunca foi medido em produção: o `usage`
 * chegava na resposta e era descartado, exceto quando `AI_DEBUG_DUMP_RAW`
 * gravava num arquivo local — inútil no Render, cujo disco é efêmero.
 *
 * O campo que mais importa é `reasoning_tokens`, dentro de
 * `completion_tokens_details`. Nos modelos GPT-5 ele é o gasto INVISÍVEL de
 * raciocínio, cobrado como SAÍDA (a faixa mais cara). É a única variável que
 * separa "este usuário custa US$ 5" de "custa US$ 9", e é exatamente a que
 * ninguém enxergava.
 *
 * REGRA: preço de modelo muda AQUI, num lugar só. Nunca espalhe número de
 * preço pelo adapter.
 */

/** Preço em dólares por 1 MILHÃO de tokens. */
interface ModelPricing {
  input: number;
  output: number;
}

// Fonte: documentação oficial da OpenAI, conferida em 23/09/2026.
// https://developers.openai.com/api/docs/models/gpt-5.6-luna
// https://developers.openai.com/api/docs/models/gpt-5.6-terra
// https://developers.openai.com/api/docs/models/gpt-5.6-sol
// https://developers.openai.com/api/docs/models/gpt-4o
// https://developers.openai.com/api/docs/models/gpt-4o-mini
// Valores Standard sem desconto de cache; revisar antes de orçar nova rodada.
// `gpt-4o`/`gpt-4o-mini` ficam para análises antigas e o backtest (`AI_MODEL`).
const PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  // Conferidos em 23/11/2026: developers.openai.com/api/docs/models/gpt-6-luna e a tabela da Anthropic.
  'gpt-6-luna': { input: 0.1, output: 0.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gpt-5.6-sol': { input: 4, output: 20 },
};

/** Receita por tick: US$ 29 / 200 ticks. Usada para o alerta de margem. */
export const REVENUE_PER_TICK_USD = 29 / 200;

export interface TokenUsage {
  promptTokens: number;
  /** Parte de `promptTokens` servida pelo cache de prompt do provedor. */
  cachedTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface CostBreakdown extends TokenUsage {
  /** null quando o modelo não está na tabela — melhor omitir que inventar. */
  costUsd: number | null;
  /** Receita da análise (1 tick no quick, 3 no deep). */
  revenueUsd: number;
  /** true quando o custo passou da receita. Nunca deveria acontecer. */
  overBudget: boolean;
}

/**
 * Lê o `usage` cru da OpenAI. Tolerante de propósito: formato que muda ou campo
 * ausente vira 0, nunca exceção — instrumentação JAMAIS pode derrubar a análise
 * que ela está medindo.
 */
export function extractUsage(usage: unknown): TokenUsage {
  const u = (usage || {}) as Record<string, any>;
  const details = (u.completion_tokens_details || {}) as Record<string, any>;
  const promptDetails = (u.prompt_tokens_details || {}) as Record<string, any>;
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    promptTokens: num(u.prompt_tokens),
    cachedTokens: num(promptDetails.cached_tokens),
    completionTokens: num(u.completion_tokens),
    reasoningTokens: num(details.reasoning_tokens),
    totalTokens: num(u.total_tokens),
  };
}

/**
 * Estimativa em dólares. `reasoning_tokens` NÃO é somado à parte: a OpenAI já o
 * inclui dentro de `completion_tokens`. Somar de novo contaria em dobro — é o
 * erro fácil de cometer aqui, e ele inflaria o custo justamente no modelo onde
 * a decisão de preço é mais apertada.
 */
export function computeCost(
  model: string,
  usage: TokenUsage,
  ticksCharged: number,
): CostBreakdown {
  const pricing = PRICING[String(model || '').trim()];
  const revenueUsd = ticksCharged * REVENUE_PER_TICK_USD;

  if (!pricing) {
    return { ...usage, costUsd: null, revenueUsd, overBudget: false };
  }

  const costUsd =
    (usage.promptTokens / 1_000_000) * pricing.input +
    (usage.completionTokens / 1_000_000) * pricing.output;

  return {
    ...usage,
    costUsd,
    revenueUsd,
    overBudget: costUsd > revenueUsd,
  };
}

/** Linha de log. Prefixo `[Cost]` para dar grep no painel do Render. */
export function formatCostLog(
  model: string,
  analysisType: string,
  breakdown: CostBreakdown,
): string {
  const usd = (v: number) => `$${v.toFixed(4)}`;
  const cost = breakdown.costUsd === null ? 'unknown' : usd(breakdown.costUsd);
  const margin =
    breakdown.costUsd === null || breakdown.revenueUsd === 0
      ? 'n/a'
      : `${(((breakdown.revenueUsd - breakdown.costUsd) / breakdown.revenueUsd) * 100).toFixed(1)}%`;

  return (
    `[Cost] ${analysisType} model=${model} ` +
    `prompt=${breakdown.promptTokens} cached=${breakdown.cachedTokens} completion=${breakdown.completionTokens} ` +
    `reasoning=${breakdown.reasoningTokens} ` +
    `cost=${cost} revenue=${usd(breakdown.revenueUsd)} margin=${margin}` +
    (breakdown.overBudget ? ' ⚠️ CUSTO ACIMA DA RECEITA' : '')
  );
}
