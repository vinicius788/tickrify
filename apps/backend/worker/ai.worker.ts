import { logObservation, safeObserve, type AnalysisObservation } from '../src/common/utils/analysis-observation';
import { flagBool, startFlagRefresh } from '../src/common/flags/feature-flags';
import 'dotenv/config';
import { Job, UnrecoverableError, Worker } from 'bullmq';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  buildPersistedAnalysisPayload,
  NormalizedPersistedAnalysis,
} from '../src/common/utils/analysis-payload';
import { AIAdapter, AIAnalysisError, logNewsGuardStatus } from '../src/modules/ai/ai.adapter';
import {
  computeRiskReward,
  formatRiskReward,
  normalizeTargetProbabilities,
  reconcileConfluence,
  computeLevelPercents,
} from '../src/common/utils/analysis-normalizer';
import {
  applyDecisionToAnalysis,
  decideSignal,
  deriveSignalState,
  parseSignalState,
  type SignalDecisionResult,
  type SignalState,
  type ValidatorAction,
  type ValidatorNote,
  type ValidatorReason,
  type PriceLocation,
  type WatchReach,
  validatorReasons,
} from '../src/common/utils/signal-decision';
import type { WatchPlan } from '../src/common/utils/plan-engine';
import { BROKEN_PLAN_RULES, validateTradePlan } from '../src/common/utils/trade-plan-validator';
import { buildEngineRecord, type AnalysisIntakeTimings } from '../src/modules/ai/engine-contract';
import { ImageStorageClient } from '../src/common/utils/image-storage';
import { isProductionRuntime } from '../src/common/utils/runtime-env';
import { canUseDemoFallback, hasValidOpenAiKey } from '../src/common/utils/ai-runtime';
import { resolvePrismaDatasourceUrl } from '../src/modules/database/prisma.datasource';
import { AnalysisType } from '../src/modules/ticks/tick-packages';
import { buildAnalysisPrompt } from '../src/modules/prompt/prompt-builder.service';
import { strategyFitFields, type StrategyProfile } from '../src/common/strategy/strategy-profile';
import { startOutcomeSweeper } from './outcome.sweeper';
import { startAnalysisTracker } from './analysis-tracker';
import { trackFreeAnalysisCompleted } from '../src/common/analytics/free-funnel';
import { safeAnalysisFailureCode, trackAnalysisExecutionFailed } from '../src/common/analytics/analysis-failure';
import { MailService } from '../src/modules/mail/mail.service';
import { notifyIfFreeQuotaExhausted, retryRecoveryEmails, type RecoveryEmailDeps } from '../src/modules/mail/recovery-email';
import { LIFECYCLE_FLAG, publicUrl, runLifecycleSweep } from '../src/modules/mail/lifecycle-email';
import { ANALYSIS_RESULT_FLAG, runAnalysisResultSweep } from '../src/modules/mail/analysis-result-email';
import Stripe from 'stripe';
import { getFoundingOffer } from '../src/modules/payments/founding-offer';
import { recordSetupVersion } from '../src/modules/ai/setups.service';
import { ALERT_RULES, runAlertMonitor } from '../src/modules/ai/setup-alerts.service';
import { startTwelveDataReport } from '../src/modules/market/twelve-data';
import { registerCandleStore } from '../src/modules/market/candle-store';
import { SETUP_ALERT_EMAIL_FLAG, runSetupAlertEmailSweep } from '../src/modules/mail/setup-alert-email';
import { saveAnalysisTelemetry, telemetryFromAiSource } from '../src/modules/ai/analysis-data-coverage';
import { CHAT_EMAIL_FLAG, CHAT_SWEEP_INTERVAL_MS, runChatReplySweep } from '../src/modules/support/chat-email';
import { recordProviderComparison, type ProviderComparison } from '../src/modules/ai/vision-model';
import { loadTrialsForSweep, syncTrial } from '../src/common/analytics/trial-funnel';
import { readTrial } from '../src/common/trial';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: resolvePrismaDatasourceUrl(),
  }),
});
const aiAdapter = new AIAdapter();
const storage = new ImageStorageClient();

// So consulta cupom; sem chave, a oferta fica desligada no e-mail.
const workerStripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
  : null;

// E-mail de recuperacao quando a ultima analise gratis termina. Sem o
// StripeService aqui, "ja assina?" e a mesma checagem de banco que libera o
// acesso pago (assinatura active/trialing).
const workerMail = new MailService();
const recoveryDeps: RecoveryEmailDeps = {
  prisma,
  mail: workerMail,
  hasPaidAccess: async (userId) =>
    Boolean(
      await prisma.subscription.findFirst({
        where: { userId, status: { in: ['active', 'trialing'] } },
        select: { id: true },
      }),
    ),
  foundingOffer: () => getFoundingOffer(workerStripe),
  log: (level, message) => (level === 'warn' ? console.warn(message) : console.log(message)),
};

type SchemaRecommendation = 'COMPRA' | 'VENDA' | 'AGUARDAR';
type MarketBias = 'bullish' | 'bearish' | 'neutral';

