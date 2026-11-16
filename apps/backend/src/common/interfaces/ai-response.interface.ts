import type { SetupContinuation } from '../../modules/ai/setup-continuation';
import type { AnalysisObservation } from '../utils/analysis-observation';
import { Bias, Recommendation } from '../utils/analysis-normalizer';
import { DrawingPlan } from '../utils/drawing-plan';
import type { GroundingStats } from '../../modules/ai/analysis-data-coverage';
import type { EntryLevels } from '../utils/plan-engine';
import type { PriceLocation, RejectedPlan, SignalDecisionResult, SignalState, ValidatorAction, ValidatorNote, ValidatorReason, WatchReach } from '../utils/signal-decision';
import type { WatchPlan } from '../utils/plan-engine';
import type { AiLevel, LevelMap } from '../utils/level-map';
import type { ProviderComparison } from '../../modules/ai/vision-model';

export interface AnalysisEvidence {
  version: 1;
  additionalChartsDelivered: number;
  candleFeedAttached: boolean;
  /** So quando as velas nao vieram porque a leitura do print passou do tempo. */
  candleFailure?: 'read_timeout';
  marketContextAttached: boolean;
  /** not_attached: o calendario nao foi buscado para esta analise (quick ou contexto desligado). */
  calendar: 'events_attached' | 'no_events_returned' | 'not_attached' | 'not_confirmed';
}

export interface AIAnalysisResponse {
  /** In-memory diagnostic only; excluded from persisted/public contracts. */
  observation?: AnalysisObservation;
  recommendation: Recommendation;
  /** Estado final, decidido pelo validador (signal-decision.ts). */
  signalState: SignalState;
  /** Plano do modelo em WATCH, ARMED e ENTER_NOW; null no NO_TRADE. */
  watchPlan: WatchPlan | null;
  /** real_data = niveis e distancia pelos candles reais; print = estimados do print. */
  dataMode: 'real_data' | 'print';
  /** Chance calibrada de o preco chegar ao nivel do WATCH na validade; null sem calibracao. */
  watchReach: WatchReach | null;
  /** Onde o preco esta (modo leitura); null sem REAL DATA. */
  location: PriceLocation | null;
  /** WATCH: niveis que o motor usaria ao destravar no nivel (TP1 com teto); null sem REAL DATA. */
  watchLevels: EntryLevels | null;
  /** NO_TRADE com REAL DATA: niveis dos dois lados do preco (level-map.ts); null fora disso. */
  levelMap: LevelMap | null;
  /** NO_TRADE em que o validador recusou o plano do modelo: o preco que a IA marcou, so para a tela. */
  aiLevel?: AiLevel | null;
  /** Cada mudanca de estado com o motivo, escrita pelo codigo (nunca pelo modelo). */
  validatorNotes: ValidatorNote[];
  /** So quando o plano anterior do setup entrou no prompt (setup-continuation.ts). */
  continuation?: SetupContinuation;
  /** Modelo pediu WATCH ou ENTER_NOW e o codigo rebaixou para NO_TRADE. So medicao. */
  rejectedPlan?: RejectedPlan;
  /** ENTER_NOW liberado pela chave ENGINE_ENTER_AT_LEVEL. */
  enterAtLevel?: boolean;
  /** Plano que seguiu com a invalidacao do modelo (chave ENGINE_SNAP_FALLBACK). So medicao. */
  snapFallback?: boolean;
  /** ENTER_NOW com C2 ou C7 em FAIL (chave ENGINE_ENTER_REQUIRED_CHECKS). */
  entryWarnings?: number[];
  /** ENTER_NOW que so existe pelo modo permissivo (chave ENGINE_PERMISSIVE). So medicao. */
  permissiveEntry?: boolean;
  /** WATCH com a entrada a mercado de geometria valida (chave ENGINE_MARKET_PLAN_ON_WATCH). */
  marketLevels?: EntryLevels;
  bias: Bias;
  confidence: number; // 0-100
  reasoning: string;
  analysis?: Record<string, any>;
  drawingPlan?: DrawingPlan | null;
  drawingFailed?: boolean;
  originalImageUrl?: string | null;
  annotatedImageUrl?: string | null;
  technicalIndicators?: {
    support?: number;
    resistance?: number;
    trend?: string;
  };
  rawResponse?: any;
  rawContent?: string;
  evidence?: AnalysisEvidence;
  // TRAVA 1: campo lido do modelo e propagado, nunca usado para decidir
  // `recommendation`. Ver strategy-profile.ts e ai.adapter.ts.
  strategyFit?: string | null;
  strategyFitReason?: string | null;
  // Telemetria por analise, gravada fora do `result` (saveAnalysisTelemetry).
  respondedModel?: string | null;
  groundingStats?: GroundingStats | null;
  // O que o validador fez e o tempo de cada etapa dentro do adapter
  // (vai para `result.engine`, ver engine-contract.ts).
  /** Modo comparacao (vision-model.ts): resolve depois da analise; so quem grava le. */
  providerComparison?: Promise<ProviderComparison | null>;
  engineMeta?: {
    /** Provedor de IA que respondeu (openai | anthropic). */
    provider: string;
    validatorAction: ValidatorAction;
    validatorReasons: ValidatorReason[];
    validatorFlags: SignalDecisionResult['validatorFlags'];
    /** Status do news guard da decisao do adapter (so em memoria e log; o worker reusa). */
    newsGuardStatus: SignalDecisionResult['newsGuardStatus'];
    groundingMs: number;
    modelMs: number;
    parseMs: number;
    validationMs: number;
  };
}
