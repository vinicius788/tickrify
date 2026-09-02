import { Bias, Recommendation } from '../utils/analysis-normalizer';
import { DrawingPlan } from '../utils/drawing-plan';

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
  // TRAVA 1: campo lido do modelo e propagado, nunca usado para decidir
  // `recommendation`. Ver strategy-profile.ts e ai.adapter.ts.
  strategyFit?: string | null;
  strategyFitReason?: string | null;
}