interface JobData {
  analysisId: string;
  imageUrl: string;
  htfImageUrls?: string[];
  userId?: string;
  analysisType?: AnalysisType;
  isDemo?: boolean;
  userLanguage?: string;
  strategyProfile?: StrategyProfile | null;
  /** Versao de um setup acompanhado (o vinculo ja foi gravado na criacao). */
  setupId?: string | null;
  /** Tempos da API antes da fila (job antigo nao tem). */
  intake?: AnalysisIntakeTimings;
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
  signalState: SignalState;
  watchPlan: WatchPlan | null;
  /** real_data = niveis pelos candles reais; print = estimados do print. */
  dataMode: 'real_data' | 'print';
  watchReach: WatchReach | null;
  location: PriceLocation | null;
  validatorNotes: ValidatorNote[];
  analysis: WorkerAnalysisDetails;
}

interface WorkerParseOutcome {
  result: WorkerAnalysisResult;
  validatorAction: ValidatorAction;
  validatorReasons: ValidatorReason[];
  validatorFlags: SignalDecisionResult['validatorFlags'];
  /** validateTradePlan + decideSignal (inclui o calendario do news guard). */
  validationMs: number;
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

/**
 * Fatores de risco do modelo, virando lista, ANTES de gravar no banco.
 *
 * O QUE ESTAVA ERRADO (conferido no dado gravado em produção, 25/08/2026)
 * A versão anterior quebrava a string em `/[\n•-]+/`. O hífen ali dentro NÃO é
 * marcador de lista: ele parte qualquer palavra composta e qualquer intervalo
 * de preço. E como o resultado é gravado com `join('\n')`, o estrago fica
 * PERMANENTE no banco — nenhum conserto de tela recupera.
 *
 * Foi exatamente o que aconteceu. O que o modelo escreveu:
 *   "1) Late-stage trend ... 2) Sell-side liquidity ... 5) Failure to hold
 *    the 4240.50-4255.95 demand zone could expose 4214.75..."
 * o que ficou gravado:
 *   "stage trend ...\nside liquidity ...\nterm volatility ...\n4255.95 demand
 *    zone could expose 4214.75..."
 * "1) Late" tinha 7 caracteres e caiu no filtro `length > 10`; o resto virou
 * frase começando no meio da palavra. Num campo que é a lista de RISCOS.
 *
 * REGRAS AGORA
 * 1. Array é respeitado: cada elemento é um item.
 * 2. Quebra só em marcador de verdade: quebra de linha, bullet no início da
 *    linha, ou numeração "1)" / "2." / "3]".
 * 3. NUNCA descarta texto. Fragmento que começa em minúscula é continuação e
 *    volta colado no item anterior.
 *
 * O front tem a mesma regra em `normalizeRiskFactorsForView`
 * (components/dashboard/AnalysisResult.tsx), para as análises que já estão
 * gravadas quebradas. Ao mexer aqui, olhe lá também.
 */
function normalizeRiskFactors(value: unknown): string[] {
  const fallback = ['Nenhum fator de risco identificado'];

  const chunks = Array.isArray(value)
    ? value.map((item) => String(item ?? ''))
    : [String(value ?? '')];

  const items: string[] = [];

  for (const chunk of chunks) {
    for (const line of chunk.split(/\r?\n+/)) {
      for (const part of line.split(/(?=(?:^|\s)\d{1,2}\s*[).\]]\s+)/g)) {
        const text = part
          .replace(/^\s*[•*▪]\s*/, '')
          .replace(/^\s*\d{1,2}\s*[).\]]\s*/, '')
          .replace(/^\s*[-–—]\s+/, '')
          .trim();

        if (!text) {
          continue;
        }

        if (items.length > 0 && /^[a-záéíóúãõàâêôç]/.test(text)) {
          items[items.length - 1] = `${items[items.length - 1]} ${text}`;
        } else {
          items.push(text);
        }
      }
    }
  }

  return items.length > 0 ? items : fallback;
}

/**
 * Decisao que o adapter ja tomou (D4, 19/10/2026). Quando a fonte e o
 * AIAdapter, ela e a UNICA decisao: o worker nao roda `decideSignal` de novo
 * (antes rodava, com uma 2a consulta ao calendario, e descartava a 1a).
 */
interface AdapterDecision {
  recommendation: 'BUY' | 'SELL' | 'WAIT';
  /** 0-100, como o adapter devolve. */
  confidence: number;
  signalState: SignalState;
  watchPlan: WatchPlan | null;
  dataMode: 'real_data' | 'print';
  watchReach: WatchReach | null;
  location: PriceLocation | null;
  validatorAction: ValidatorAction;
  /** Cada mudanca de estado do validador do adapter. */
  validatorNotes: ValidatorNote[];
  validatorReasons: ValidatorReason[];
  validatorFlags: SignalDecisionResult['validatorFlags'];
  newsGuardStatus: SignalDecisionResult['newsGuardStatus'];
}

