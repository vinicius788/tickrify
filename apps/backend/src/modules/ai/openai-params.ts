/**
 * Compatibilidade de parâmetros entre famílias de modelo da OpenAI.
 *
 * Dois erros 400 distintos foram descobertos testando `gpt-5.6-luna`:
 *
 *   (27/07) 400 Unsupported parameter: 'max_tokens' is not supported with this
 *           model. Use 'max_completion_tokens' instead.
 *   (29/07) 400 Unsupported value: 'temperature' does not support 0.1 with this
 *           model. Only the default (1) value is supported.
 *
 * O segundo só apareceu depois de corrigir o primeiro — cada erro esconde o
 * seguinte. Se aparecer um terceiro parâmetro incompatível, ele muda AQUI.
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
  /**
   * SÓ GPT-5+. Quanto o modelo "pensa" antes de responder. Os tokens de
   * raciocínio são invisíveis na resposta mas COBRADOS COMO SAÍDA, então este
   * parâmetro é, na prática, o controle de custo por análise.
   *
   * É ele que permite diferenciar deep de quick sem trocar de modelo: rodar os
   * dois no `luna` com esforços diferentes custa muito menos que subir o deep
   * para o `terra` — o teto local de 32K tokens de saída custa até ~US$ 0,424
   * com 20K tokens de entrada nos preços Standard de 23/09/2026, muito perto
   * da receita teórica de um deep (3 ticks = US$ 0,435), antes de outros custos.
   * Isso não é margem validada; conferir tokens reais e preço vigente.
   *
   * Troca velocidade por profundidade: esforço alto pode estourar o
   * ANALYZE_TIMEOUT_MS (default 55s) e virar ERRO, não espera. Subir o esforço
   * sem subir o timeout junto é trocar qualidade por falha.
   *
   * Omitido = o padrão da OpenAI. É o comportamento de hoje.
   */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
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
    // Só existe nos modelos de raciocínio. Mandar para a família 4o dá 400.
    if (opts.reasoningEffort) params.reasoning_effort = opts.reasoningEffort;
    // `seed` é rejeitado: a OpenAI não garante determinismo entre rotas nos
    // modelos de raciocínio. O pareamento do backtest não depende disso — ele
    // vem da amostragem (seed 20260713 no manifest), não da chamada de API.
    //
    // `temperature` e `top_p` TAMBÉM são rejeitados. Medido em 29/07/2026 com
    // gpt-5.6-luna:
    //   400 Unsupported value: 'temperature' does not support 0.1 with this
    //       model. Only the default (1) value is supported.
    // Ou seja: nesses modelos NÃO existe controle de sampling. A consistência
    // entre análises tem de vir do PROMPT (regras determinísticas, aritmética
    // declarada), não de temperatura baixa. Enviar qualquer um dos dois derruba
    // 100% das chamadas — é falha total, não degradação.
  } else {
    params.max_tokens = opts.maxTokens;
    if (opts.seed !== undefined) params.seed = opts.seed;
    if (opts.temperature !== undefined) params.temperature = opts.temperature;
    if (opts.topP !== undefined) params.top_p = opts.topP;
  }

  return params;
}

/**
 * Resolve o modelo por tipo de análise.
 *
 * Antes existia só `AI_MODEL`, que sobrescrevia quick E deep ao mesmo tempo —
 * migrar o quick para GPT-5 achatava o deep junto e matava a diferença que
 * justifica cobrar 3 ticks por ele.
 *
 * Ordem de precedência (a primeira que existir vence):
 *   1. AI_MODEL_QUICK / AI_MODEL_DEEP  — controle por tipo (preferido)
 *   2. AI_MODEL                        — override global (usado pelo backtest)
 *   3. padrão histórico                — gpt-4o-mini (quick) / gpt-4o (deep)
 *
 * ATENÇÃO ao padrão do deep: `gpt-4o` tem shutdown marcado pela OpenAI para
 * 23/10/2026. Migrar antes disso não é opcional.
 */
/**
 * Esforço de raciocínio por tipo de análise, via env.
 *
 *   AI_REASONING_EFFORT_QUICK / AI_REASONING_EFFORT_DEEP
 *
 * NENHUMA setada = undefined = padrão da OpenAI = exatamente o comportamento de
 * hoje. Nada muda em produção até alguém decidir que muda.
 *
 * Valor inválido é IGNORADO em vez de repassado: um typo no painel do Render
 * derrubaria 100% das análises com 400, e falha total por causa de digitação
 * não é um modo de falha aceitável para uma variável de ajuste fino.
 */
const VALID_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof VALID_EFFORTS)[number];

export function resolveReasoningEffort(
  analysisType: 'quick' | 'deep' | string,
): ReasoningEffort | undefined {
  const isDeep = analysisType === 'deep';
  const raw = (isDeep
    ? process.env.AI_REASONING_EFFORT_DEEP
    : process.env.AI_REASONING_EFFORT_QUICK
  )?.trim().toLowerCase();
  return (VALID_EFFORTS as readonly string[]).includes(raw || '')
    ? (raw as ReasoningEffort)
    : undefined;
}

export function resolveModel(analysisType: 'quick' | 'deep' | string): string {
  const isDeep = analysisType === 'deep';
  const perType = isDeep ? process.env.AI_MODEL_DEEP : process.env.AI_MODEL_QUICK;
  const chosen = (perType || process.env.AI_MODEL || '').trim();
  if (chosen) return chosen;
  return isDeep ? 'gpt-4o' : 'gpt-4o-mini';
}
