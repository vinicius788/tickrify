import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AIAnalysisResponse } from '../../common/interfaces/ai-response.interface';
import {
  Recommendation,
  normalizeConfidence,
  parseJsonFromContent,
} from '../../common/utils/analysis-normalizer';
import { AnalysisType } from '../ticks/tick-packages';

type SchemaRecommendation = 'BUY' | 'SELL' | 'HOLD' | 'COMPRA' | 'VENDA' | 'AGUARDAR';
type SchemaMarketBias = 'bullish' | 'bearish' | 'neutral';

interface TradingAnalysisMarketStructure {
  bias: SchemaMarketBias;
  lastStructure: string;
  breakOfStructure: string;
  priceZone: string;
  orderBlock: string;
}

interface TradingAnalysisDetails {
  symbol: string;
  timeframe: string;
  detectedSession: string;
  sessionNote: string;
  currentPrice: number;
  entry: number | null;
  stopLoss: number | null;
  stopLossPercent: number | null;
  takeProfit1: number | null;
  takeProfit1Percent: number | null;
  takeProfit2: number | null;
  takeProfit2Percent: number | null;
  riskRewardRatio: string | null;
  marketStructure: TradingAnalysisMarketStructure;
  chartType: string;
  confluenceScore: number;
  factorsPresent: number;
  technicalAnalysis: string;
  keyIndicators: string;
  identifiedPatterns: string;
  structureValidation: string;
  riskFactors: string;
  whyNotOpposite: string;
  executiveSummary: string;
  reasoning: string;
  invalidationLevel: number | null;
  invalidationNote: string | null;
  entryType: string | null;
  entryCondition: string | null;
  partialExitStrategy: string | null;
  alternativeScenario: string | null;
  trendStrength: string | null;
  trendStrengthNote: string | null;
  multiTimeframeAlignment: string | null;
}

interface TradingAnalysisSchemaResult {
  is_financial_chart?: boolean;
  recommendation: SchemaRecommendation;
  confidence: number;
  analysis: TradingAnalysisDetails;
}

interface SupabaseObjectReference {
  bucket: string;
  path: string;
}

export type AIAnalysisErrorCode =
  | 'openai_empty_content'
  | 'openai_invalid_json'
  | 'openai_truncated_response'
  | 'openai_refusal'
  | 'openai_billing'
  | 'openai_rate_limit'
  | 'openai_request_failed'
  | 'non_chart_image';

export class AIAnalysisError extends Error {
  readonly code: AIAnalysisErrorCode;
  readonly retriable: boolean;
  readonly status?: number;
  readonly rawContent?: string;

  constructor(params: {
    message: string;
    code: AIAnalysisErrorCode;
    retriable: boolean;
    status?: number;
    rawContent?: string;
  }) {
    super(params.message);
    this.name = 'AIAnalysisError';
    this.code = params.code;
    this.retriable = params.retriable;
    this.status = params.status;
    this.rawContent = params.rawContent;
  }

  static isRetryable(error: unknown): boolean {
    return (
      error instanceof AIAnalysisError &&
      error.code === 'openai_rate_limit' &&
      error.retriable === true
    );
  }

  static toUserMessage(error: unknown): string {
    if (!(error instanceof AIAnalysisError)) {
      return 'Erro na análise. Tente novamente.';
    }

    switch (error.code) {
      case 'non_chart_image':
        return error.message;
      case 'openai_billing':
        return 'Limite de análises atingido. Tente novamente mais tarde.';
      case 'openai_rate_limit':
        return 'Serviço temporariamente sobrecarregado. Aguarde alguns segundos.';
      case 'openai_truncated_response':
        return 'Análise incompleta. Tente com um gráfico mais simples.';
      case 'openai_empty_content':
        return 'Não foi possível analisar a imagem. Tente novamente.';
      case 'openai_request_failed':
        return 'O serviço de IA demorou demais para responder. Tente novamente em alguns instantes.';
      default:
        return 'Erro na análise. Tente novamente.';
    }
  }
}

function mapSchemaRecommendationToInternal(value: SchemaRecommendation): Recommendation {
  if (value === 'BUY' || value === 'COMPRA') {
    return 'BUY';
  }

  if (value === 'SELL' || value === 'VENDA') {
    return 'SELL';
  }

  return 'WAIT';
}