/** A decisao do adapter, se `aiSource` veio dele; null para outras fontes (demo). */
function adapterDecisionFrom(aiSource: unknown): AdapterDecision | null {
  if (!isRecord(aiSource) || !isRecord(aiSource.engineMeta)) return null;
  const meta = aiSource.engineMeta as Record<string, unknown>;
  const rec = aiSource.recommendation;
  if ((rec !== 'BUY' && rec !== 'SELL' && rec !== 'WAIT') || typeof aiSource.confidence !== 'number') return null;
  if (!Array.isArray(meta.validatorReasons) || !Array.isArray(meta.validatorFlags)) return null;
  const signalState = parseSignalState(aiSource.signalState);
  if (!signalState) return null;
  return {
    recommendation: rec,
    confidence: aiSource.confidence,
    signalState,
    watchPlan: (aiSource.watchPlan as WatchPlan | null) ?? null,
    dataMode: aiSource.dataMode === 'real_data' ? 'real_data' : 'print',
    watchReach: (aiSource.watchReach as WatchReach | null) ?? null,
    location: (aiSource.location as PriceLocation | null) ?? null,
    validatorAction: meta.validatorAction as ValidatorAction,
    validatorNotes: Array.isArray(aiSource.validatorNotes) ? (aiSource.validatorNotes as ValidatorNote[]) : [],
    validatorReasons: meta.validatorReasons as ValidatorReason[],
    validatorFlags: meta.validatorFlags as SignalDecisionResult['validatorFlags'],
    newsGuardStatus: (meta.newsGuardStatus as SignalDecisionResult['newsGuardStatus']) ?? 'disabled',
  };
}

