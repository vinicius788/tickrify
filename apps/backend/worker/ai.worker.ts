import 'dotenv/config';
import { Job, UnrecoverableError, Worker } from 'bullmq';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { TRADING_SYSTEM_PROMPT } from '../src/common/prompts/trading-system-prompt';
import {
  buildPersistedAnalysisPayload,
  NormalizedPersistedAnalysis,
} from '../src/common/utils/analysis-payload';
import { AIAdapter, AIAnalysisError } from '../src/modules/ai/ai.adapter';
import { ImageStorageClient } from '../src/common/utils/image-storage';
import { isProductionRuntime } from '../src/common/utils/runtime-env';
import { canUseDemoFallback, hasValidOpenAiKey } from '../src/common/utils/ai-runtime';
import { resolvePrismaDatasourceUrl } from '../src/modules/database/prisma.datasource';
import { AnalysisType } from '../src/modules/ticks/tick-packages';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: resolvePrismaDatasourceUrl(),
  }),
});
const aiAdapter = new AIAdapter();
const storage = new ImageStorageClient();

type SchemaRecommendation = 'COMPRA' | 'VENDA' | 'AGUARDAR';
type MarketBias = 'bullish' | 'bearish' | 'neutral';

interface JobData {
  analysisId: string;
  imageUrl: string;
  promptOverride?: string;
  promptVersion?: number;
  userId?: string;
  analysisType?: AnalysisType;
}

interface WorkerAnalysisMarketStructure {
  bias: MarketBias;
  lastStructure: string;
  breakOfStructure: string;
  priceZone: string;
  orderBlock: string;
}

interface WorkerAnalysisDetails {
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
  marketStructure: WorkerAnalysisMarketStructure;
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

interface WorkerAnalysisResult {
  recommendation: SchemaRecommendation;
  confidence: number;
  analysis: WorkerAnalysisDetails;
}

function getRedisConnection() {
  if (process.env.REDIS_URL) {
    try {
      const redisUrl = new URL(process.env.REDIS_URL);
      return {
        host: redisUrl.hostname,
        port: parseInt(redisUrl.port || '6379', 10),
        password: redisUrl.password || undefined,
        tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
      };
    } catch {
      // fall through to host/port fallback
    }
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  };
}

function ensureString(value: unknown, fallback = ''): string {
  const text = String(value || '').trim();
  return text || fallback;
}

function ensureNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeConfidence(value: unknown): number {
  const numeric = ensureNumber(value, 0);
  return numeric > 1 ? numeric / 100 : numeric;
}

function ensureNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRecommendation(value: unknown): SchemaRecommendation {
  const text = String(value || '').trim().toUpperCase();

  if (text === 'COMPRA' || text === 'VENDA' || text === 'AGUARDAR') {
    return text;
  }

  if (text.includes('BUY') || text.includes('COMPRA')) {
    return 'COMPRA';
  }

  if (text.includes('SELL') || text.includes('VENDA')) {
    return 'VENDA';
  }

  return 'AGUARDAR';
}

function normalizeMarketBias(value: unknown): MarketBias {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'bullish' || text === 'bearish' || text === 'neutral') {
    return text;
  }

  if (text.includes('bull')) {
    return 'bullish';
  }

  if (text.includes('bear')) {
    return 'bearish';
  }

  return 'neutral';
}