function ensureString(value: unknown, fallback: string): string {
  const text = String(value || '').trim();
  return text || fallback;
}

function ensureNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function ensureNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeSchemaRecommendation(value: unknown): SchemaRecommendation {
  const recommendationRaw = String(value || '').trim().toUpperCase();
  if (
    recommendationRaw === 'BUY' ||
    recommendationRaw === 'SELL' ||
    recommendationRaw === 'HOLD' ||
    recommendationRaw === 'COMPRA' ||
    recommendationRaw === 'VENDA' ||
    recommendationRaw === 'AGUARDAR'
  ) {
    return recommendationRaw as SchemaRecommendation;
  }
  return 'HOLD';
}

function normalizeSchemaBias(value: unknown): SchemaMarketBias {
  const biasRaw = String(value || '').trim().toLowerCase();
  if (biasRaw === 'bullish' || biasRaw === 'bearish' || biasRaw === 'neutral') {
    return biasRaw;
  }
  return 'neutral';
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

  return String(content || '').trim();
}

/**
 * Garante que uma promise seja resolvida ou rejeitada em no máximo `ms` milissegundos.
 * Mais confiável do que o timeout interno do SDK OpenAI, que pode não funcionar em todos
 * os ambientes (ex.: quando o servidor aceita a conexão mas demora a enviar a resposta).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timeoutId); resolve(value); },
      (error) => { clearTimeout(timeoutId); reject(error); },
    );
  });
}

/**
 * Tenta reparar JSON truncado fechando colchetes/chaves abertas.
 * O OpenAI às vezes atinge o limite de tokens com o JSON quase completo (faltando apenas `}`).
 * Se o reparo fechar o JSON e ele passar o parse, usamos o resultado em vez de jogar fora.
 */