async function toWorkerAnalysisResult(
  value: unknown,
  adapterDecision: AdapterDecision | null = null,
): Promise<WorkerParseOutcome> {
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

  // Confiança em escala 0-100, com piso de 30 em gráfico válido (paridade com o
  // adapter). normalizeConfidence devolve 0-1 aqui — convertemos para 0-100.

  const tValidation = Date.now();
  const workerRecommendation = normalizeRecommendation(source.recommendation);
  const canonicalRecommendation =
    workerRecommendation === 'COMPRA' ? 'BUY' : workerRecommendation === 'VENDA' ? 'SELL' : 'WAIT';
  const invalidationLevel =
    analysisSource.invalidationLevel != null ? Number(analysisSource.invalidationLevel) : null;
  const planFailures = validateTradePlan({
    side: canonicalRecommendation,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    invalidationLevel,
    currentPrice: ensureNumber(analysisSource.currentPrice ?? source.currentPrice, 0),
  });
  if (planFailures.some((rule) => BROKEN_PLAN_RULES.includes(rule))) {
    throw new AIAnalysisError({
      code: 'invalid_trade_plan',
      message: 'A IA retornou níveis incoerentes de entrada, stop ou alvo.',
      retriable: false,
    });
  }
  const riskRewardTp1 = computeRiskReward(entry, stopLoss, takeProfit1, canonicalRecommendation);
  const riskRewardTp2 = computeRiskReward(entry, stopLoss, takeProfit2, canonicalRecommendation);

  // Fonte = adapter: a decisao dele e a unica. A confianca e arredondada como o
  // worker sempre gravou (inteiro; com tetos inteiros, arredondar antes ou
  // depois dos tetos da o mesmo numero). Outras fontes (demo, fora de
  // producao): o worker decide sozinho, na sequencia unica do decideSignal.
  let decision: AdapterDecision;
  if (adapterDecision) {
    decision = { ...adapterDecision, confidence: Math.round(adapterDecision.confidence) };
  } else {
    // Outras fontes (demo, fora de producao): o worker decide sozinho, pelo
    // mesmo validador, e remonta a partir da analise ja decidida.
    const symbol = ensureString(analysisSource.symbol ?? source.symbol, '');
    const own = await decideSignal({
      state: parseSignalState(source.signalState) ??
        deriveSignalState(canonicalRecommendation, analysisSource.entryType, analysisSource.alternativeScenario),
      recommendation: canonicalRecommendation,
      confidence: Math.round(normalizeConfidence(source.confidence) * 100),
      trendStrength: analysisSource.trendStrength,
      structureValidation: analysisSource.structureValidation,
      symbol,
      currentPrice: ensureNumberOrNull(analysisSource.currentPrice),
      watchPlan: (source.watchPlan as WatchPlan | null) ?? null,
      estimatedLevels: { entry, stopLoss, takeProfit1, takeProfit2 },
      probabilities: {
        probabilityTp1: ensureNumberOrNull(analysisSource.probabilityTp1),
        probabilityTp2: ensureNumberOrNull(analysisSource.probabilityTp2),
        probabilityStop: ensureNumberOrNull(analysisSource.probabilityStop),
      },
      realData: null,
      planFailures,
      priceFixed: analysisSource.priceMagnitudeFixed === true,
    });
    logNewsGuardStatus(own.newsGuardStatus, symbol, console.warn, console.log);
    const decided = await toWorkerAnalysisResult(
      {
        ...source,
        recommendation: own.recommendation === 'WAIT' ? 'HOLD' : own.recommendation,
        analysis: applyDecisionToAnalysis(analysisSource, own),
      },
      {
        recommendation: own.recommendation,
        confidence: own.confidence,
        signalState: own.state,
        watchPlan: own.watchPlan,
        dataMode: own.dataMode,
        watchReach: own.watchReach,
        location: own.location,
        validatorAction: own.validatorAction,
        validatorNotes: own.validatorNotes,
        validatorReasons: validatorReasons(own.validatorNotes),
        validatorFlags: own.validatorFlags,
        newsGuardStatus: own.newsGuardStatus,
      },
    );
    return { ...decided, validationMs: Date.now() - tValidation };
  }
  const validationMs = Date.now() - tValidation;

  const finalRecommendation: SchemaRecommendation =
    decision.recommendation === 'BUY'
      ? 'COMPRA'
      : decision.recommendation === 'SELL'
        ? 'VENDA'
        : 'AGUARDAR';
  const finalConfidencePct = decision.confidence;

  // Probabilidades por alvo — mesma regra do adapter (paridade worker/adapter):
  // sem trio completo ou plano de trade, não publica estimativas fabricadas.
  const targetProbabilities = normalizeTargetProbabilities(
    {
      tp1: analysisSource.probabilityTp1,
      tp2: analysisSource.probabilityTp2,
      stop: analysisSource.probabilityStop,
    },
    { hasTradePlan: finalRecommendation !== 'AGUARDAR' && riskRewardTp1 !== null },
  );

  const result: WorkerAnalysisResult = {
    recommendation: finalRecommendation,
    confidence: finalConfidencePct / 100,
    signalState: decision.signalState,
    watchPlan: decision.watchPlan,
    dataMode: decision.dataMode,
    watchReach: decision.watchReach,
    location: decision.location,
    validatorNotes: decision.validatorNotes,
    analysis: {
      symbol: ensureString(analysisSource.symbol ?? source.symbol, 'UNKNOWN'),
      timeframe: ensureString(analysisSource.timeframe ?? source.timeframe, 'UNKNOWN'),
      currentPrice: ensureNumber(analysisSource.currentPrice ?? source.currentPrice, 0),
      entry,
      stopLoss,
      ...computeLevelPercents(entry, stopLoss, takeProfit1, takeProfit2),
      takeProfit1,
      takeProfit2,
      riskRewardRatio: finalRecommendation === 'AGUARDAR'
        ? null : formatRiskReward(riskRewardTp2 ?? riskRewardTp1),
      riskRewardTp1: finalRecommendation === 'AGUARDAR' ? null : riskRewardTp1,
      riskRewardTp2: finalRecommendation === 'AGUARDAR' ? null : riskRewardTp2,
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
      invalidationLevel,
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
  return {
    result,
    validatorAction: decision.validatorAction,
    validatorReasons: decision.validatorReasons,
    validatorFlags: decision.validatorFlags,
    validationMs,
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
      signalState: 'NO_TRADE',
      watchPlan: null,
      dataMode: 'print',
      watchReach: null,
      location: null,
      validatorNotes: [],
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
      signalState: 'ARMED',
      watchPlan: null,
      dataMode: 'print',
      watchReach: null,
      location: null,
      validatorNotes: [],
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
    signalState: 'ARMED',
    watchPlan: null,
    dataMode: 'print',
    watchReach: null,
    location: null,
    validatorNotes: [],
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
  strategyProfile?: StrategyProfile | null,
): Promise<unknown> {
  if (hasValidOpenAiKey()) {
    // Caminho VIVO em produção (RUN_EMBEDDED_WORKER=true por padrão, então
    // quase toda análise passa por aqui, não pelo ai.service síncrono).
    // Esquecer de propagar strategyProfile aqui faz o perfil de estratégia
    // pago virar no-op silencioso: o strategyHash é gravado, mas o bloco
    // nunca entra no prompt e o strategyFit nunca é gerado.
    return aiAdapter.analyzeImage(imageUrl, prompt, analysisType, htfImageUrls, strategyProfile, {
      compareProviders: true,
    });
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

interface AnalysisMetrics {
  analysisId: string;
  /** Opcional no JobData: jobs antigos na fila podem nao ter userId. */
  userId: string | undefined;
  analysisType: AnalysisType;
  outcome: 'completed' | 'invalid' | 'failed' | 'retry';
  attempt: number;
  queueWaitMs: number;
  promptMs: number;
  aiMs: number;
  parseMs: number;
  annotateMs: number;
  persistMs: number;
  totalMs: number;
  errorCode?: string;
}

/**
 * Linha unica e grepavel com a latencia REAL de producao.
 *
 * Formato estavel de proposito: da para colar no `grep '\[Metrics\]'` do Render
 * e jogar num CSV sem parser. Fases com -1 significam "nao chegou a rodar"
 * (ex.: falhou na IA, entao annotate nunca aconteceu) — nao confundir com zero.
 *
 * Nunca pode derrubar a analise: tudo dentro de try/catch.
 */
function logAnalysisMetrics(m: AnalysisMetrics): void {
  try {
    console.log(
      `[Metrics] analysis ${m.outcome} | analysisId=${m.analysisId} userId=${m.userId} ` +
        `analysisType=${m.analysisType} attempt=${m.attempt} ` +
        `queueWaitMs=${m.queueWaitMs} promptMs=${m.promptMs} aiMs=${m.aiMs} ` +
        `parseMs=${m.parseMs} annotateMs=${m.annotateMs} persistMs=${m.persistMs} ` +
        `latencyMs=${m.totalMs}` +
        (m.errorCode ? ` errorCode=${m.errorCode}` : ''),
    );
  } catch {
    /* medir nunca quebra o que esta sendo medido */
  }
}

async function processAnalysis(job: Job<JobData>) {
  const {
    analysisId,
    imageUrl,
    htfImageUrls,
    userId,
    analysisType,
    isDemo,
    userLanguage,
    strategyProfile,
    setupId,
    intake,
  } = job.data;
  const normalizedAnalysisType: AnalysisType = analysisType === 'deep' ? 'deep' : 'quick';

  console.log(`[Worker] Processing analysis ${analysisId}${isDemo ? ' [FREE]' : ''}`);

  // Instrumentacao de latencia. ESTE e o caminho vivo em producao
  // (RUN_EMBEDDED_WORKER=true), e ate 08/09/2026 ele nao media NADA: o
  // `logMetricsHook` do analysis-pipeline so e chamado em
  // `ai.service.processSynchronously`, que e o fallback sem fila. Ou seja,
  // procurar `[Metrics]` no log do Render nunca devolveu uma linha sequer de
  // uma analise real. Sem numero, otimizar latencia era chute.
  //
  // As fases sao separadas de proposito: a soma nao diz onde esta o problema.
  // `ai` e a chamada a OpenAI (o grosso), `queue` e o tempo parado esperando
  // um worker livre (sobe quando concurrency=3 satura), e `annotate` e outro
  // upload de imagem que ninguem contava.
  const t0 = Date.now();
  const queueWaitMs = typeof job.timestamp === 'number' ? Math.max(0, t0 - job.timestamp) : -1;
  let promptMs = -1;
  let aiMs = -1;
  let parseMs = -1;
  let annotateMs = -1;
  let persistMs = -1;

  let rawContent = '';

  try {
    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'processing', errorMessage: null, errorCode: null },
    });

    // ── Free analyses (isDemo=true) now run real AI — no tick cost, same pipeline ─
    const tPrompt = Date.now();
    const prompt = buildAnalysisPrompt({ userLanguage, analysisType: normalizedAnalysisType });
    promptMs = Date.now() - tPrompt;

    const tAi = Date.now();
    const aiSource = await resolveAiSource(
      imageUrl,
      prompt,
      normalizedAnalysisType,
      htfImageUrls ?? [],
      strategyProfile,
    );
    aiMs = Date.now() - tAi;

    const sourcePayload =
      aiSource &&
      typeof aiSource === 'object' &&
      'rawResponse' in aiSource &&
      (aiSource as { rawResponse?: unknown }).rawResponse
        ? (aiSource as { rawResponse: unknown }).rawResponse
        : aiSource;

    const tParse = Date.now();
    const outcome = await toWorkerAnalysisResult(sourcePayload, adapterDecisionFrom(aiSource));
    const parsed = outcome.result;
    const adapterObservation = (aiSource as { observation?: AnalysisObservation } | null)?.observation;
    const workerObservation = safeObserve(parsed, 'worker', adapterObservation, 100);
    logObservation(workerObservation, m => console.log(m));
    rawContent = extractRawContent(aiSource, parsed);
    parseMs = Date.now() - tParse;

    const validationErrors = validateTradingLogic(parsed);

    if (validationErrors.length > 0) {
      const validationMessage = `Validação falhou: ${validationErrors.join('; ')}`;

      console.error('[Worker] Análise com dados inválidos', {
        analysisId,
        errors: validationErrors,
        raw: rawContent.slice(0, 500),
      });

      const failedAnalysis = await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'failed',
          recommendation: null,
          confidence: null,
          reasoning: validationMessage,
          errorMessage: validationMessage,
          errorCode: 'validation_failed',
          result: Prisma.DbNull,
          fullResponse: rawContent,
        },
      });

      logAnalysisMetrics({
        analysisId,
        userId,
        analysisType: normalizedAnalysisType,
        outcome: 'invalid',
        attempt: job.attemptsMade + 1,
        queueWaitMs,
        promptMs,
        aiMs,
        parseMs,
        annotateMs,
        persistMs,
        totalMs: Date.now() - t0,
        errorCode: 'validation_failed',
      });

      await refundTicksForFailedAnalysis(userId, isDemo, normalizedAnalysisType, analysisId);
      await trackAnalysisExecutionFailed(prisma, {
        userId,
        analysisId,
        analysisType: normalizedAnalysisType,
        code: 'validation_failed',
        createdAt: failedAnalysis.createdAt,
      });

      return;
    }

    // Contrato v2 + validador + tempos de cada etapa (result.engine, vai ao PostHog).
    const adapterMeta =
      aiSource && typeof aiSource === 'object' && 'engineMeta' in aiSource
        ? (aiSource as { engineMeta?: { provider?: string; groundingMs?: number; modelMs?: number; parseMs?: number } }).engineMeta
        : undefined;
    const engine = buildEngineRecord({
      provider: adapterMeta?.provider ?? null,
      signalState: parsed.signalState,
      dataMode: parsed.dataMode,
      contract: {
        recommendation: parsed.recommendation === 'COMPRA' ? 'BUY' : parsed.recommendation === 'VENDA' ? 'SELL' : 'WAIT',
        confidencePct: parsed.confidence * 100,
        symbol: parsed.analysis.symbol,
        timeframe: parsed.analysis.timeframe,
        entry: parsed.analysis.entry,
        stopLoss: parsed.analysis.stopLoss,
        takeProfit1: parsed.analysis.takeProfit1,
        takeProfit2: parsed.analysis.takeProfit2,
        invalidationLevel: parsed.analysis.invalidationLevel,
        executiveSummary: parsed.analysis.executiveSummary,
        validatorReasons: outcome.validatorReasons,
      },
      validatorAction: outcome.validatorAction,
      validatorFlags: outcome.validatorFlags,
      timings: {
        image_prep_ms: intake?.imagePrepMs,
        intake_ms: intake?.intakeMs,
        queue_ms: queueWaitMs,
        prompt_ms: promptMs,
        grounding_ms: adapterMeta?.groundingMs,
        model_ms: adapterMeta?.modelMs ?? aiMs,
        // parse do adapter (JSON do modelo) + normalizacao do worker, sem a validacao.
        parse_ms: (adapterMeta?.parseMs ?? 0) + Math.max(0, parseMs - outcome.validationMs),
        // Decisao do adapter (quando houve) + a validacao local do worker.
        validation_ms: ((aiSource as { engineMeta?: { validationMs?: number } } | null)?.engineMeta?.validationMs ?? 0) +
          outcome.validationMs,
        server_total_ms: typeof intake?.receivedAt === 'number' ? Date.now() - intake.receivedAt : null,
      },
      warn: (m) => console.warn(m),
    });

    let normalized = buildPersistedAnalysisPayload({
      // O selo do perfil de estrategia vem do TOPO da resposta do adapter
      // (aiSource), nao do `parsed`, que so carrega recomendacao, confianca e
      // analise. Sem este spread ele se perdia aqui (bug ate 24/09/2026).
      source: {
        ...(parsed as unknown as Record<string, unknown>),
        ...(aiSource && typeof aiSource === 'object' && 'evidence' in aiSource && aiSource.evidence
          ? { evidence: aiSource.evidence }
          : {}),
        ...strategyFitFields(aiSource),
        engine,
      },
      recommendation: parsed.recommendation,
      bias: parsed.analysis.marketStructure.bias,
      confidence: parsed.confidence,
      reasoning: parsed.analysis.reasoning,
      analysis: toPersistedAnalysis(parsed),
      presentation: { language: userLanguage || 'en', additionalCharts: (aiSource as { evidence?: { additionalChartsDelivered?: number } } | null)?.evidence?.additionalChartsDelivered ?? -1 },
      drawingPlan: null,
      originalImageUrl: imageUrl,
    });

    const tAnnotate = Date.now();
    normalized = await persistAnnotatedImage(normalized, userId);
    annotateMs = Date.now() - tAnnotate;

    const candidateObservation = safeObserve(normalized.fullResponse, 'persistence_candidate', workerObservation);
    logObservation(candidateObservation, m => console.log(m));
    const tPersist = Date.now();
    const persisted = await prisma.analysis.update({
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
        errorCode: null,
      },
    });
    if (persisted?.result) logObservation(safeObserve(persisted, 'persisted', candidateObservation), m => console.log(m));
    // Modelo que respondeu e numeros do grounding, fora do `result` (que a tela le).
    await saveAnalysisTelemetry(prisma, analysisId, telemetryFromAiSource(aiSource), (m) => console.warn(m));
    // Modo comparacao de provedores (desligado por padrao): grava depois, sem segurar a analise.
    const providerComparison =
      aiSource && typeof aiSource === 'object' && 'providerComparison' in aiSource
        ? (aiSource as { providerComparison?: Promise<ProviderComparison | null> }).providerComparison
        : undefined;
    if (providerComparison && userId) {
      void recordProviderComparison(prisma, { analysisId, userId, comparison: providerComparison }, (m) => console.warn(m));
    }
    persistMs = Date.now() - tPersist;

    logAnalysisMetrics({
      analysisId,
      userId,
      analysisType: normalizedAnalysisType,
      outcome: 'completed',
      attempt: job.attemptsMade + 1,
      queueWaitMs,
      promptMs,
      aiMs,
      parseMs,
      annotateMs,
      persistMs,
      totalMs: Date.now() - t0,
    });

    console.log(`[Worker] Analysis ${analysisId} completed`);

    // Funil gratis: este e o caminho de PRODUCAO. Antes ele nao emitia nada,
    // entao a conclusao da analise 1/2/3 so existia se o navegador aceitasse
    // cookies. Fire-and-forget: analytics nunca derruba o job.
    if (isDemo && userId) {
      void trackFreeAnalysisCompleted(prisma, { userId, analysisId, completedAt: new Date() });
      void notifyIfFreeQuotaExhausted(recoveryDeps, userId);
      // Trial de 3 dias: retrato do dia e eventos (limite do dia, fim).
      void syncTrial(prisma, userId);
    }
    // Setup acompanhado: ultima atualizacao e `setup_update_completed`. O motor
    // nunca viu o setupId; isto so roda depois de a analise estar gravada.
    if (setupId && userId) {
      void recordSetupVersion(
        prisma,
        { analysisId, userId, setupId, analysisType: normalizedAnalysisType, isDemo: Boolean(isDemo) },
        (message) => console.warn(message),
      );
    }
  } catch (error) {
    console.error(`[Worker] Error processing analysis ${analysisId}:`, error);

    const totalAttemptsForMetrics = job.opts.attempts ?? 3;
    const attemptsDoneForMetrics = (job.attemptsMade ?? 0) + 1;
    logAnalysisMetrics({
      analysisId,
      userId,
      analysisType: normalizedAnalysisType,
      outcome:
        error instanceof AIAnalysisError && !error.retriable
          ? 'failed'
          : attemptsDoneForMetrics >= totalAttemptsForMetrics
            ? 'failed'
            : 'retry',
      attempt: attemptsDoneForMetrics,
      queueWaitMs,
      promptMs,
      aiMs,
      parseMs,
      annotateMs,
      persistMs,
      totalMs: Date.now() - t0,
      errorCode: safeAnalysisFailureCode(error instanceof AIAnalysisError ? error.code : null),
    });

    const safeMessage = safeWorkerErrorMessage(error);
    const failureRawContent =
      rawContent ||
      (error instanceof AIAnalysisError && error.rawContent ? error.rawContent : null);

    // Non-retriable error → fail permanently and immediately
    if (error instanceof AIAnalysisError && !error.retriable) {
      const failedAnalysis = await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'failed',
          reasoning: safeMessage,
          errorMessage: safeMessage,
          errorCode: safeAnalysisFailureCode(error.code),
          result: Prisma.DbNull,
          fullResponse: failureRawContent,
        },
      });
      await refundTicksForFailedAnalysis(userId, isDemo, normalizedAnalysisType, analysisId);
      await trackAnalysisExecutionFailed(prisma, {
        userId,
        analysisId,
        analysisType: normalizedAnalysisType,
        code: error.code,
        createdAt: failedAnalysis.createdAt,
      });
      throw new UnrecoverableError(error.message);
    }

    // Retriable error — decide based on remaining attempts
    const totalAttempts = job.opts.attempts ?? 3;
    const attemptsDone = (job.attemptsMade ?? 0) + 1; // current attempt counts as done
    const isLastAttempt = attemptsDone >= totalAttempts;

    if (isLastAttempt) {
      // Exhausted all retries — set final failure state
      const failedAnalysis = await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'failed',
          reasoning: safeMessage,
          errorMessage: safeMessage,
          errorCode: safeAnalysisFailureCode(error instanceof AIAnalysisError ? error.code : null),
          result: Prisma.DbNull,
          fullResponse: failureRawContent,
        },
      });
      await refundTicksForFailedAnalysis(userId, isDemo, normalizedAnalysisType, analysisId);
      await trackAnalysisExecutionFailed(prisma, {
        userId,
        analysisId,
        analysisType: normalizedAnalysisType,
        code: error instanceof AIAnalysisError ? error.code : 'processing_unclassified',
        createdAt: failedAnalysis.createdAt,
      });
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
// Loja de apps no WORKER. Processo separado da API, então tem o próprio cache:
// uma mudança feita no painel /admin leva até 1 minuto para valer aqui. É o
// custo de não ter pub/sub, e nenhuma destas flags precisa de propagação
// instantânea. Sem isto, ligar/desligar pelo painel não afetaria a análise
// (que roda no worker) — só a API, que é justamente onde a flag NÃO é usada.
startFlagRefresh(async () =>
  prisma.$queryRaw<Array<{ key: string; value: string }>>`
    SELECT "key", "value" FROM "tickrify"."FeatureFlag"
  `.catch(() => []),
);

