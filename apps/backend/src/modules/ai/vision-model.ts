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
//     tipos (["number","null"]) por requisicao, e um teto de tamanho da gramatica
//     compilada: o schema da analise com perfil de estrategia passava dele
//     ("compiled grammar is too large", 100% em producao em 23/11/2026). Por isso
//     saem os campos que ninguem usa (ANTHROPIC_UNUSED_ANALYSIS_FIELDS) e, se a
//     API ainda recusar a gramatica, o pedido vai uma vez com o schema em texto.
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
/**
 * Posicao em pixel dos niveis: a IA erra ate ~82 px e nada le (a extensao usa
 * price-axis). Fora do schema da Anthropic, a gramatica cabe com o strategyFit
 * (medido na API em 23/11/2026: com os dois campos do perfil e sem estes 4, 200).
 */
export const ANTHROPIC_UNUSED_ANALYSIS_FIELDS = ['entryY', 'stopY', 'tp1Y', 'tp2Y'] as const;
const GRAMMAR_TOO_LARGE = /compiled grammar is too large/i;
const ANTHROPIC_DEFAULT_MODELS: Record<ModelTier, string> = {
  quick: 'claude-haiku-5-5',
  deep: 'claude-haiku-5-5',
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

type NullPath = string[];

/**
 * Acima do limite de unioes, cada campo `type: [X, 'null']` vira `X` e o caminho
 * fica guardado: na resposta, 0 (numero) ou '' (texto) nesses campos volta a ser
 * null. Assim o schema inteiro cabe na saida estruturada (23/11/2026).
 */
export function collapseNullable(schema: unknown, path: NullPath = [], out: NullPath[] = []): { schema: unknown; paths: NullPath[] } {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { schema, paths: out };
  const node = { ...(schema as Record<string, unknown>) };
  if (Array.isArray(node.type) && node.type.includes('null') && node.type.length === 2) {
    node.type = (node.type as string[]).find((t) => t !== 'null');
    if (Array.isArray(node.enum)) node.enum = node.enum.filter((v) => v !== null);
    out.push(path);
  }
  if (node.properties && typeof node.properties === 'object') {
    node.properties = Object.fromEntries(
      Object.entries(node.properties as Record<string, unknown>).map(([k, v]) => [k, collapseNullable(v, [...path, k], out).schema]),
    );
  }
  if (node.items) node.items = collapseNullable(node.items, [...path, '*'], out).schema;
  if (Array.isArray(node.anyOf)) node.anyOf = node.anyOf.map((v) => collapseNullable(v, path, out).schema);
  return { schema: node, paths: out };
}

export function restoreNulls(value: unknown, paths: NullPath[]): unknown {
  const walk = (node: unknown, path: string[]): unknown => {
    if (!path.length) return node === 0 || node === '' ? null : node;
    if (node === null || typeof node !== 'object') return node;
    const [head, ...rest] = path;
    if (head === '*') return Array.isArray(node) ? node.map((n) => walk(n, rest)) : node;
    const obj = node as Record<string, unknown>;
    if (head in obj) obj[head] = walk(obj[head], rest);
    return obj;
  };
  return paths.reduce((acc, p) => walk(acc, p), value);
}

/** Tira de `analysis` os campos que nada le (o parser ja trata ausente como null). */
export function reduceAnalysisSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const props = schema.properties as Record<string, any> | undefined;
  const analysis = props?.analysis;
  if (!analysis || typeof analysis !== 'object' || !analysis.properties) return schema;
  const drop = new Set<string>(ANTHROPIC_UNUSED_ANALYSIS_FIELDS);
  const kept = Object.fromEntries(Object.entries(analysis.properties as Record<string, unknown>).filter(([k]) => !drop.has(k)));
  const required = Array.isArray(analysis.required) ? analysis.required.filter((k: string) => !drop.has(k)) : analysis.required;
  return { ...schema, properties: { ...props, analysis: { ...analysis, properties: kept, required } } };
}

/** Pedido do JSON em texto (plano B): um objeto so, na ordem do schema. */
export function anthropicJsonInstruction(schema: Record<string, unknown>): string {
  return [
    'Reply with exactly one JSON object and nothing else: no prose, no code fence.',
    'It must match this JSON Schema. Write the properties in the order the schema lists them, include every required property, and use null where the schema allows null.',
    JSON.stringify(schema),
  ].join('\n');
}

const anthropicEffort = (e: ReasoningEffort | undefined): string =>
  e === 'medium' || e === 'high' ? e : 'low';

function anthropicImageSource(url: string): Record<string, string> {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return match
    ? { type: 'base64', media_type: match[1], data: match[2] }
    : { type: 'url', url };
}

/** Sem saida estruturada o modelo pode cercar o JSON com ```json. */
export function stripJsonFence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  const body = fenced ? fenced[1].trim() : text.trim();
  if (body.startsWith('{')) return body;
  // Frase antes ou depois do objeto: fica do primeiro `{` ao ultimo `}`.
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  return first >= 0 && last > first ? body.slice(first, last + 1) : body;
}

function restoreJson(text: string, paths: NullPath[]): string {
  try {
    return JSON.stringify(restoreNulls(JSON.parse(text), paths));
  } catch {
    return text.trim();
  }
}

export class AnthropicVisionModel implements VisionModel {
  readonly provider = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly models: Record<ModelTier, string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(request: VisionModelRequest): Promise<VisionModelResult> {
    const reduced = request.schema ? reduceAnalysisSchema(request.schema) : undefined;
    try {
      return await this.send({ ...request, schema: reduced }, 'structured');
    } catch (error) {
      // Gramatica grande demais: uma vez com o schema em texto (o parser do adapter confere o JSON).
      if (reduced && error instanceof ProviderHttpError && error.status === 400 && GRAMMAR_TOO_LARGE.test(error.message)) {
        return this.send({ ...request, schema: reduced }, 'text');
      }
      throw error;
    }
  }

  private async send(request: VisionModelRequest, mode: 'structured' | 'text'): Promise<VisionModelResult> {
    const model = this.models[request.tier];
    // O schema da analise tem mais campos anulaveis que o limite da saida
    // estruturada: os anulaveis viram obrigatorios e voltam a null na resposta.
    const collapsed = mode === 'structured' && request.schema && countUnionFields(request.schema) > ANTHROPIC_MAX_UNION_FIELDS
      ? collapseNullable(request.schema)
      : { schema: mode === 'structured' ? request.schema ?? null : null, paths: [] as NullPath[] };
    const structured = collapsed.schema as Record<string, unknown> | null;
    const schemaAsText = mode === 'text' && request.schema
      ? anthropicJsonInstruction(request.schema)
      : collapsed.paths.length
        ? 'Where a field would be null, write 0 for a number and an empty string for text.'
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
      output_config: {
        effort: anthropicEffort(request.reasoningEffort),
        ...(structured ? { format: { type: 'json_schema', schema: structured } } : {}),
      },
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
      content: structured && collapsed.paths.length ? restoreJson(text, collapsed.paths) : structured ? text.trim() : stripJsonFence(text),
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
