import { Bias, Recommendation } from '../utils/analysis-normalizer';
import { DrawingPlan } from '../utils/drawing-plan';
import type { GroundingStats } from '../../modules/ai/analysis-data-coverage';
import type { SignalDecisionResult, ValidatorAction } from '../utils/signal-decision';
import type { ProviderComparison } from '../../modules/ai/vision-model';

export interface AnalysisEvidence {
  version: 1;
  additionalChartsDelivered: number;
  candleFeedAttached: boolean;
  marketContextAttached: boolean;
  calendar: 'events_attached' | 'no_events_returned' | 'not_confirmed';
}

export interface AIAnalysisResponse {
  recommendation: Recommendation;
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
    validatorReasons: SignalDecisionResult['validatorReasons'];
    validatorFlags: SignalDecisionResult['validatorFlags'];
    groundingMs: number;
    modelMs: number;
    parseMs: number;
    validationMs: number;
  };
}