startOutcomeSweeper(prisma);

// Armazem de velas (REAL DATA de toda analise) e rastreador de resultado dos planos.
void registerCandleStore(prisma, (m) => console.log(m));
startAnalysisTracker(prisma);

// Consumo do Twelve Data (twelve-data.ts): `[twelvedata] day=N/800 ...` de hora em hora.
startTwelveDataReport();

// E-mails de ciclo de vida (lifecycle-email.ts): a cada 15 min, primeira volta
// 5 min depois do boot. Com as chaves do /admin desligadas (padrao), so loga
// `[lifecycle] dry-run ...`: quem receberia, sem enviar e sem gravar.
const LIFECYCLE_INTERVAL_MS = 15 * 60 * 1000;
const lifecycleTick = async () => {
  const counts = await runLifecycleSweep({
    prisma,
    // Trial de 3 dias: sincroniza os ativos e entrega o estado aos e-mails.
    loadTrials: () => loadTrialsForSweep(prisma),
    // Com TRIAL_MODE ligado, conta sem analise gratis ja e do trial (a linha so
    // nasce na 1a visita ao painel): nunca recebe o e-mail dos "3 planos".
    hasTrial: async (userId) =>
      Boolean(await readTrial(prisma, userId)) ||
      (flagBool('TRIAL_MODE') &&
        (await prisma.analysis.count({ where: { userId, isDemo: true, status: { not: 'failed' } } })) === 0),
    mail: workerMail,
    isEnabled: (kind) => flagBool(LIFECYCLE_FLAG[kind]),
    appUrl: publicUrl(process.env.FRONTEND_URL, 'https://tickrify.com'),
    apiBaseUrl: publicUrl(process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL, 'https://tickrify.onrender.com'),
    log: (level, message) => (level === 'warn' ? console.warn(message) : console.log(message)),
  }).catch((err) => {
    console.warn(`[lifecycle] Varredura falhou: ${(err as Error)?.message ?? err}`);
    return null;
  });
  if (counts && Object.values(counts).some((n) => n > 0)) {
    console.log(`[lifecycle] Volta: ${JSON.stringify(counts)}`);
  }
  // "O que aconteceu com a sua analise" (analysis-result-email.ts), chave
  // EMAIL_ANALYSIS_RESULT desligada: so dry-run.
  const results = await runAnalysisResultSweep({
    prisma,
    mail: workerMail,
    isEnabled: () => flagBool(ANALYSIS_RESULT_FLAG),
    appUrl: publicUrl(process.env.FRONTEND_URL, 'https://tickrify.com'),
    apiBaseUrl: publicUrl(process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL, 'https://tickrify.onrender.com'),
    log: (level, message) => (level === 'warn' ? console.warn(message) : console.log(message)),
  }).catch((err) => {
    console.warn(`[analysis-result] Varredura falhou: ${(err as Error)?.message ?? err}`);
    return null;
  });
  if (results && results.sent > 0) console.log(`[analysis-result] Volta: ${JSON.stringify(results)}`);
  // E-mail de "gratis esgotado" que o provedor recusou (recovery-email.ts).
  const retried = await retryRecoveryEmails(recoveryDeps);
  if (retried > 0) console.log(`[recovery] Retentativa: ${retried}`);
};
// `unref()`: o timer nao segura o processo sozinho. Em producao quem mantem o
// worker vivo e a conexao da fila; sem o unref, todo teste que importa este
// arquivo deixava o jest preso e o CI rodava ate o limite de 6h (desde 29/09).
setTimeout(() => {
  void lifecycleTick();
  setInterval(() => void lifecycleTick(), LIFECYCLE_INTERVAL_MS).unref();
}, 5 * 60 * 1000).unref();

