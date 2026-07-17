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
import {
  computeRiskReward,
  formatRiskReward,
  normalizeTargetProbabilities,
  reconcileConfluence,
} from '../src/common/utils/analysis-normalizer';
import { decideSignal } from '../src/common/utils/signal-decision';
import { ImageStorageClient } from '../src/common/utils/image-storage';
import { isProductionRuntime } from '../src/common/utils/runtime-env';
import { canUseDemoFallback, hasValidOpenAiKey } from '../src/common/utils/ai-runtime';
import { resolvePrismaDatasourceUrl } from '../src/modules/database/prisma.datasource';
import { AnalysisType } from '../src/modules/ticks/tick-packages';
import { DEEP_ENRICHMENT_INSTRUCTION } from '../src/modules/prompt/prompt-builder.service';
import { startOutcomeSweeper } from './outcome.sweeper';

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
  htfImageUrls?: string[];
  promptOverride?: string;
  promptVersion?: number;
  userId?: string;
  analysisType?: AnalysisType;
  isDemo?: boolean;
  userLanguage?: string;
}

// ─── Fixed demo response (no OpenAI call, no tick cost) ──────────────────────
const DEMO_RESPONSE = {
  is_financial_chart: true,
  recommendation: 'BUY',
  confidence: 72,
  analysis: {
    symbol: 'XAUUSD',
    timeframe: '15M',
    detectedSession: 'new_york',
    sessionNote: 'Sessão de Nova York ativa — maior liquidez para ouro.',
    currentPrice: 3310.50,
    entry: 3312.00,
    stopLoss: 3295.00,
    stopLossPercent: -0.51,
    takeProfit1: 3335.00,
    takeProfit1Percent: 0.69,
    takeProfit2: 3355.00,
    takeProfit2Percent: 1.30,
    riskRewardRatio: '1:2.1',
    marketStructure: {
      bias: 'bullish',
      lastStructure: 'Higher Low confirmado em $3.295 — estrutura ascendente intacta.',
      breakOfStructure: 'BOS bullish confirmado acima de $3.305',
      priceZone: 'Zona de Desconto (abaixo de 50% do range — favorável para BUY)',
      orderBlock: 'Bullish OB em $3.295–$3.302 (última vela bearish antes do impulso de alta)',
    },
    chartType: 'Candlestick',
    confluenceScore: 67,
    factorsPresent: 4,
    technicalAnalysis: '⚠️ ANÁLISE DEMONSTRATIVA — Esta é uma análise de exemplo gerada automaticamente para demonstrar as capacidades da plataforma. Os níveis de entrada, stop e alvos são ilustrativos.\n\nO XAUUSD apresenta estrutura de mercado bullish no timeframe de 15 minutos, com sequência de topos e fundos ascendentes. O preço recuou até o Order Block em $3.295–$3.302 e mostrou rejeição com vela de reversão. A sessão de Nova York confere maior liquidez ao setup.',
    keyIndicators: 'Análise de price action puro — sem indicadores visíveis na imagem demonstrativa.',
    identifiedPatterns: 'Bullish Order Block ($3.295–$3.302), Fair Value Gap acima de $3.308, Liquidity Pool (equal highs) em $3.340.',
    structureValidation: '✅ HTF bullish | ✅ Zona de Desconto | ✅ Bullish OB entry | ✅ Anti-retail (swept equal lows) | ❌ BOS não confirmado | ✅ R:R 1:2.1 → 4/6 → BUY moderado',
    riskFactors: 'Esta é uma análise demonstrativa. Em operações reais: 1) Confirme o BOS antes de entrar. 2) Verifique o calendário econômico para eventos USD. 3) Gerencie o risco com no máximo 1-2% do capital por operação.',
    whyNotOpposite: 'Estrutura HTF bullish e presença de Order Block de compra invalidam o cenário vendedor neste momento. Esta é uma análise demonstrativa.',
    executiveSummary: '⚠️ ANÁLISE DEMONSTRATIVA — Gerada automaticamente para apresentar o formato da plataforma.\n\nO XAUUSD demonstra setup de compra com 4 de 6 fatores de confluência ICT/SMC presentes. Order Block bullish identificado em $3.295–$3.302 com rejeição confirmada.\n\nPara acessar análises reais com processamento completo de IA, assine um dos planos disponíveis.',
    reasoning: '[HTF] Bias bullish — sequência de HH e HL no timeframe de 15M. [CHART] Candlestick padrão, sessão NY. [ICT] OB bullish $3.295–$3.302, FVG acima $3.308. [AVANÇADO] N/A. [ANTI-RETAIL] Equal lows varridos antes da reversão. [DECISÃO] 4/6 itens → BUY moderado. ⚠️ Análise Demonstrativa.',
  },
};

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
  invalidationLevel: number | null;
  invalidationNote: string | null;
  entryType: string | null;
  entryCondition: string | null;
  partialExitStrategy: string | null;
  alternativeScenario: string | null;
  trendStrength: string | null;
  trendStrengthNote: string | null;
  multiTimeframeAlignment: string | null;
  marketRegime?: string | null;
  marketRegimeNote?: string | null;
  probabilityTp1?: number | null;
  probabilityTp2?: number | null;
  probabilityStop?: number | null;
  tp1ClosePercent?: number | null;
  tp2ClosePercent?: number | null;
  breakevenTrigger?: string | null;
  riskRewardTp1?: number | null;
  riskRewardTp2?: number | null;
  entryY?: number | null;
  stopY?: number | null;
  tp1Y?: number | null;
  tp2Y?: number | null;
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

