import type OpenAI from 'openai';
import { captureServer } from '../../common/analytics/posthog';
import { extractUsage, type TokenUsage } from './model-cost';
import { buildSamplingParams, resolveModel, type ReasoningEffort } from './openai-params';

// ============================================================================
// CAMADA UNICA DO PROVEDOR DE IA (12/10/2026; provedores e contingencia 13/10)
// ----------------------------------------------------------------------------
// Toda chamada a modelo (analise, eixo de preco da extensao, leitura do
// simbolo) passa por `VisionModel.complete()`. Nada fora deste arquivo fala com
// a OpenAI ou a Anthropic. O adapter monta o pedido (instrucoes, contexto,
// imagens, schema) e le a resposta, que vem no mesmo formato de qualquer
// provedor.
//
// Escolha do provedor (`createVisionModels`):
//   - AI_PROVIDER = openai (padrao) | anthropic.
//   - A Anthropic so existe com ANTHROPIC_API_KEY. Sem a chave ela nao e
//     criada, nao loga e nao e chamada: com so a OpenAI, tudo e como antes.
//   - Havendo os dois, o outro vira contingencia: erro, timeout ou limite no
//     ativo -> a mesma chamada vai ao outro (FallbackVisionModel).
//   - Modelo por tarefa: OpenAI pelo `resolveModel` (AI_MODEL_QUICK/DEEP);
//     Anthropic por ANTHROPIC_MODEL_QUICK/DEEP. A leitura do simbolo usa o quick.
//
// Ordem fixa para o cache de prompt do provedor: `instructions` (igual em toda
// analise do mesmo prompt e idioma) vai primeiro, `context` (grounding e
// perfil, muda por analise) logo depois, e as imagens por ultimo. A OpenAI
// cacheia o prefixo sozinha; na Anthropic o bloco das instrucoes leva
// `cache_control`.
// ============================================================================

export type VisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string };

/** quick/deep = analise (o quick tambem le simbolo, eixo e gerenciamento). */
export type ModelTier = 'quick' | 'deep';

export interface VisionModelRequest {
  tier: ModelTier;
  /** Parte fixa: instrucoes, regras e formato. Vazia = sem mensagem de sistema. */
  instructions: string;
  /** Parte variavel do texto, depois da fixa. Blocos vazios sao ignorados. */
  context: string[];
  /** Mensagem do usuario: texto curto e as imagens. */
  userContent: VisionContentPart[];
  /**
   * Saida estruturada: a ordem das chaves e a ordem de geracao (CLAUDE.md 4.1).
   * Sem schema, o provedor pede so um objeto JSON livre.
   */
  schemaName?: string;
  schema?: Record<string, unknown>;
  maxTokens: number;
  reasoningEffort?: ReasoningEffort;
  /** Amostragem, so nos modelos que aceitam (ver openai-params.ts). */
  sampling?: { temperature?: number; topP?: number; seed?: number };
  /** Detalhe da imagem na OpenAI. Padrao: high. */
  imageDetail?: 'high' | 'low';
  timeoutMs: number;
}

export interface VisionModelResult {
  /** Quem respondeu e com qual modelo (pedido). */
  provider: string;
  model: string;
  content: string;
  /** Normalizado: 'stop' (terminou) ou 'length' (truncou), como a OpenAI chama. */
  finishReason: string;
  refusal: string;
  usage: TokenUsage;
  respondedModel: string | null;
  /** Tempo da chamada ao provedor, do envio ao fim da resposta. */
  modelMs: number;
}

export interface VisionModel {
  readonly provider: string;
  complete(request: VisionModelRequest): Promise<VisionModelResult>;
}

/**
 * Corrida contra o relogio que ABORTA a requisicao no estouro.
 *
 * Com Promise.race a requisicao perdedora continuava viva: segurando socket,
 * gastando CPU no parse e sendo COBRADA em tokens. Como o BullMQ retenta
 * (`attempts: 3`), a segunda tentativa comecava com a primeira ainda em voo.
 * Com `concurrency: 3` num container de 0.1 CPU isso empilhava ate 9
 * requisicoes orfas e era o mecanismo que fazia "lento" virar "muito mais
 * lento" em cascata sob carga.
 *
 * Passando uma FUNCAO em vez de uma promise, o AbortSignal chega ao SDK e a
 * conexao morre de verdade no timeout. As chamadas que ainda passam uma promise
 * (enriquecimento, calendario) mantem o comportamento antigo: sao composicoes
 * de varios fetches, onde nao existe um unico socket para abortar.
 */
export function withTimeout<T>(
  input: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  ms: number,
  message: string,
): Promise<T> {
  const controller = typeof input === 'function' ? new AbortController() : null;
  const promise = typeof input === 'function' ? input(controller!.signal) : input;

  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      controller?.abort(new Error(message));
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timeoutId); resolve(value); },
      (error) => { clearTimeout(timeoutId); reject(error); },
    );
  });
}

function extractMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object' && 'text' in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }

        return '';
      })
      .join('\n')
      .trim();
  }

  return '';
}

export class OpenAiVisionModel implements VisionModel {
  readonly provider = 'openai';

  constructor(private readonly client: OpenAI) {}

  async complete(request: VisionModelRequest): Promise<VisionModelResult> {
    const model = resolveModel(request.tier);
    // Mesmas mensagens de antes da interface: system = instrucoes + contexto,
    // user = texto + imagens (detalhe alto, salvo pedido contrario).
    const system = [request.instructions, ...request.context]
      .filter((block) => block && block.trim().length > 0)
      .join('\n\n')
      .trim();
    const detail = request.imageDetail ?? 'high';
    const userContent = request.userContent.map((part) =>
      part.type === 'image'
        ? { type: 'image_url', image_url: { url: part.url, detail } }
        : { type: 'text', text: part.text },
    );
    const messages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: userContent },
    ];

    const started = Date.now();
    const response = await withTimeout((signal) => this.client.chat.completions.create({
      model,
      // GPT-5+ exige max_completion_tokens e rejeita seed — ver openai-params.ts
      ...buildSamplingParams(model, {
        maxTokens: request.maxTokens,
        ...request.sampling,
        reasoningEffort: request.reasoningEffort,
      }),
      response_format: (request.schema
        ? {
            type: 'json_schema',
            json_schema: { name: request.schemaName || 'result', strict: true, schema: request.schema },
          }
        : { type: 'json_object' }) as any,
      messages: messages as any,
    }, { signal }), request.timeoutMs, `AI request timed out after ${Math.round(request.timeoutMs / 1000)}s`);
    const modelMs = Date.now() - started;

    const choice = response.choices[0];
    const refusal =
      choice?.message && typeof (choice.message as { refusal?: unknown }).refusal === 'string'
        ? String((choice.message as { refusal?: string }).refusal || '').trim()
        : '';

    return {
      provider: this.provider,
      model,
      content: extractMessageContent(choice?.message?.content),
      finishReason: String(choice?.finish_reason || '').trim().toLowerCase(),
      refusal,
      usage: extractUsage((response as { usage?: unknown }).usage),
      respondedModel: typeof response.model === 'string' ? response.model : null,
      modelMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Anthropic (Messages API por HTTP, sem SDK: nenhuma dependencia nova).
// Formato conferido em platform.claude.com em 13/10/2026:
//   - imagem: { type: 'image', source: { type: 'base64', media_type, data } }
//     ou { type: 'url', url }; jpeg/png/gif/webp.
//   - saida estruturada: output_config.format = { type: 'json_schema', schema },
//     sem cabecalho beta; JSON no bloco `text`. Limite: 16 campos com uniao de
//     tipos (["number","null"]) por requisicao.
//   - cache: cache_control { type: 'ephemeral' } no bloco do system;
//     usage.input_tokens NAO inclui cache_read/cache_creation.
//   - stop_reason: end_turn | max_tokens | refusal | stop_sequence.
// Sem temperature/top_p: os modelos novos rejeitam parte desses parametros e a
// consistencia do motor vem do prompt (igual ao GPT-5, ver openai-params.ts).
// INATIVO enquanto nao existir ANTHROPIC_API_KEY. Antes de ativar, medir no
// backtest (CLAUDE.md 4.1: motor so muda com medicao).
// ---------------------------------------------------------------------------

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_UNION_FIELDS = 16;
const ANTHROPIC_DEFAULT_MODELS: Record<ModelTier, string> = {
  quick: 'claude-sonnet-5-5',
  deep: 'claude-sonnet-5-5',
};

/** Erro de HTTP do provedor com `status`, que o adapter usa para classificar. */
class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Campos com uniao de tipos no schema (o limite da Anthropic e por requisicao). */
export function countUnionFields(schema: unknown): number {
  if (!schema || typeof schema !== 'object') return 0;
  if (Array.isArray(schema)) return schema.reduce((n: number, item) => n + countUnionFields(item), 0);
  const node = schema as Record<string, unknown>;
  const own = Array.isArray(node.type) || Array.isArray(node.anyOf) ? 1 : 0;
  return own + Object.values(node).reduce((n: number, value) => n + countUnionFields(value), 0);
}

function anthropicImageSource(url: string): Record<string, string> {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return match
    ? { type: 'base64', media_type: match[1], data: match[2] }
    : { type: 'url', url };
}

/** Sem saida estruturada o modelo pode cercar o JSON com ```json. */
function stripJsonFence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return fenced ? fenced[1].trim() : text.trim();
}

