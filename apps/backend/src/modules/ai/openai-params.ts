/**
 * Compatibilidade de parâmetros entre famílias de modelo da OpenAI.
 *
 * Descoberto no piloto de 27/07/2026, ao testar `gpt-5.6-luna`:
 *
 *   400 Unsupported parameter: 'max_tokens' is not supported with this model.
 *       Use 'max_completion_tokens' instead.
 *
 * A família GPT-5 renomeou o limite de saída (porque os modelos de raciocínio
 * gastam tokens internos invisíveis, então "max_tokens" deixou de descrever o
 * que o campo faz) e não aceita mais `seed`.
 *
 * Isto NÃO é só para o backtest: o `gpt-4o` usado no deep tem shutdown marcado
 * pela OpenAI para 23/10/2026. A migração para GPT-5.x é obrigatória, e quando
 * ela acontecer todos os call sites já vão estar prontos.
 *
 * Centralizado de propósito: se aparecer mais um parâmetro incompatível, muda
 * numa função só em vez de caçar por três lugares no adapter.
 */

/** GPT-5 em diante. Cobre gpt-5, gpt-5.4, gpt-5.6-luna/terra/sol, gpt-6... */
export function isNextGenModel(model: string): boolean {
  return /^gpt-[5-9]/i.test(String(model || '').trim());
}

export interface SamplingOptions {
  /** Limite de tokens de saída. Vira max_tokens ou max_completion_tokens. */
  maxTokens: number;
  temperature?: number;
  topP?: number;
  /** Ignorado nos modelos GPT-5+, que rejeitam o parâmetro. */
  seed?: number;
}

/**
 * Monta os parâmetros de amostragem certos para o modelo alvo.
 * Use com spread: `{ model, ...buildSamplingParams(model, {...}) }`.
 */
export function buildSamplingParams(
  model: string,
  opts: SamplingOptions,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (isNextGenModel(model)) {
    params.max_completion_tokens = opts.maxTokens;
    // `seed` é rejeitado: a OpenAI não garante determinismo entre rotas nos
    // modelos de raciocínio. O pareamento do backtest não depende disso — ele
    // vem da amostragem (seed 20260713 no manifest), não da chamada de API.
  } else {
    params.max_tokens = opts.maxTokens;
    if (opts.seed !== undefined) params.seed = opts.seed;
  }

  if (opts.temperature !== undefined) params.temperature = opts.temperature;
  if (opts.topP !== undefined) params.top_p = opts.topP;

  return params;
}