async function toWorkerAnalysisResult(value: unknown): Promise<WorkerAnalysisResult> {
  const source = isRecord(value) ? (value as Record<string, unknown>) : {};
  const analysisSource = isRecord(source.analysis) ? (source.analysis as Record<string, unknown>) : source;
  const marketStructureSource = isRecord(analysisSource.marketStructure)
    ? (analysisSource.marketStructure as Record<string, unknown>)
    : {};
  const riskFactorsList = normalizeRiskFactors(analysisSource.riskFactors ?? source.riskFactors);

  // Níveis lidos uma vez para permitir R/R determinístico (idêntico ao caminho síncrono).
  const entry = ensureNumberOrNull(analysisSource.entry ?? source.entry);
  const stopLoss = ensureNumberOrNull(analysisSource.stopLoss ?? source.stopLoss);
  const takeProfit1 = ensureNumberOrNull(analysisSource.takeProfit1 ?? source.takeProfit1);
  const takeProfit2 = ensureNumberOrNull(analysisSource.takeProfit2 ?? source.takeProfit2);
  const riskRewardTp1 = computeRiskReward(entry, stopLoss, takeProfit1);
  const riskRewardTp2 = computeRiskReward(entry, stopLoss, takeProfit2);
  const aiRiskRewardRatio =
    (analysisSource.riskRewardRatio ?? source.riskRewardRatio) === null ||
    (analysisSource.riskRewardRatio ?? source.riskRewardRatio) === undefined
      ? null
      : ensureString(analysisSource.riskRewardRatio ?? source.riskRewardRatio, '') || null;

  // Confiança em escala 0-100, com piso de 30 em gráfico válido (paridade com o
  // adapter). normalizeConfidence devolve 0-1 aqui — convertemos para 0-100.
  const rawConfidence01 = normalizeConfidence(source.confidence);
  const flooredConfidence = rawConfidence01 <= 0 ? 30 : Math.round(rawConfidence01 * 100);

  const workerRecommendation = normalizeRecommendation(source.recommendation);
  const canonicalRecommendation =
    workerRecommendation === 'COMPRA' ? 'BUY' : workerRecommendation === 'VENDA' ? 'SELL' : 'WAIT';

  // Sequência determinística ÚNICA (mesma usada pelo adapter):
  // caps de confiança → guard R/R → news guard → teto WAIT.
  const decision = await decideSignal({
    recommendation: canonicalRecommendation,
    flooredConfidence,
    trendStrength: analysisSource.trendStrength,
    factorsPresent: analysisSource.factorsPresent,
    riskRewardTp1,
    riskRewardTp2,
    symbol: ensureString(analysisSource.symbol ?? source.symbol, ''),
  });

  const finalRecommendation: SchemaRecommendation =
    decision.recommendation === 'BUY'
      ? 'COMPRA'
      : decision.recommendation === 'SELL'
        ? 'VENDA'
        : 'AGUARDAR';
  const finalConfidencePct = decision.confidence;

  // Probabilidades por alvo — mesma regra do adapter (paridade worker/adapter):
  // 0/inválido = ausente; default determinístico derivado da confiança.
  const targetProbabilities = normalizeTargetProbabilities(
    {
      tp1: analysisSource.probabilityTp1,
      tp2: analysisSource.probabilityTp2,
      stop: analysisSource.probabilityStop,
    },
    { hasTradePlan: entry !== null, confidence: normalizeConfidence(source.confidence) },
  );

  return {
    recommendation: finalRecommendation,
    confidence: finalConfidencePct / 100,
    analysis: {
      symbol: ensureString(analysisSource.symbol ?? source.symbol, 'UNKNOWN'),
      timeframe: ensureString(analysisSource.timeframe ?? source.timeframe, 'UNKNOWN'),
      currentPrice: ensureNumber(analysisSource.currentPrice ?? source.currentPrice, 0),
      entry,
      stopLoss,
      stopLossPercent: ensureNumberOrNull(analysisSource.stopLossPercent ?? source.stopLossPercent),
      takeProfit1,
      takeProfit1Percent: ensureNumberOrNull(
        analysisSource.takeProfit1Percent ?? source.takeProfit1Percent,
      ),
      takeProfit2,
      takeProfit2Percent: ensureNumberOrNull(
        analysisSource.takeProfit2Percent ?? source.takeProfit2Percent,
      ),
      riskRewardRatio: formatRiskReward(riskRewardTp2 ?? riskRewardTp1) ?? aiRiskRewardRatio,
      riskRewardTp1,
      riskRewardTp2,
      marketStructure: {
        bias: normalizeMarketBias(marketStructureSource.bias ?? source.marketBias),
        lastStructure: ensureString(marketStructureSource.lastStructure, 'Não informado'),
        breakOfStructure: ensureString(marketStructureSource.breakOfStructure, 'Não informado'),
        priceZone: ensureString(marketStructureSource.priceZone, 'Não informado'),
        orderBlock: ensureString(marketStructureSource.orderBlock, 'Não informado'),
      },
      chartType: ensureString(analysisSource.chartType, 'Não informado'),
      ...reconcileConfluence(
        analysisSource.structureValidation,
        ensureNumber(analysisSource.confluenceScore, 0),
        ensureNumber(analysisSource.factorsPresent, 0),
      ),
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
      invalidationLevel: analysisSource.invalidationLevel != null ? Number(analysisSource.invalidationLevel) : null,
      invalidationNote: analysisSource.invalidationNote != null ? String(analysisSource.invalidationNote).trim() || null : null,
      entryType: analysisSource.entryType != null ? String(analysisSource.entryType).trim() || null : null,
      entryCondition: analysisSource.entryCondition != null ? String(analysisSource.entryCondition).trim() || null : null,
      partialExitStrategy: analysisSource.partialExitStrategy != null ? String(analysisSource.partialExitStrategy).trim() || null : null,
      alternativeScenario: analysisSource.alternativeScenario != null ? String(analysisSource.alternativeScenario).trim() || null : null,
      trendStrength: analysisSource.trendStrength != null ? String(analysisSource.trendStrength).trim() || null : null,
      trendStrengthNote: analysisSource.trendStrengthNote != null ? String(analysisSource.trendStrengthNote).trim() || null : null,
      multiTimeframeAlignment: analysisSource.multiTimeframeAlignment != null ? String(analysisSource.multiTimeframeAlignment).trim() || null : null,
      marketRegime: analysisSource.marketRegime != null ? String(analysisSource.marketRegime).trim() || null : null,
      marketRegimeNote: analysisSource.marketRegimeNote != null ? String(analysisSource.marketRegimeNote).trim() || null : null,
      probabilityTp1: targetProbabilities.probabilityTp1,
      probabilityTp2: targetProbabilities.probabilityTp2,
      probabilityStop: targetProbabilities.probabilityStop,
      tp1ClosePercent: ensureNumberOrNull(analysisSource.tp1ClosePercent),
      tp2ClosePercent: ensureNumberOrNull(analysisSource.tp2ClosePercent),
      breakevenTrigger: analysisSource.breakevenTrigger != null ? String(analysisSource.breakevenTrigger).trim() || null : null,
      entryY: ensureNumberOrNull(analysisSource.entryY),
      stopY: ensureNumberOrNull(analysisSource.stopY),
      tp1Y: ensureNumberOrNull(analysisSource.tp1Y),
      tp2Y: ensureNumberOrNull(analysisSource.tp2Y),
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
        invalidationLevel: null,
        invalidationNote: null,
        entryType: null,
        entryCondition: null,
        partialExitStrategy: null,
        alternativeScenario: null,
        trendStrength: 'weak',
        trendStrengthNote: 'Estrutura lateral sem momentum direcional.',
        multiTimeframeAlignment: 'DEMO | DEMO | DEMO → 0/3 alinhados — aguardar',
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
        invalidationLevel: null,
        invalidationNote: 'Setup invalidado se preço fechar abaixo do fundo estrutural (análise demonstrativa).',
        entryType: 'limit',
        entryCondition: 'Aguarde reteste da zona de demanda antes de entrar (análise demonstrativa).',
        partialExitStrategy: 'Feche 50% no TP1. Mova o stop para o ponto de entrada após confirmação. Deixe os 50% restantes correrem até TP2 (análise demonstrativa).',
        alternativeScenario: 'Se o preço romper abaixo do suporte com fechamento, o setup inverte para VENDA (análise demonstrativa).',
        trendStrength: 'moderate',
        trendStrengthNote: 'Estrutura bullish com BOS confirmado.',
        multiTimeframeAlignment: 'DEMO | DEMO | DEMO → 2/3 alinhados — setup moderado',
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
      invalidationLevel: null,
      invalidationNote: 'Setup invalidado se preço fechar acima da máxima estrutural (análise demonstrativa).',
      entryType: 'market',
      entryCondition: 'Entre a mercado na zona de oferta identificada (análise demonstrativa).',
      partialExitStrategy: 'Feche 50% no TP1. Mova o stop para o ponto de entrada após confirmação. Deixe os 50% restantes correrem até TP2 (análise demonstrativa).',
      alternativeScenario: 'Se o preço romper acima da resistência com fechamento, o setup inverte para COMPRA (análise demonstrativa).',
      trendStrength: 'strong',
      trendStrengthNote: 'Estrutura bearish com CHoCH confirmado e fluxo vendedor dominante.',
      multiTimeframeAlignment: 'DEMO | DEMO | DEMO → 3/3 alinhados — setup de alta convicção',
    },
  };
}

