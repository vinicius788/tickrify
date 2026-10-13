import type OpenAI from 'openai';
import { extractUsage, type TokenUsage } from './model-cost';
import { buildSamplingParams, type ReasoningEffort } from './openai-params';

// ============================================================================
// CHAMADA AO MODELO DE VISAO — interface unica do provedor (12/10/2026)
// ----------------------------------------------------------------------------
// O adapter monta o pedido (instrucoes, contexto, imagens, schema) e le a
// resposta; so esta implementacao sabe falar com a OpenAI. Trocar de provedor
// = escrever outra classe com `complete()` e passar no lugar desta.
//
// Ordem fixa para o cache de prompt do provedor: `instructions` (igual em toda
// analise do mesmo prompt e idioma) vai primeiro, `context` (grounding e
// perfil, muda por analise) logo depois, e as imagens por ultimo.
// ============================================================================

export type VisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string };

export interface VisionModelRequest {
  model: string;
  /** Parte fixa: instrucoes, regras e formato. */
  instructions: string;
  /** Parte variavel do texto, depois da fixa. Blocos vazios sao ignorados. */
  context: string[];
  /** Mensagem do usuario: texto curto e as imagens. */
  userContent: VisionContentPart[];
  /** Saida estruturada: a ordem das chaves e a ordem de geracao (CLAUDE.md 4.1). */
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  reasoningEffort?: ReasoningEffort;
  timeoutMs: number;
}

export interface VisionModelResult {
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

export function extractMessageContent(content: unknown): string {
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
    // Mesmas mensagens de antes da interface: system = instrucoes + contexto,
    // user = texto + imagens em detalhe alto.
    const system = [request.instructions, ...request.context]
      .filter((block) => block && block.trim().length > 0)
      .join('\n\n')
      .trim();
    const userContent = request.userContent.map((part) =>
      part.type === 'image'
        ? { type: 'image_url', image_url: { url: part.url, detail: 'high' } }
        : { type: 'text', text: part.text },
    );

    const started = Date.now();
    const response = await withTimeout((signal) => this.client.chat.completions.create({
      model: request.model,
      // GPT-5+ exige max_completion_tokens e rejeita seed — ver openai-params.ts
      ...buildSamplingParams(request.model, {
        maxTokens: request.maxTokens,
        temperature: 0.1,
        topP: 0.1,
        seed: 42,
        reasoningEffort: request.reasoningEffort,
      }),
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName, strict: true, schema: request.schema },
      } as any,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent as any },
      ],
    }, { signal }), request.timeoutMs, `OpenAI analysis timed out after ${Math.round(request.timeoutMs / 1000)}s`);
    const modelMs = Date.now() - started;

    const choice = response.choices[0];
    const refusal =
      choice?.message && typeof (choice.message as { refusal?: unknown }).refusal === 'string'
        ? String((choice.message as { refusal?: string }).refusal || '').trim()
        : '';

    return {
      content: extractMessageContent(choice?.message?.content),
      finishReason: String(choice?.finish_reason || '').trim().toLowerCase(),
      refusal,
      usage: extractUsage((response as { usage?: unknown }).usage),
      respondedModel: typeof response.model === 'string' ? response.model : null,
      modelMs,
    };
  }
}