export class AnthropicVisionModel implements VisionModel {
  readonly provider = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly models: Record<ModelTier, string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(request: VisionModelRequest): Promise<VisionModelResult> {
    const model = this.models[request.tier];
    // O schema da analise tem mais campos anulaveis que o limite da saida
    // estruturada: nesse caso ele vai como texto no fim das instrucoes.
    const structured =
      request.schema && countUnionFields(request.schema) <= ANTHROPIC_MAX_UNION_FIELDS
        ? request.schema
        : null;
    const schemaAsText = request.schema && !structured
      ? `Respond with a single JSON object that follows this JSON Schema exactly, keys in this order, and nothing else:\n${JSON.stringify(request.schema)}`
      : '';

    const system: Array<Record<string, unknown>> = [];
    const fixed = [request.instructions, schemaAsText].filter((t) => t && t.trim()).join('\n\n');
    if (fixed) system.push({ type: 'text', text: fixed, cache_control: { type: 'ephemeral' } });
    for (const block of request.context) {
      if (block && block.trim()) system.push({ type: 'text', text: block });
    }

    const content = request.userContent.map((part) =>
      part.type === 'image'
        ? { type: 'image', source: anthropicImageSource(part.url) }
        : { type: 'text', text: part.text },
    );

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens,
      messages: [{ role: 'user', content }],
      ...(system.length > 0 ? { system } : {}),
      ...(structured ? { output_config: { format: { type: 'json_schema', schema: structured } } } : {}),
    };

    const started = Date.now();
    const data = await withTimeout(async (signal) => {
      const res = await this.fetchImpl(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal,
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, any>;
      if (!res.ok) {
        throw new ProviderHttpError(
          `Anthropic ${res.status}: ${String(json?.error?.message || res.statusText || 'request failed')}`,
          res.status,
        );
      }
      return json;
    }, request.timeoutMs, `AI request timed out after ${Math.round(request.timeoutMs / 1000)}s`);
    const modelMs = Date.now() - started;

    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: { type?: string }) => b?.type === 'text')
      : null;
    const text = typeof textBlock?.text === 'string' ? textBlock.text : '';
    const stop = String(data.stop_reason || '');
    const u = (data.usage || {}) as Record<string, unknown>;
    const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
    const cacheRead = n(u.cache_read_input_tokens);
    const promptTokens = n(u.input_tokens) + cacheRead + n(u.cache_creation_input_tokens);
    const completionTokens = n(u.output_tokens);

    return {
      provider: this.provider,
      model,
      content: structured ? text.trim() : stripJsonFence(text),
      finishReason: stop === 'max_tokens' ? 'length' : 'stop',
      refusal: stop === 'refusal' ? text.trim() || 'refusal' : '',
      usage: {
        promptTokens,
        cachedTokens: cacheRead,
        completionTokens,
        reasoningTokens: 0,
        totalTokens: promptTokens + completionTokens,
      },
      respondedModel: typeof data.model === 'string' ? data.model : null,
      modelMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Contingencia: a chamada vai ao outro provedor se o ativo LANCAR (rede,
// timeout, 429, 5xx, chave recusada). Resposta ruim (recusa, JSON quebrado,
// plano incoerente) nao lanca aqui: quem decide e o adapter. Sem segundo
// provedor, o erro sobe igual a antes e o adapter/BullMQ fazem o resto.
// ---------------------------------------------------------------------------

export class FallbackVisionModel implements VisionModel {
  constructor(
    readonly primary: VisionModel,
    readonly secondary: VisionModel | null,
    private readonly onFallback: (from: string, to: string, error: unknown) => void = () => undefined,
  ) {}

  get provider(): string {
    return this.primary.provider;
  }

  async complete(request: VisionModelRequest): Promise<VisionModelResult> {
    try {
      return await this.primary.complete(request);
    } catch (error) {
      if (!this.secondary) throw error;
      this.onFallback(this.primary.provider, this.secondary.provider, error);
      return this.secondary.complete(request);
    }
  }
}

export interface VisionModels {
  /** O que o adapter chama: ativo com contingencia no outro, se houver. */
  model: FallbackVisionModel;
  /** O outro provedor configurado (contingencia e modo comparacao), ou null. */
  secondary: VisionModel | null;
}

/**
 * Monta os provedores a partir do ambiente. Com so a OpenAI (o caso de hoje)
 * devolve exatamente o OpenAiVisionModel de antes, sem segundo provedor e sem
 * nenhum log.
 */
export function createVisionModels(
  openaiClient: OpenAI,
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = () => undefined,
  fetchImpl?: typeof fetch,
): VisionModels {
  const openai = new OpenAiVisionModel(openaiClient);
  const anthropicKey = String(env.ANTHROPIC_API_KEY || '').trim();
  const anthropic = anthropicKey
    ? new AnthropicVisionModel(
        anthropicKey,
        {
          quick: String(env.ANTHROPIC_MODEL_QUICK || '').trim() || ANTHROPIC_DEFAULT_MODELS.quick,
          deep: String(env.ANTHROPIC_MODEL_DEEP || '').trim() || ANTHROPIC_DEFAULT_MODELS.deep,
        },
        fetchImpl,
      )
    : null;

  const status = aiProviderStatus(env);
  if (String(env.AI_PROVIDER || '').trim().toLowerCase() === 'anthropic' && !anthropic) {
    log('[ai-provider] AI_PROVIDER=anthropic sem ANTHROPIC_API_KEY: seguindo com a OpenAI.');
  }
  // A OpenAI so entra como contingencia com chave de verdade (sem ela o
  // cliente usa um placeholder e toda chamada falharia).
  const byName: Record<string, VisionModel | null> = { openai, anthropic, none: null };
  const primary = byName[status.active] ?? openai;
  const secondary = byName[status.fallback] ?? null;

  const model = new FallbackVisionModel(primary, secondary, (from, to, error) => {
    log(`[ai-provider] ${from} falhou (${error instanceof Error ? error.message.slice(0, 200) : 'erro'}); usando ${to}.`);
  });
  return { model, secondary };
}

// ---------------------------------------------------------------------------
// Modo comparacao (AI_COMPARE_PROVIDERS=true, DESLIGADO por padrao; so roda
// com segundo provedor configurado). A mesma analise vai aos dois provedores
// em paralelo; o usuario ve SO o resultado do ativo e nunca espera pelo outro.
// Grava os dois em AdminAudit (`ai:provider_compare`) e manda latencia/tokens
// ao PostHog (`ai_provider_compared`, so numeros e enums). A conferencia
// cruzada e o campo `agree` (mesma direcao): medir antes de deixar o segundo
// provedor mudar o que o trader ve.
// ---------------------------------------------------------------------------

/** Para o /health: o que a fabrica escolheria com este ambiente (sem chamar nada). */
export function aiProviderStatus(env: NodeJS.ProcessEnv = process.env): {
  active: string;
  fallback: string;
  compare: boolean;
} {
  const anthropic = Boolean(String(env.ANTHROPIC_API_KEY || '').trim());
  const openai = Boolean(String(env.OPENAI_API_KEY || '').trim());
  const active = String(env.AI_PROVIDER || '').trim().toLowerCase() === 'anthropic' && anthropic ? 'anthropic' : 'openai';
  const fallback = active === 'openai' ? (anthropic ? 'anthropic' : 'none') : openai ? 'openai' : 'none';
  return { active, fallback, compare: fallback !== 'none' && compareProvidersEnabled(env) };
}

export function compareProvidersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AI_COMPARE_PROVIDERS || '').trim().toLowerCase() === 'true';
}

