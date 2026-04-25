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
}

interface TradingAnalysisSchemaResult {
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

    const stream = await this.openai.chat.completions.create({
      model,
      max_tokens: 4000,
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
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }

  /**
   * Verifica se a imagem é um gráfico financeiro válido antes de rodar a análise completa.
   * Usa gpt-4o-mini com uma pergunta direta para economizar tokens.
   */
  private async assertIsFinancialChart(signedImageUrl: string): Promise<void> {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 10,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Is this image a financial trading chart (candlestick, line, bar, or similar price chart)? Answer only YES or NO.',
              },
              { type: 'image_url', image_url: { url: signedImageUrl, detail: 'low' } },
            ],
          },
        ],
      });

      const answer = String(response.choices[0]?.message?.content || '').trim().toUpperCase();

      if (!answer.startsWith('YES')) {
        throw new AIAnalysisError({
          code: 'non_chart_image',
          message: 'Imagem não reconhecida como gráfico financeiro. Por favor, envie uma screenshot de um gráfico de trading (candlestick, linha ou barras).',
          retriable: false,
        });
      }
    } catch (error) {
      if (error instanceof AIAnalysisError) throw error;
      // Se a validação falhar por erro de rede/API, deixa passar e tenta a análise normal
      this.logger.warn('[AIAdapter] Chart validation skipped due to error:', error instanceof Error ? error.message : String(error));
    }
  }

  async analyzeImage(
    imageUrl: string,
    prompt: string,
    analysisType: AnalysisType = 'quick',
  ): Promise<AIAnalysisResponse> {
    try {
      const signedImageUrl = await this.resolveImageUrlForOpenAi(imageUrl);

      // Valida se é um gráfico financeiro antes de gastar tokens na análise completa
      await this.assertIsFinancialChart(signedImageUrl);
      const model =
        process.env.AI_MODEL ||
        (analysisType === 'deep' ? 'gpt-4o' : 'gpt-4o-mini');
      // Quick: 4500 tokens — o campo reasoning do schema v4.0 pode ter 1500+ tokens sozinho
      // Deep: 6000 tokens para análises mais detalhadas com CoT completo
      const maxTokens = analysisType === 'deep' ? 6000 : 4500;
      const response = await this.openai.chat.completions.create({
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
                  ],
                  additionalProperties: false,
                },
              },
              required: ['recommendation', 'confidence', 'analysis'],
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
      });

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

      if (finishReason === 'length') {
        throw new AIAnalysisError({
          code: 'openai_truncated_response',
          message: 'OpenAI truncou a resposta antes de concluir o JSON do schema.',
          retriable: false,
          rawContent: content,
        });
      }

      let parsed: TradingAnalysisSchemaResult;
      try {
        parsed = parseSchemaResult(content);
      } catch (error) {
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
      const aiError = new AIAnalysisError({
        code: isBillingError
          ? 'openai_billing'
          : status === 429
            ? 'openai_rate_limit'
            : 'openai_request_failed',
        message,
        retriable: status === 429 ? !isBillingError : Boolean(status && status >= 500),
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