function repairTruncatedJson(content: string): string | null {
  try {
    let repaired = content.trimEnd();

    // Remove trailing comma/whitespace antes de fechar estruturas
    repaired = repaired.replace(/,\s*$/, '');

    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escape = false;

    for (const char of repaired) {
      if (escape) { escape = false; continue; }
      if (char === '\\' && inString) { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (char === '{') openBraces++;
      else if (char === '}') openBraces--;
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets--;
    }

    // Fecha estruturas abertas na ordem correta (primeiro arrays, depois objetos)
    for (let i = 0; i < openBrackets; i++) repaired += ']';
    for (let i = 0; i < openBraces; i++) repaired += '}';

    // Valida que agora é JSON válido
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

function parseSchemaResult(content: string): TradingAnalysisSchemaResult {
  const parsed = parseJsonFromContent(content);

  if (!parsed) {
    throw new Error('Resposta da OpenAI não retornou JSON válido.');
  }

  const parsedAnalysis =
    parsed.analysis && typeof parsed.analysis === 'object' && !Array.isArray(parsed.analysis)
      ? (parsed.analysis as Record<string, unknown>)
      : {};

  const parsedMarketStructure =
    parsedAnalysis.marketStructure &&
    typeof parsedAnalysis.marketStructure === 'object' &&
    !Array.isArray(parsedAnalysis.marketStructure)
      ? (parsedAnalysis.marketStructure as Record<string, unknown>)
      : {};

  return {
    recommendation: normalizeSchemaRecommendation(parsed.recommendation),
    confidence: ensureNumber(parsed.confidence, 0),
    analysis: {
      symbol: ensureString(parsedAnalysis.symbol, 'UNKNOWN'),
      timeframe: ensureString(parsedAnalysis.timeframe, 'UNKNOWN'),
      detectedSession: ensureString(parsedAnalysis.detectedSession, 'unknown'),
      sessionNote: ensureString(parsedAnalysis.sessionNote, 'Contexto de sessão não informado.'),
      currentPrice: ensureNumber(parsedAnalysis.currentPrice, 0),
      entry: ensureNumberOrNull(parsedAnalysis.entry),
      stopLoss: ensureNumberOrNull(parsedAnalysis.stopLoss),
      stopLossPercent: ensureNumberOrNull(parsedAnalysis.stopLossPercent),
      takeProfit1: ensureNumberOrNull(parsedAnalysis.takeProfit1),
      takeProfit1Percent: ensureNumberOrNull(parsedAnalysis.takeProfit1Percent),
      takeProfit2: ensureNumberOrNull(parsedAnalysis.takeProfit2),
      takeProfit2Percent: ensureNumberOrNull(parsedAnalysis.takeProfit2Percent),
      riskRewardRatio:
        parsedAnalysis.riskRewardRatio === null || parsedAnalysis.riskRewardRatio === undefined
          ? null
          : ensureString(parsedAnalysis.riskRewardRatio, ''),
      marketStructure: {
        bias: normalizeSchemaBias(parsedMarketStructure.bias),
        lastStructure: ensureString(parsedMarketStructure.lastStructure, 'Não informado'),
        breakOfStructure: ensureString(parsedMarketStructure.breakOfStructure, 'Não informado'),
        priceZone: ensureString(parsedMarketStructure.priceZone, 'Não informado'),
        orderBlock: ensureString(parsedMarketStructure.orderBlock, 'Não informado'),
      },
      chartType: ensureString(parsedAnalysis.chartType, 'Não informado'),
      confluenceScore: ensureNumber(parsedAnalysis.confluenceScore, 0),
      factorsPresent: ensureNumber(parsedAnalysis.factorsPresent, 0),
      technicalAnalysis: ensureString(parsedAnalysis.technicalAnalysis, 'Análise técnica indisponível.'),
      keyIndicators: ensureString(parsedAnalysis.keyIndicators, 'Indicadores não informados.'),
      identifiedPatterns: ensureString(parsedAnalysis.identifiedPatterns, 'Padrões não informados.'),
      structureValidation: ensureString(parsedAnalysis.structureValidation, 'Validação estrutural não informada.'),
      riskFactors: ensureString(parsedAnalysis.riskFactors, 'Fatores de risco não informados.'),
      whyNotOpposite: ensureString(parsedAnalysis.whyNotOpposite, 'Sem justificativa para o lado oposto.'),
      executiveSummary: ensureString(parsedAnalysis.executiveSummary, 'Resumo executivo indisponível.'),
      reasoning: ensureString(parsedAnalysis.reasoning, 'Sem justificativa gerada.'),
      invalidationLevel: parsedAnalysis.invalidationLevel != null ? Number(parsedAnalysis.invalidationLevel) : null,
      invalidationNote: parsedAnalysis.invalidationNote != null ? ensureString(parsedAnalysis.invalidationNote, '') || null : null,
      entryType: parsedAnalysis.entryType != null ? ensureString(parsedAnalysis.entryType, '') || null : null,
      entryCondition: parsedAnalysis.entryCondition != null ? ensureString(parsedAnalysis.entryCondition, '') || null : null,
      partialExitStrategy: parsedAnalysis.partialExitStrategy != null ? ensureString(parsedAnalysis.partialExitStrategy, '') || null : null,
      alternativeScenario: parsedAnalysis.alternativeScenario != null ? ensureString(parsedAnalysis.alternativeScenario, '') || null : null,
      trendStrength: parsedAnalysis.trendStrength != null ? ensureString(parsedAnalysis.trendStrength, '') || null : null,
      trendStrengthNote: parsedAnalysis.trendStrengthNote != null ? ensureString(parsedAnalysis.trendStrengthNote, '') || null : null,
      multiTimeframeAlignment: parsedAnalysis.multiTimeframeAlignment != null ? ensureString(parsedAnalysis.multiTimeframeAlignment, '') || null : null,
    },
  };
}

@Injectable()
export class AIAdapter {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(AIAdapter.name);
  private readonly supabaseClient: SupabaseClient | null;
  private readonly defaultStorageBucket: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY || 'OPENAI_API_KEY_PLACEHOLDER';
    const supabaseUrl = process.env.SUPABASE_URL?.trim() || '';
    const supabaseServiceKey =
      process.env.SUPABASE_SERVICE_KEY?.trim() ||
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      '';

    if (!process.env.OPENAI_API_KEY) {
      this.logger.warn(
        'OPENAI_API_KEY not configured. Using a dummy key. AI analysis will not work in production.',
      );
    }

    this.openai = new OpenAI({ apiKey });
    this.defaultStorageBucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'analysis-images';
    this.supabaseClient =
      supabaseUrl && supabaseServiceKey
        ? createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
  }

  private parseSupabaseObjectReference(imageUrl: string): SupabaseObjectReference | null {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return null;
    }

    const publicPathMatch = parsedUrl.pathname.match(
      /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/,
    );
    if (publicPathMatch) {
      return {
        bucket: decodeURIComponent(publicPathMatch[1]),
        path: decodeURIComponent(publicPathMatch[2]),
      };
    }

    const signedPathMatch = parsedUrl.pathname.match(
      /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/,
    );
    if (signedPathMatch) {
      return {
        bucket: decodeURIComponent(signedPathMatch[1]),
        path: decodeURIComponent(signedPathMatch[2]),
      };
    }

    const genericPathMatch = parsedUrl.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (!genericPathMatch) {
      return null;
    }

    const [bucket, ...pathParts] = genericPathMatch[2].split('/');
    if (!bucket || pathParts.length === 0) {
      return null;
    }

    return {
      bucket: decodeURIComponent(bucket),
      path: decodeURIComponent(pathParts.join('/')),
    };
  }

  private async resolveImageUrlForOpenAi(imageUrl: string): Promise<string> {
    if (!/^https?:\/\//i.test(imageUrl)) {
      return imageUrl;
    }

    const objectReference = this.parseSupabaseObjectReference(imageUrl);
    if (!objectReference) {
      return imageUrl;
    }

    if (!this.supabaseClient) {
      throw new Error(
        'Supabase Storage credentials are missing. Unable to generate signed URL for AI analysis.',
      );
    }

    const bucket = objectReference.bucket || this.defaultStorageBucket;
    const { data, error } = await this.supabaseClient.storage
      .from(bucket)
      .createSignedUrl(objectReference.path, 300);

    if (error || !data?.signedUrl) {
      throw new Error(
        `Failed to generate signed URL for image: ${error?.message || 'signed URL unavailable'}`,
      );
    }

    return data.signedUrl;
  }

  async *streamAnalyzeImage(
    imageUrl: string,
    prompt: string,
    analysisType: AnalysisType = 'quick',
  ): AsyncGenerator<string> {
    const signedImageUrl = await this.resolveImageUrlForOpenAi(imageUrl);
    const model =
      process.env.AI_MODEL || (analysisType === 'deep' ? 'gpt-4o' : 'gpt-4o-mini');

    const streamMaxTokens = 16384; // máximo absoluto do gpt-4o-mini
    // withTimeout garante aborto em 60s via Promise.race
    const stream = await withTimeout(this.openai.chat.completions.create({
      model,
      max_tokens: streamMaxTokens,
      temperature: 0.1,
      top_p: 0.1,
      seed: 42,
      stream: true,
      messages: [
        { role: 'system', content: String(prompt || '').trim() },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analise o gráfico e responda exclusivamente no JSON do schema. Não escreva texto fora do JSON.',
            },
            { type: 'image_url', image_url: { url: signedImageUrl, detail: 'high' } },
          ],
        },
      ],
    }), 60_000, 'OpenAI stream timed out after 60s');

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }

  async analyzeImage(
    imageUrl: string,
    prompt: string,
    analysisType: AnalysisType = 'quick',
  ): Promise<AIAnalysisResponse> {
    try {
      const signedImageUrl = await this.resolveImageUrlForOpenAi(imageUrl);

      // assertIsFinancialChart removida: adicionava 5-15s de latência em CADA análise.
      // O prompt principal já rejeita imagens inválidas via campo "non_chart_image" implícito
      // no schema. A validação prévia custava mais em latência do que poupava em tokens.
      const model =
        process.env.AI_MODEL ||
        (analysisType === 'deep' ? 'gpt-4o' : 'gpt-4o-mini');
      // quick: 8000 tokens cobre análise completa v7.0 com novos campos (~5000 tokens reais)
      // deep: 12000 tokens para análise mais detalhada
      const maxTokens = analysisType === 'deep' ? 12_000 : 8_000;
      // withTimeout garante aborto em exatamente 30s via Promise.race
      // Mais confiável do que { timeout } do SDK (que pode não funcionar em todos os ambientes)
      const response = await withTimeout(this.openai.chat.completions.create({
        model,
        max_tokens: maxTokens,
        temperature: 0.1,
        top_p: 0.1,
        seed: 42,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'trading_analysis',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                is_financial_chart: { type: 'boolean' },
                recommendation: {
                  type: 'string',
                  enum: ['BUY', 'SELL', 'HOLD', 'COMPRA', 'VENDA', 'AGUARDAR'],
                },
                confidence: { type: 'number' },
                analysis: {
                  type: 'object',
                  properties: {
                    symbol: { type: 'string' },
                    timeframe: { type: 'string' },
                    detectedSession: {
                      type: 'string',
                      enum: ['asian', 'london', 'new_york', 'overlap', 'dead_zone', 'unknown'],
                    },
                    sessionNote: { type: 'string' },
                    currentPrice: { type: 'number' },
                    entry: { type: ['number', 'null'] },
                    stopLoss: { type: ['number', 'null'] },
                    stopLossPercent: { type: ['number', 'null'] },
                    takeProfit1: { type: ['number', 'null'] },
                    takeProfit1Percent: { type: ['number', 'null'] },
                    takeProfit2: { type: ['number', 'null'] },
                    takeProfit2Percent: { type: ['number', 'null'] },
                    riskRewardRatio: { type: ['string', 'null'] },
                    marketStructure: {
                      type: 'object',
                      properties: {
                        bias: {
                          type: 'string',
                          enum: ['bullish', 'bearish', 'neutral'],
                        },
                        lastStructure: { type: 'string' },
                        breakOfStructure: { type: 'string' },
                        priceZone: { type: 'string' },
                        orderBlock: { type: 'string' },
                      },
                      required: [
                        'bias',
                        'lastStructure',
                        'breakOfStructure',
                        'priceZone',
                        'orderBlock',
                      ],
                      additionalProperties: false,
                    },
                    chartType: { type: 'string' },
                    confluenceScore: { type: 'number' },
                    factorsPresent: { type: 'number' },
                    technicalAnalysis: { type: 'string' },
                    keyIndicators: { type: 'string' },
                    identifiedPatterns: { type: 'string' },
                    structureValidation: { type: 'string' },
                    riskFactors: { type: 'string' },
                    whyNotOpposite: { type: 'string' },
                    executiveSummary: { type: 'string' },
                    reasoning: { type: 'string' },
                    invalidationLevel: { type: ['number', 'null'] },
                    invalidationNote: { type: ['string', 'null'] },
                    entryType: { type: ['string', 'null'] },
                    entryCondition: { type: ['string', 'null'] },
                    partialExitStrategy: { type: ['string', 'null'] },
                    alternativeScenario: { type: ['string', 'null'] },
                    trendStrength: { type: ['string', 'null'] },
                    trendStrengthNote: { type: ['string', 'null'] },
                    multiTimeframeAlignment: { type: ['string', 'null'] },
                  },
                  required: [
                    'symbol',
                    'timeframe',
                    'detectedSession',
                    'sessionNote',
                    'currentPrice',
                    'entry',
                    'stopLoss',
                    'stopLossPercent',
                    'takeProfit1',
                    'takeProfit1Percent',
                    'takeProfit2',
                    'takeProfit2Percent',
                    'riskRewardRatio',
                    'marketStructure',
                    'chartType',
                    'confluenceScore',
                    'factorsPresent',
                    'technicalAnalysis',
                    'keyIndicators',
                    'identifiedPatterns',
                    'structureValidation',
                    'riskFactors',
                    'whyNotOpposite',
                    'executiveSummary',
                    'reasoning',
                    'invalidationLevel',
                    'invalidationNote',
                    'entryType',
                    'entryCondition',
                    'partialExitStrategy',
                    'alternativeScenario',
                    'trendStrength',
                    'trendStrengthNote',
                    'multiTimeframeAlignment',
                  ],
                  additionalProperties: false,
                },
              },
              required: ['is_financial_chart', 'recommendation', 'confidence', 'analysis'],
              additionalProperties: false,
            },
          },
        } as any,
        messages: [
          {
            role: 'system',
            content: String(prompt || '').trim(),
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Analise o gráfico e responda exclusivamente no JSON do schema. Não escreva texto fora do JSON.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: signedImageUrl,
                  detail: 'high',
                },
              },
            ],
          },
        ],
      }), 30_000, 'OpenAI analysis timed out after 30s');

      const choice = response.choices[0];
      const finishReason = String(choice?.finish_reason || '').trim().toLowerCase();
      const refusal =
        choice?.message &&
        typeof (choice.message as { refusal?: unknown }).refusal === 'string'
          ? String((choice.message as { refusal?: string }).refusal || '').trim()
          : '';
      const content = extractMessageContent(choice?.message?.content);

      if (refusal) {
        throw new AIAnalysisError({
          code: 'openai_refusal',
          message: `OpenAI recusou a resposta estruturada: ${refusal}`,
          retriable: false,
          rawContent: refusal,
        });
      }

      if (!content) {
        throw new AIAnalysisError({
          code: 'openai_empty_content',
          message: 'OpenAI retornou conteúdo vazio para análise.',
          retriable: false,
        });
      }

      // Se truncado, tenta reparar o JSON antes de falhar
      // O modelo às vezes gera todos os dados mas falta apenas o `}` final
      let contentToParse = content;
      if (finishReason === 'length') {
        const repaired = repairTruncatedJson(content);
        if (repaired) {
          contentToParse = repaired;
          this.logger.warn('[AIAdapter] Resposta truncada pelo OpenAI — JSON reparado com sucesso');
        }
      }

      let parsed: TradingAnalysisSchemaResult;
      try {
        parsed = parseSchemaResult(contentToParse);
        if (finishReason === 'length') {
          this.logger.warn('[AIAdapter] Análise salva após reparação de JSON truncado');
        }
      } catch (error) {
        // Se truncado e reparo falhou → erro específico
        if (finishReason === 'length') {
          throw new AIAnalysisError({
            code: 'openai_truncated_response',
            message: 'OpenAI truncou a resposta antes de concluir o JSON do schema.',
            retriable: false,
            rawContent: content,
          });
        }
        throw new AIAnalysisError({
          code: 'openai_invalid_json',
          message:
            error instanceof Error
              ? error.message
              : 'Resposta da OpenAI não retornou JSON válido.',
          retriable: false,
          rawContent: content,
        });
      }

      // Se a IA sinalizou que a imagem não é um gráfico financeiro → rejeitar imediatamente
      if (parsed.is_financial_chart === false) {
        throw new AIAnalysisError({
          code: 'non_chart_image',
          message: 'A imagem enviada não parece ser um gráfico financeiro. Envie um print do seu gráfico de trading.',
          retriable: false,
        });
      }

      const recommendation = mapSchemaRecommendationToInternal(parsed.recommendation);
      const confidence = normalizeConfidence(parsed.confidence, 50);

      return {
        recommendation,
        bias: parsed.analysis.marketStructure.bias,
        confidence,
        reasoning: parsed.analysis.reasoning,
        analysis: parsed.analysis,
        drawingPlan: null,
        drawingFailed: true,
        rawResponse: parsed,
        rawContent: content,
      };
    } catch (error) {
      if (error instanceof AIAnalysisError) {
        const details = [
          `code=${error.code}`,
          error.status ? `status=${error.status}` : null,
          error.rawContent ? `raw=${error.rawContent.slice(0, 500)}` : null,
        ]
          .filter(Boolean)
          .join(' ');

        this.logger.error(`AI analysis failed: ${error.message}${details ? ` ${details}` : ''}`);
        throw error;
      }

      const status =
        typeof (error as { status?: unknown })?.status === 'number'
          ? Number((error as { status?: number }).status)
          : undefined;
      const message = error instanceof Error ? error.message : 'unknown error';
      const loweredMessage = message.toLowerCase();
      const isBillingError =
        status === 429 &&
        (loweredMessage.includes('account is not active') ||
          loweredMessage.includes('billing') ||
          loweredMessage.includes('quota'));
      // Timeout do SDK OpenAI: APIConnectionTimeoutError (status undefined, message contém "timeout")
      const isTimeoutError =
        !status &&
        (loweredMessage.includes('timeout') ||
          loweredMessage.includes('timed out') ||
          (error instanceof Error && error.constructor?.name === 'APIConnectionTimeoutError'));
      const aiError = new AIAnalysisError({
        code: isBillingError
          ? 'openai_billing'
          : status === 429
            ? 'openai_rate_limit'
            : 'openai_request_failed',
        message: isTimeoutError
          ? 'OpenAI demorou demais para responder. Tente novamente em instantes.'
          : message,
        // Timeout é retriable=true: BullMQ vai tentar novamente automaticamente (sem custar tick)
        retriable: isTimeoutError || (status === 429 ? !isBillingError : Boolean(status && status >= 500)),
        status,
      });

      this.logger.error(
        `AI analysis failed: ${aiError.message} code=${aiError.code}${
          aiError.status ? ` status=${aiError.status}` : ''
        }`,
      );
      throw aiError;
    }
  }
}
