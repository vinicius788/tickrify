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
}
