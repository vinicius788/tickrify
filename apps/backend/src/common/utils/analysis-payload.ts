import {
  Bias,
  Recommendation,
  normalizeBias,
  normalizeConfidence,
  parseJsonFromContent,
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

function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function normalizeTimeframeValue(value?: string): string | undefined {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) {
    return undefined;
  }

  const compact = raw.replace(/\s+/g, '');
  if (/^\d+[MHDW]$/.test(compact)) {
    return compact;
  }
  if (/^M\d+$/.test(compact) || /^H\d+$/.test(compact) || /^D\d+$/.test(compact) || /^W\d+$/.test(compact)) {
    return compact;
  }
  if (/^MN\d+$/.test(compact)) {
    return compact;
  }

  return compact;
}

function normalizeAnalysisObject(
  analysis: unknown,
  bias: Bias,
  source?: Record<string, any>,
): Record<string, any> | undefined {
  const base = isObject(analysis) ? analysis : {};

  const marketStructure = isObject(base.marketStructure)
    ? { ...base.marketStructure, bias }
    : { bias };

  const symbol =
    pickFirstString(
      base.symbol,
      base.ticker,
      base.asset,
      base.assetName,
      base.instrument,
      base.pair,
      source?.symbol,
      source?.ticker,
      source?.asset,
      source?.assetName,
      source?.instrument,
      source?.pair,
      source?.analysis?.symbol,
      source?.analysis?.ticker,
      source?.analysis?.asset,
      source?.analysis?.assetName,
      source?.analysis?.instrument,
      source?.analysis?.pair,
    ) || 'N/A';

  const timeframeRaw = pickFirstString(
    base.timeframe,
    base.period,
    base.interval,
    source?.timeframe,
    source?.period,
    source?.interval,
    source?.analysis?.timeframe,
    source?.analysis?.period,
    source?.analysis?.interval,
  );
  const timeframe = normalizeTimeframeValue(timeframeRaw) || 'N/A';

  return {
    ...base,
    marketStructure,
    symbol,
    timeframe,
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

  const analysis = normalizeAnalysisObject(params.analysis ?? params.source.analysis, bias, params.source);

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
    symbol: analysis?.symbol,
    timeframe: analysis?.timeframe,
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
  result?: unknown;
  fullResponse?: unknown;
}): NormalizedPersistedAnalysis {
  let fullResponse: Record<string, any> = {};

  if (isObject(analysisRecord.result)) {
    fullResponse = analysisRecord.result;
  } else if (isObject(analysisRecord.fullResponse)) {
    fullResponse = analysisRecord.fullResponse;
  } else if (typeof analysisRecord.fullResponse === 'string') {
    const parsed = parseJsonFromContent(analysisRecord.fullResponse);
    if (parsed) {
      fullResponse = parsed;
    }
  }

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