export interface ProviderRunSummary {
  provider: string;
  model: string;
  respondedModel: string | null;
  modelMs: number;
  usage: TokenUsage;
  recommendation: 'BUY' | 'SELL' | 'WAIT' | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  /** Resposta completa (JSON) do provedor, ou o erro. */
  result: unknown;
  error: string | null;
}

export interface ProviderComparison {
  primary: ProviderRunSummary;
  secondary: ProviderRunSummary;
  /** Mesma direcao nos dois (BUY/SELL/WAIT). null se um deles falhou. */
  agree: boolean | null;
}

interface AuditWriter {
  adminAudit: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

/** Grava a comparacao. Nunca lanca: medir nao derruba analise. */
export async function recordProviderComparison(
  db: AuditWriter,
  params: { analysisId: string; userId: string; comparison: Promise<ProviderComparison | null> },
  warn: (message: string) => void,
): Promise<void> {
  try {
    const c = await params.comparison;
    if (!c) return;
    await db.adminAudit.create({
      data: {
        action: 'ai:provider_compare',
        targetUserId: params.userId,
        details: JSON.parse(JSON.stringify({ analysisId: params.analysisId, ...c })),
      },
    });
    const side = (s: ProviderRunSummary, prefix: string) => ({
      [`${prefix}_provider`]: s.provider,
      [`${prefix}_model`]: s.model,
      [`${prefix}_ms`]: s.modelMs,
      [`${prefix}_prompt_tokens`]: s.usage.promptTokens,
      [`${prefix}_completion_tokens`]: s.usage.completionTokens,
      [`${prefix}_cached_tokens`]: s.usage.cachedTokens,
      [`${prefix}_recommendation`]: s.recommendation,
      [`${prefix}_failed`]: Boolean(s.error),
    });
    captureServer(params.userId, 'ai_provider_compared', {
      analysisId: params.analysisId,
      agree: c.agree,
      ...side(c.primary, 'primary'),
      ...side(c.secondary, 'secondary'),
    });
  } catch (err) {
    warn(`[ai-provider] Comparacao nao gravada: ${err instanceof Error ? err.message : err}`);
  }
}
