import {
  Bias,
  Recommendation,
  normalizeBias,
  normalizeConfidence,
  normalizeReasoning,
  normalizeRecommendation,
} from './analysis-normalizer';
import {
  DrawingPlan,
  buildDemoDrawingPlan,
  ensureReasoningReferencesDrawing,
  normalizeDrawingPlan,
  renderAnnotatedImage,
} from './drawing-plan';

export interface NormalizedPersistedAnalysis {
  recommendation: Recommendation;
  bias: Bias;
  confidence: number;
  reasoning: string;
  drawingPlan: DrawingPlan | null;
  originalImageUrl: string | null;
  annotatedImageUrl: string | null;
  drawingFailed: boolean;
  fullResponse: Record<string, any>;
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAnalysisObject(
  analysis: unknown,
  bias: Bias,
): Record<string, any> | undefined {
  if (!isObject(analysis)) {
    return undefined;
  }

  const marketStructure = isObject(analysis.marketStructure)
    ? { ...analysis.marketStructure, bias }
    : { bias };

  return {
    ...analysis,
    marketStructure,
  };
}

export function buildPersistedAnalysisPayload(params: {
  source: Record<string, any>;
  recommendation?: unknown;
  bias?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
  analysis?: unknown;
  drawingPlan?: unknown;
  originalImageUrl?: string | null;
  forceDrawingPlanForDemo?: boolean;
}): NormalizedPersistedAnalysis {
  const recommendation = normalizeRecommendation(
    params.recommendation ?? params.source.recommendation ?? params.source.recomendacao,
  );
  const bias = normalizeBias(
    params.bias ??
      params.source.bias ??
      params.source.analysis?.marketStructure?.bias ??
      params.source.marketStructure?.bias,
    recommendation,
  );

  const confidence = normalizeConfidence(
    params.confidence ?? params.source.confidence ?? params.source.confianca,
    50,
  );
  const sourceReasoning =
    params.reasoning ??
    params.source.reasoning ??
    params.source.justificativa ??
    params.source.analysis?.technicalAnalysis;
  let reasoning = normalizeReasoning(sourceReasoning);

  let drawingPlan =
    normalizeDrawingPlan(params.drawingPlan) ||
    normalizeDrawingPlan(params.source.drawing_plan) ||
    normalizeDrawingPlan(params.source.drawingPlan);

  if (!drawingPlan && params.forceDrawingPlanForDemo) {
    drawingPlan = buildDemoDrawingPlan(recommendation, bias);
  }

  let annotatedImageUrl: string | null = null;
  let drawingFailed = false;
  const originalImageUrl = params.originalImageUrl || null;

  if (drawingPlan && originalImageUrl) {
    reasoning = ensureReasoningReferencesDrawing(reasoning, drawingPlan);

    try {
      annotatedImageUrl = renderAnnotatedImage(originalImageUrl, drawingPlan);
    } catch {
      drawingFailed = true;
      annotatedImageUrl = null;
    }
  } else if (drawingPlan && !originalImageUrl) {
    drawingFailed = true;
  } else {
    drawingFailed = true;
  }

  const analysis = normalizeAnalysisObject(params.analysis ?? params.source.analysis, bias);

  const fullResponse: Record<string, any> = {
    ...(isObject(params.source) ? params.source : {}),
    recommendation,
    bias,
    confidence,
    reasoning,
    analysis,
    drawing_plan: drawingPlan,
    original_image_url: originalImageUrl,
    annotated_image_url: annotatedImageUrl,
    drawing_failed: drawingFailed,
  };

  return {
    recommendation,
    bias,
    confidence,
    reasoning,
    drawingPlan,
    originalImageUrl,
    annotatedImageUrl,
    drawingFailed,
    fullResponse,
  };
}

export function normalizeStoredAnalysis(analysisRecord: {
  recommendation?: string | null;
  confidence?: number | null;
  reasoning?: string | null;
  imageUrl?: string | null;
  fullResponse?: any;
}): NormalizedPersistedAnalysis {
  const fullResponse = isObject(analysisRecord.fullResponse) ? analysisRecord.fullResponse : {};

  return buildPersistedAnalysisPayload({
    source: fullResponse,
    recommendation: analysisRecord.recommendation ?? fullResponse.recommendation,
    bias: fullResponse.bias ?? fullResponse.analysis?.marketStructure?.bias,
    confidence: analysisRecord.confidence ?? fullResponse.confidence,
    reasoning: analysisRecord.reasoning ?? fullResponse.reasoning,
    analysis: fullResponse.analysis,
    drawingPlan: fullResponse.drawing_plan ?? fullResponse.drawingPlan,
    originalImageUrl:
      analysisRecord.imageUrl ??
      fullResponse.original_image_url ??
      fullResponse.originalImageUrl ??
      null,
  });
}