// Chat com o fundador: e-mail "Vinicius replied" para quem nao leu a resposta
// em 10 min (chat-email.ts). Chave CHAT_EMAIL_NOTIFY desligada: so dry-run.
const chatReplyTick = async () => {
  const result = await runChatReplySweep({
    prisma,
    mail: workerMail,
    isEnabled: () => flagBool(CHAT_EMAIL_FLAG),
    appUrl: publicUrl(process.env.FRONTEND_URL, 'https://tickrify.com'),
    apiBaseUrl: publicUrl(process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL, 'https://tickrify.onrender.com'),
    log: (level, message) => (level === 'warn' ? console.warn(message) : console.log(message)),
  }).catch((err) => {
    console.warn(`[chat] Varredura falhou: ${(err as Error)?.message ?? err}`);
    return null;
  });
  if (result && result.sent > 0) console.log(`[chat] Avisos de resposta: ${result.sent}`);
};
setInterval(() => void chatReplyTick(), CHAT_SWEEP_INTERVAL_MS).unref();

// Alertas de nivel dos setups (setup-alerts.service.ts): a cada 10 min, so com
// alertas ativos; depois o e-mail dos disparos (chave EMAIL_SETUP_ALERTS
// desligada = so dry-run). Primeira volta 2 min depois do boot.
const alertTick = async () => {
  const counts = await runAlertMonitor({
    prisma,
    log: (level, message) => (level === 'warn' ? console.warn(message) : console.log(message)),
  }).catch((err) => {
    console.warn(`[alerts] Varredura falhou: ${(err as Error)?.message ?? err}`);
    return null;
  });
  if (counts && (counts.symbols > 0 || counts.triggered > 0)) {
    console.log(`[alerts] symbols=${counts.symbols} checked=${counts.checked} triggered=${counts.triggered} paused=${counts.paused}`);
  }
  const emails = await runSetupAlertEmailSweep({
    prisma,
    mail: workerMail,
    isEnabled: () => flagBool(SETUP_ALERT_EMAIL_FLAG),
    appUrl: publicUrl(process.env.FRONTEND_URL, 'https://tickrify.com'),
    apiBaseUrl: publicUrl(process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL, 'https://tickrify.onrender.com'),
    log: (level, message) => (level === 'warn' ? console.warn(message) : console.log(message)),
  }).catch((err) => {
    console.warn(`[setup-alert] Varredura falhou: ${(err as Error)?.message ?? err}`);
    return null;
  });
  if (emails && emails.sent > 0) console.log(`[setup-alert] Volta: ${JSON.stringify(emails)}`);
};
setTimeout(() => {
  void alertTick();
  setInterval(() => void alertTick(), ALERT_RULES.monitorIntervalMs).unref();
}, 2 * 60 * 1000).unref();

async function shutdown() {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