const LANGUAGE_NAMES: Record<string, string> = {
  pt: 'Portuguese (Brazil)',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
};

async function getPrompt(
  promptOverride?: string,
  promptVersion?: number,
  userLanguage?: string,
  analysisType?: AnalysisType,
): Promise<string> {
  const withDeep = (p: string): string =>
    analysisType === 'deep' && !p.includes('ANÁLISE DEEP — LEITURA EM CAMADAS')
      ? `${p}\n\n${DEEP_ENRICHMENT_INSTRUCTION}`
      : p;

  if (promptOverride) {
    return withDeep(promptOverride);
  }

  let basePrompt: string;

  if (promptVersion) {
    const promptConfig = await prisma.promptConfig.findUnique({
      where: { version: promptVersion },
    });
    if (promptConfig?.prompt) {
      basePrompt = promptConfig.prompt;
    } else {
      basePrompt = TRADING_SYSTEM_PROMPT;
    }
  } else {
    const activePrompt = await prisma.promptConfig.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    basePrompt = activePrompt?.prompt || TRADING_SYSTEM_PROMPT;
  }

  // Inject language into USER_CONTEXT placeholder — English by default (global product)
  const langName = (userLanguage && LANGUAGE_NAMES[userLanguage]) ? LANGUAGE_NAMES[userLanguage] : 'English';
  const languageContext = `OUTPUT LANGUAGE: ${langName}\nWrite ALL analysis fields (technicalAnalysis, executiveSummary, identifiedPatterns, riskFactors, whyNotOpposite, structureValidation, keyIndicators, invalidationNote, entryCondition, partialExitStrategy, alternativeScenario, breakevenTrigger, trendStrengthNote, marketRegimeNote, multiTimeframeAlignment, sessionNote, reasoning, marketStructure.lastStructure, marketStructure.breakOfStructure, marketStructure.priceZone, marketStructure.orderBlock) in ${langName}. Do NOT translate symbol names, timeframes, or technical terms (BOS, CHoCH, OB, FVG). Keep numbers and prices in their original format.`;

  return withDeep(basePrompt.replace('{{USER_CONTEXT}}', languageContext));
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
  htfImageUrls: string[] = [],
): Promise<unknown> {
  if (hasValidOpenAiKey()) {
    return aiAdapter.analyzeImage(imageUrl, prompt, analysisType, htfImageUrls);
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
  if (error instanceof AIAnalysisError) {
    return AIAnalysisError.toUserMessage(error);
  }

  if (!isProductionRuntime() && error instanceof Error) {
    return error.message;
  }

  return 'Analysis failed. Please try again.';
}

const WORKER_TICK_COSTS: Record<AnalysisType, number> = {
  quick: 1,
  deep: 3,
};

/**
 * Refunds ticks after a permanently failed paid analysis. Idempotent per
 * analysisId (guarded by an existing REFUND transaction), so retries or
 * crash-redeliveries can never refund twice.
 */
async function refundTicksForFailedAnalysis(
  userId: string | undefined,
  isDemo: boolean | undefined,
  analysisType: AnalysisType,
  analysisId: string,
): Promise<void> {
  if (!userId || isDemo) {
    return;
  }

  const amount = WORKER_TICK_COSTS[analysisType] ?? 1;

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.tickTransaction.findFirst({
        where: {
          userId,
          type: 'REFUND',
          metadata: { path: ['analysisId'], equals: analysisId },
        },
        select: { id: true },
      });

      if (existing) {
        return;
      }

      await tx.userTicks.upsert({
        where: { userId },
        create: { userId, balance: amount },
        update: { balance: { increment: amount } },
      });

      await tx.tickTransaction.create({
        data: {
          userId,
          amount,
          type: 'REFUND',
          description: 'Refund: analysis failed',
          metadata: { analysisId },
        },
      });
    });

    console.log(`[Worker] Refunded ${amount} tick(s) to ${userId} for failed analysis ${analysisId}`);
  } catch (refundError) {
    console.error(
      `[Worker] Failed to refund ticks for analysis ${analysisId}:`,
      refundError instanceof Error ? refundError.message : refundError,
    );
  }
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

  // AGUARDAR com níveis preenchidos é VÁLIDO: o guard determinístico de R/R
  // rebaixa BUY/SELL→WAIT preservando os níveis de propósito (o usuário vê a
  // estrutura, mas o sinal diz pra não operar). A regra antiga ("AGUARDAR →
  // níveis null") derrubava essas análises legítimas como "dados inválidos"
  // — era a causa do "Erro na Análise" em produção. A UI já exibe N/A quando
  // os níveis vêm null/0, então níveis presentes nunca quebram nada.

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
    htfImageUrls,
    promptOverride,
    promptVersion,
    userId,
    analysisType,
    isDemo,
    userLanguage,
  } = job.data;
  const normalizedAnalysisType: AnalysisType = analysisType === 'deep' ? 'deep' : 'quick';

  console.log(`[Worker] Processing analysis ${analysisId}${isDemo ? ' [FREE]' : ''}`);

  let rawContent = '';

  try {
    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'processing', errorMessage: null },
    });

    // ── Free analyses (isDemo=true) now run real AI — no tick cost, same pipeline ─
    const prompt = await getPrompt(promptOverride, promptVersion, userLanguage, normalizedAnalysisType);
    const aiSource = await resolveAiSource(imageUrl, prompt, normalizedAnalysisType, htfImageUrls ?? []);

    const sourcePayload =
      aiSource &&
      typeof aiSource === 'object' &&
      'rawResponse' in aiSource &&
      (aiSource as { rawResponse?: unknown }).rawResponse
        ? (aiSource as { rawResponse: unknown }).rawResponse
        : aiSource;

    const parsed = await toWorkerAnalysisResult(sourcePayload);
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

    // Non-retriable error → fail permanently and immediately
    if (error instanceof AIAnalysisError && !error.retriable) {
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
      await refundTicksForFailedAnalysis(userId, isDemo, normalizedAnalysisType, analysisId);
      throw new UnrecoverableError(error.message);
    }

    // Retriable error — decide based on remaining attempts
    const totalAttempts = job.opts.attempts ?? 3;
    const attemptsDone = (job.attemptsMade ?? 0) + 1; // current attempt counts as done
    const isLastAttempt = attemptsDone >= totalAttempts;

    if (isLastAttempt) {
      // Exhausted all retries — set final failure state
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
      await refundTicksForFailedAnalysis(userId, isDemo, normalizedAnalysisType, analysisId);
    } else {
      // Intermediate retry — keep status=processing so the frontend keeps polling
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          errorMessage: 'AI is busy — retrying in a moment…',
        },
      });
    }

    throw error;
  }
}

/// Custom backoff: attempt 1→3s, 2→8s (curto para retentar rápido em caso de lentidão da IA)
const RETRY_DELAYS_MS = [3_000, 8_000];

const worker = new Worker<JobData>('ai-analysis', processAnalysis, {
  connection: getRedisConnection() as any,
  concurrency: 3,
  lockDuration: 300_000, // 5 minutes — prevents stalled jobs when OpenAI takes long
  settings: {
    backoffStrategy: (attemptsMade: number) =>
      RETRY_DELAYS_MS[Math.min(attemptsMade, RETRY_DELAYS_MS.length) - 1] ?? 120_000,
  },
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

// Outcome tracking: 48h após cada análise real, verifica nos candles se TP1
// saiu antes do SL e grava WIN/LOSS no banco (kill-switch: ENABLE_OUTCOME_TRACKING='false').
startOutcomeSweeper(prisma);

async function shutdown() {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