function normalizeRiskFactors(value: unknown): string[] {
  const fallback = ['Nenhum fator de risco identificado'];

  if (Array.isArray(value)) {
    const merged: string[] = [];
    for (const item of value) {
      const text = String(item || '').trim();
      if (!text) {
        continue;
      }

      if (merged.length > 0 && /^[a-záéíóúãõàâêô,]/.test(text)) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${text}`;
      } else {
        merged.push(text);
      }
    }

    const normalized = merged.filter((item) => item.length > 10);
    return normalized.length > 0 ? normalized : fallback;
  }

  if (typeof value === 'string') {
    const normalized = value
      .split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚ])|[\n•-]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 10);

    return normalized.length > 0 ? normalized : fallback;
  }

  return fallback;
}

function toWorkerAnalysisResult(value: unknown): WorkerAnalysisResult {
  const source = isRecord(value) ? (value as Record<string, unknown>) : {};
  const analysisSource = isRecord(source.analysis) ? (source.analysis as Record<string, unknown>) : source;
  const marketStructureSource = isRecord(analysisSource.marketStructure)
    ? (analysisSource.marketStructure as Record<string, unknown>)
    : {};
  const riskFactorsList = normalizeRiskFactors(analysisSource.riskFactors ?? source.riskFactors);

  return {
    recommendation: normalizeRecommendation(source.recommendation),
    confidence: normalizeConfidence(source.confidence),
    analysis: {
      symbol: ensureString(analysisSource.symbol ?? source.symbol, 'UNKNOWN'),
      timeframe: ensureString(analysisSource.timeframe ?? source.timeframe, 'UNKNOWN'),
      currentPrice: ensureNumber(analysisSource.currentPrice ?? source.currentPrice, 0),
      entry: ensureNumberOrNull(analysisSource.entry ?? source.entry),
      stopLoss: ensureNumberOrNull(analysisSource.stopLoss ?? source.stopLoss),
      stopLossPercent: ensureNumberOrNull(analysisSource.stopLossPercent ?? source.stopLossPercent),
      takeProfit1: ensureNumberOrNull(analysisSource.takeProfit1 ?? source.takeProfit1),
      takeProfit1Percent: ensureNumberOrNull(
        analysisSource.takeProfit1Percent ?? source.takeProfit1Percent,
      ),
      takeProfit2: ensureNumberOrNull(analysisSource.takeProfit2 ?? source.takeProfit2),
      takeProfit2Percent: ensureNumberOrNull(
        analysisSource.takeProfit2Percent ?? source.takeProfit2Percent,
      ),
      riskRewardRatio:
        (analysisSource.riskRewardRatio ?? source.riskRewardRatio) === null ||
        (analysisSource.riskRewardRatio ?? source.riskRewardRatio) === undefined
          ? null
          : ensureString(analysisSource.riskRewardRatio ?? source.riskRewardRatio, ''),
      marketStructure: {
        bias: normalizeMarketBias(marketStructureSource.bias ?? source.marketBias),
        lastStructure: ensureString(marketStructureSource.lastStructure, 'Não informado'),
        breakOfStructure: ensureString(marketStructureSource.breakOfStructure, 'Não informado'),
        priceZone: ensureString(marketStructureSource.priceZone, 'Não informado'),
        orderBlock: ensureString(marketStructureSource.orderBlock, 'Não informado'),
      },
      chartType: ensureString(analysisSource.chartType, 'Não informado'),
      confluenceScore: ensureNumber(analysisSource.confluenceScore, 0),
      factorsPresent: ensureNumber(analysisSource.factorsPresent, 0),
      technicalAnalysis: ensureString(
        analysisSource.technicalAnalysis ?? analysisSource.technicalSummary ?? source.technicalSummary,
        'Análise técnica indisponível.',
      ),
      keyIndicators: ensureString(analysisSource.keyIndicators, 'Indicadores não informados.'),
      identifiedPatterns: ensureString(
        analysisSource.identifiedPatterns,
        'Padrões identificados não informados.',
      ),
      structureValidation: ensureString(
        analysisSource.structureValidation,
        'Validação estrutural não informada.',
      ),
      riskFactors: riskFactorsList.join('\n'),
      whyNotOpposite: ensureString(
        analysisSource.whyNotOpposite,
        'Sem justificativa para o lado oposto.',
      ),
      executiveSummary: ensureString(
        analysisSource.executiveSummary ?? analysisSource.technicalSummary,
        'Resumo executivo indisponível.',
      ),
      reasoning: ensureString(analysisSource.reasoning ?? source.reasoning, 'Sem justificativa gerada.'),
    },
  };
}

function randomRecommendation(): SchemaRecommendation {
  const options: SchemaRecommendation[] = ['COMPRA', 'VENDA', 'AGUARDAR'];
  return options[Math.floor(Math.random() * options.length)];
}

function recommendationToBias(recommendation: SchemaRecommendation): MarketBias {
  if (recommendation === 'COMPRA') {
    return 'bullish';
  }

  if (recommendation === 'VENDA') {
    return 'bearish';
  }

  return 'neutral';
}

function generateDemoAnalysis(): WorkerAnalysisResult {
  const recommendation = randomRecommendation();
  const marketBias = recommendationToBias(recommendation);
  const confidence = Number((Math.random() * 0.25 + 0.7).toFixed(2));
  const currentPrice = Number((Math.random() * 8000 + 42000).toFixed(2));

  const baseMarketStructure: WorkerAnalysisMarketStructure = {
    bias: marketBias,
    lastStructure: recommendation === 'VENDA' ? 'Lower High' : 'Higher Low',
    breakOfStructure:
      recommendation === 'AGUARDAR'
        ? 'Sem confirmação estrutural'
        : recommendation === 'VENDA'
          ? 'CHoCH bearish confirmado'
          : 'BOS bullish confirmado',
    priceZone:
      recommendation === 'AGUARDAR'
        ? 'meio do range'
        : recommendation === 'VENDA'
          ? 'prêmio'
          : 'desconto',
    orderBlock:
      recommendation === 'VENDA'
        ? 'Zona de oferta recente'
        : recommendation === 'COMPRA'
          ? 'Zona de demanda recente'
          : 'Sem order block claro',
  };

  if (recommendation === 'AGUARDAR') {
    return {
      recommendation,
      confidence,
      analysis: {
        symbol: 'DEMOUSDT',
        timeframe: 'H1',
        currentPrice,
        entry: null,
        stopLoss: null,
        stopLossPercent: null,
        takeProfit1: null,
        takeProfit1Percent: null,
        takeProfit2: null,
        takeProfit2Percent: null,
        riskRewardRatio: null,
        marketStructure: baseMarketStructure,
        chartType: 'candles',
        confluenceScore: 0.45,
        factorsPresent: 2,
        technicalAnalysis:
          'Estrutura lateral em transição, sem deslocamento direcional limpo e com volatilidade comprimida no centro do range.',
        keyIndicators: 'Volume sem expansão consistente; ausência de momentum direcional.',
        identifiedPatterns: 'Consolidação com falsos rompimentos.',
        structureValidation: 'Checklist insuficiente para entrada direcional no momento.',
        riskFactors:
          'Consolidação lateral sem viés claro; Ausência de gatilho limpo; R:R estrutural abaixo do mínimo.',
        whyNotOpposite:
          'Não foi COMPRA nem VENDA porque faltam confirmações estruturais e de confluência para ambos os lados.',
        executiveSummary:
          'Ação recomendada: AGUARDAR. Monitorar rompimento válido com reteste e expansão de volume antes de nova decisão.',
        reasoning:
          'O preço permanece em região neutra, sem BOS/CHoCH confiável e sem desequilíbrio claro de fluxo. A leitura atual indica transição estrutural.\n\nAs confluências exigidas para COMPRA e VENDA não estão completas. Não há combinação robusta de zona, padrão de candle e contexto MTF alinhado.\n\nA invalidação desse cenário ocorre com rompimento limpo da congestão acompanhado de confirmação no reteste e aumento de volume.',
      },
    };
  }

  if (recommendation === 'COMPRA') {
    const entry = Number((currentPrice * 0.998).toFixed(2));
    const stopLoss = Number((entry * 0.992).toFixed(2));
    const takeProfit1 = Number((entry * 1.018).toFixed(2));
    const takeProfit2 = Number((entry * 1.032).toFixed(2));

    return {
      recommendation,
      confidence,
      analysis: {
        symbol: 'DEMOUSDT',
        timeframe: 'H1',
        currentPrice,
        entry,
        stopLoss,
        stopLossPercent: Number((((stopLoss - entry) / entry) * 100).toFixed(2)),
        takeProfit1,
        takeProfit1Percent: Number((((takeProfit1 - entry) / entry) * 100).toFixed(2)),
        takeProfit2,
        takeProfit2Percent: Number((((takeProfit2 - entry) / entry) * 100).toFixed(2)),
        riskRewardRatio: '1:2.5',
        marketStructure: baseMarketStructure,
        chartType: 'candles',
        confluenceScore: 0.82,
        factorsPresent: 5,
        technicalAnalysis:
          'Estrutura de alta com HL preservado, BOS bullish e reteste em zona de demanda. O fluxo comprador mantém vantagem no contexto atual.',
        keyIndicators: 'Volume comprador acima da média e candle de confirmação na zona.',
        identifiedPatterns: 'Bullish engulfing próximo ao order block de demanda.',
        structureValidation: 'Checklist COMPRA atendido com 5/5 critérios.',
        riskFactors:
          'Perda do fundo estrutural recente; Rejeição forte em resistência imediata; Falha de continuidade no rompimento.',
        whyNotOpposite:
          'Não foi VENDA porque a estrutura segue bullish e não há CHoCH bearish válido com suporte crítico rompido.',
        executiveSummary:
          'Ação: COMPRA com entrada em desconto, stop técnico abaixo da estrutura e alvos em liquidez superior com R:R acima de 2:1.',
        reasoning:
          'A estrutura mostra sequência de fundos ascendentes e BOS bullish após reteste de zona de demanda. O contexto favorece continuidade de alta.\n\nAs confluências incluem posição em desconto, confirmação por padrão bullish e ausência de resistência imediata limitando o avanço inicial.\n\nA tese perde validade se houver fechamento abaixo do fundo estrutural que ancora o stop. O lado oposto não foi escolhido por falta de gatilho bearish consistente.',
      },
    };
  }

  const entry = Number((currentPrice * 1.002).toFixed(2));
  const stopLoss = Number((entry * 1.008).toFixed(2));
  const takeProfit1 = Number((entry * 0.982).toFixed(2));
  const takeProfit2 = Number((entry * 0.968).toFixed(2));

  return {
    recommendation,
    confidence,
    analysis: {
      symbol: 'DEMOUSDT',
      timeframe: 'H1',
      currentPrice,
      entry,
      stopLoss,
      stopLossPercent: Number((((stopLoss - entry) / entry) * 100).toFixed(2)),
      takeProfit1,
      takeProfit1Percent: Number((((takeProfit1 - entry) / entry) * 100).toFixed(2)),
      takeProfit2,
      takeProfit2Percent: Number((((takeProfit2 - entry) / entry) * 100).toFixed(2)),
      riskRewardRatio: '1:2.4',
      marketStructure: baseMarketStructure,
      chartType: 'candles',
      confluenceScore: 0.79,
      factorsPresent: 5,
      technicalAnalysis:
        'Estrutura de baixa com LH confirmado e CHoCH bearish, preço em zona de prêmio e fluxo vendedor predominante.',
      keyIndicators: 'Pressão de venda com candles de rejeição e perda de suporte intermediário.',
      identifiedPatterns: 'Bearish engulfing em zona de oferta.',
      structureValidation: 'Checklist VENDA atendido com 5/6 critérios e item crítico validado.',
      riskFactors:
        'Retomada forte acima da oferta; Absorção compradora em suporte; Divergência de momentum contra a baixa.',
      whyNotOpposite:
        'Não foi COMPRA porque não há BOS bullish nem confirmação de demanda com caminho livre acima.',
      executiveSummary:
        'Ação: VENDA em zona de prêmio, stop acima da estrutura e alvos em liquidez inferior com R:R superior a 2:1.',
      reasoning:
        'A estrutura apresenta topos descendentes e CHoCH bearish, com contexto favorável à continuação da pressão vendedora.\n\nAs confluências incluem zona de prêmio, padrão bearish na oferta e ausência de suporte forte imediato abaixo da entrada.\n\nA tese invalida com fechamento acima da máxima estrutural usada no stop. O lado oposto não foi recomendado por ausência de confirmação bullish.',
    },
  };
}

async function getPrompt(promptOverride?: string, promptVersion?: number): Promise<string> {
  if (promptOverride) {
    return promptOverride;
  }

  if (promptVersion) {
    const promptConfig = await prisma.promptConfig.findUnique({
      where: { version: promptVersion },
    });
    if (promptConfig?.prompt) {
      return promptConfig.prompt;
    }
  }

  const activePrompt = await prisma.promptConfig.findFirst({
    where: { isActive: true },
    orderBy: { version: 'desc' },
  });

  return activePrompt?.prompt || TRADING_SYSTEM_PROMPT;
}

async function persistAnnotatedImage(
  payload: NormalizedPersistedAnalysis,
  userId?: string,
): Promise<NormalizedPersistedAnalysis> {
  if (!payload.annotatedImageUrl || !payload.annotatedImageUrl.startsWith('data:')) {
    return payload;
  }

  if (!storage.isConfigured()) {
    if (storage.requiresRemoteStorage()) {
      payload.annotatedImageUrl = null;
      payload.drawingFailed = true;
      payload.fullResponse.annotated_image_url = null;
      payload.fullResponse.drawing_failed = true;
    }
    return payload;
  }

  const owner = userId || 'unknown-user';
  try {
    const uploadedUrl = await storage.uploadDataUrl(
      payload.annotatedImageUrl,
      `analyses/${owner}/annotated`,
    );

    payload.annotatedImageUrl = uploadedUrl;
    payload.fullResponse.annotated_image_url = uploadedUrl;
    payload.fullResponse.drawing_failed = Boolean(payload.drawingFailed);
  } catch (error) {
    console.warn(
      `[Worker] Failed to persist annotated image for ${owner}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    payload.annotatedImageUrl = null;
    payload.drawingFailed = true;
    payload.fullResponse.annotated_image_url = null;
    payload.fullResponse.drawing_failed = true;
  }

  return payload;
}

async function resolveAiSource(
  imageUrl: string,
  prompt: string,
  analysisType: AnalysisType,
): Promise<unknown> {
  if (hasValidOpenAiKey()) {
    return aiAdapter.analyzeImage(imageUrl, prompt, analysisType);
  }

  if (canUseDemoFallback()) {
    return {
      rawResponse: generateDemoAnalysis(),
      rawContent: '',
    };
  }

  throw new Error('OpenAI key is missing or invalid in production mode.');
}

function safeWorkerErrorMessage(error: unknown): string {
  if (!isProductionRuntime() && error instanceof Error) {
    return error.message;
  }

  return 'Analysis processing failed. Please try again later.';
}

function validateTradingLogic(result: WorkerAnalysisResult): string[] {
  const errors: string[] = [];
  const rec = result.recommendation;
  const a = result.analysis;
  const normalizedConfidence = normalizeConfidence(result.confidence);

  if (!['COMPRA', 'VENDA', 'AGUARDAR'].includes(rec)) {
    errors.push(`recommendation inválido: ${rec}`);
  }

  if (typeof normalizedConfidence !== 'number' || normalizedConfidence < 0 || normalizedConfidence > 1) {
    errors.push(`confidence inválido: ${result.confidence}`);
  }

  if (!a.symbol || a.symbol.trim() === '') {
    errors.push('symbol vazio');
  }

  if (!a.timeframe || a.timeframe.trim() === '') {
    errors.push('timeframe vazio');
  }

  if (typeof a.currentPrice !== 'number' || a.currentPrice <= 0) {
    errors.push(`currentPrice inválido: ${a.currentPrice}`);
  }

  if (rec === 'COMPRA') {
    if (typeof a.entry !== 'number' || typeof a.stopLoss !== 'number' || typeof a.takeProfit1 !== 'number') {
      errors.push('COMPRA: entry, stopLoss e takeProfit1 devem ser numéricos');
    } else {
      if (a.entry <= a.stopLoss) {
        errors.push(`COMPRA: entry (${a.entry}) deve ser > stopLoss (${a.stopLoss})`);
      }
      if (a.takeProfit1 <= a.entry) {
        errors.push(`COMPRA: takeProfit1 (${a.takeProfit1}) deve ser > entry (${a.entry})`);
      }

      const denominator = a.entry - a.stopLoss;
      if (denominator <= 0) {
        errors.push('COMPRA: denominador inválido para cálculo de R:R');
      } else {
        const rr = (a.takeProfit1 - a.entry) / denominator;
        if (!Number.isFinite(rr) || rr <= 0) {
          errors.push(`COMPRA: R:R inválido (${rr})`);
        }
      }
    }

    if (typeof a.takeProfit2 !== 'number') {
      errors.push('COMPRA: takeProfit2 deve ser numérico');
    } else if (typeof a.takeProfit1 === 'number' && a.takeProfit2 <= a.takeProfit1) {
      errors.push(
        `COMPRA: takeProfit2 (${a.takeProfit2}) deve ser > takeProfit1 (${a.takeProfit1})`,
      );
    }
  }

  if (rec === 'VENDA') {
    if (typeof a.entry !== 'number' || typeof a.stopLoss !== 'number' || typeof a.takeProfit1 !== 'number') {
      errors.push('VENDA: entry, stopLoss e takeProfit1 devem ser numéricos');
    } else {
      if (a.entry >= a.stopLoss) {
        errors.push(`VENDA: entry (${a.entry}) deve ser < stopLoss (${a.stopLoss})`);
      }
      if (a.takeProfit1 >= a.entry) {
        errors.push(`VENDA: takeProfit1 (${a.takeProfit1}) deve ser < entry (${a.entry})`);
      }

      const denominator = a.stopLoss - a.entry;
      if (denominator <= 0) {
        errors.push('VENDA: denominador inválido para cálculo de R:R');
      } else {
        const rr = (a.entry - a.takeProfit1) / denominator;
        if (!Number.isFinite(rr) || rr <= 0) {
          errors.push(`VENDA: R:R inválido (${rr})`);
        }
      }
    }

    if (typeof a.takeProfit2 !== 'number') {
      errors.push('VENDA: takeProfit2 deve ser numérico');
    } else if (typeof a.takeProfit1 === 'number' && a.takeProfit2 >= a.takeProfit1) {
      errors.push(
        `VENDA: takeProfit2 (${a.takeProfit2}) deve ser < takeProfit1 (${a.takeProfit1})`,
      );
    }
  }

  if (rec === 'AGUARDAR') {
    if (a.entry !== null) errors.push('AGUARDAR: entry deve ser null');
    if (a.stopLoss !== null) errors.push('AGUARDAR: stopLoss deve ser null');
    if (a.takeProfit1 !== null) errors.push('AGUARDAR: takeProfit1 deve ser null');
    if (a.takeProfit2 !== null) errors.push('AGUARDAR: takeProfit2 deve ser null');
    if (a.riskRewardRatio !== null) errors.push('AGUARDAR: riskRewardRatio deve ser null');
  }

  return errors;
}

function toPersistedAnalysis(data: WorkerAnalysisResult): Record<string, unknown> {
  const riskFactorsList = normalizeRiskFactors(data.analysis.riskFactors);

  return {
    ...data.analysis,
    riskFactors: riskFactorsList.join('\n'),
    technicalSummary: data.analysis.executiveSummary,
    riskFactorsList,
  };
}

function extractRawContent(aiSource: unknown, parsed: WorkerAnalysisResult): string {
  if (
    aiSource &&
    typeof aiSource === 'object' &&
    'rawContent' in aiSource &&
    typeof (aiSource as { rawContent?: unknown }).rawContent === 'string' &&
    String((aiSource as { rawContent?: string }).rawContent || '').trim()
  ) {
    return String((aiSource as { rawContent?: string }).rawContent || '').trim();
  }

  return JSON.stringify(parsed);
}

async function processAnalysis(job: Job<JobData>) {
  const {
    analysisId,
    imageUrl,
    promptOverride,
    promptVersion,
    userId,
    analysisType,
  } = job.data;
  const normalizedAnalysisType: AnalysisType = analysisType === 'deep' ? 'deep' : 'quick';

  console.log(`[Worker] Processing analysis ${analysisId}`);

  let rawContent = '';

  try {
    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'processing', errorMessage: null },
    });

    const prompt = await getPrompt(promptOverride, promptVersion);
    const aiSource = await resolveAiSource(imageUrl, prompt, normalizedAnalysisType);

    const sourcePayload =
      aiSource &&
      typeof aiSource === 'object' &&
      'rawResponse' in aiSource &&
      (aiSource as { rawResponse?: unknown }).rawResponse
        ? (aiSource as { rawResponse: unknown }).rawResponse
        : aiSource;

    const parsed = toWorkerAnalysisResult(sourcePayload);
    rawContent = extractRawContent(aiSource, parsed);

    const validationErrors = validateTradingLogic(parsed);

    if (validationErrors.length > 0) {
      const validationMessage = `Validação falhou: ${validationErrors.join('; ')}`;

      console.error('[Worker] Análise com dados inválidos', {
        analysisId,
        errors: validationErrors,
        raw: rawContent.slice(0, 500),
      });

      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'failed',
          recommendation: null,
          confidence: null,
          reasoning: validationMessage,
          errorMessage: validationMessage,
          result: Prisma.DbNull,
          fullResponse: rawContent,
        },
      });

      return;
    }

    let normalized = buildPersistedAnalysisPayload({
      source: parsed as unknown as Record<string, unknown>,
      recommendation: parsed.recommendation,
      bias: parsed.analysis.marketStructure.bias,
      confidence: parsed.confidence,
      reasoning: parsed.analysis.reasoning,
      analysis: toPersistedAnalysis(parsed),
      drawingPlan: null,
      originalImageUrl: imageUrl,
    });

    normalized = await persistAnnotatedImage(normalized, userId);

    await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        status: 'completed',
        recommendation: normalized.recommendation,
        confidence: normalized.confidence,
        reasoning: normalized.reasoning,
        imageUrl: normalized.originalImageUrl,
        result: normalized.fullResponse as any,
        fullResponse: rawContent,
        errorMessage: null,
      },
    });

    console.log(`[Worker] Analysis ${analysisId} completed`);
  } catch (error) {
    console.error(`[Worker] Error processing analysis ${analysisId}:`, error);

    const safeMessage = safeWorkerErrorMessage(error);
    const failureRawContent =
      rawContent ||
      (error instanceof AIAnalysisError && error.rawContent ? error.rawContent : null);

    await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        status: 'failed',
        reasoning: safeMessage,
        errorMessage: safeMessage,
        result: Prisma.DbNull,
        fullResponse: failureRawContent,
      },
    });

    if (error instanceof AIAnalysisError && !error.retriable) {
      throw new UnrecoverableError(error.message);
    }

    throw error;
  }
}

const worker = new Worker<JobData>('ai-analysis', processAnalysis, {
  connection: getRedisConnection() as any,
  concurrency: 3,
});

worker.on('completed', (job) => {
  console.log(`✅ [Worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ [Worker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('❌ [Worker] Error:', err);
});

console.log('🚀 AI Worker started and listening for jobs...');

async function shutdown() {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
