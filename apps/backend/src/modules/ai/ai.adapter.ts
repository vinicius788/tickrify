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

type SchemaRecommendation = 'COMPRA' | 'VENDA' | 'AGUARDAR';
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

function mapSchemaRecommendationToInternal(value: SchemaRecommendation): Recommendation {
  if (value === 'COMPRA') {
    return 'BUY';
  }

  if (value === 'VENDA') {
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
    recommendationRaw === 'COMPRA' ||
    recommendationRaw === 'VENDA' ||
    recommendationRaw === 'AGUARDAR'
  ) {
    return recommendationRaw;
  }
  return 'AGUARDAR';
}

function normalizeSchemaBias(value: unknown): SchemaMarketBias {
  const biasRaw = String(value || '').trim().toLowerCase();
  if (biasRaw === 'bullish' || biasRaw === 'bearish' || biasRaw === 'neutral') {
    return biasRaw;
  }
  return 'neutral';
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

  async analyzeImage(
    imageUrl: string,
    prompt: string,
    analysisType: AnalysisType = 'quick',
  ): Promise<AIAnalysisResponse> {
    try {
      const signedImageUrl = await this.resolveImageUrlForOpenAi(imageUrl);
      const model =
        process.env.AI_MODEL ||
        (analysisType === 'deep' ? 'gpt-4o' : 'gpt-4o-mini');
      const response = await this.openai.chat.completions.create({
        model,
        max_tokens: 2000,
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
                  enum: ['COMPRA', 'VENDA', 'AGUARDAR'],
                },
                confidence: { type: 'number' },
                analysis: {
                  type: 'object',
                  properties: {
                    symbol: { type: 'string' },
                    timeframe: { type: 'string' },
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

      const content = String(response.choices[0]?.message?.content || '').trim();
      if (!content) {
        throw new Error('OpenAI retornou conteúdo vazio para análise.');
      }

      const parsed = parseSchemaResult(content);
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
      this.logger.error(
        `AI analysis failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new Error('Failed to analyze image with AI');
    }
  }
}
