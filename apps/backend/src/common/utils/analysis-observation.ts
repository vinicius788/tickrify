import { createHash } from 'crypto';
import { computeLevelPercents, computeRiskReward, countChecklistApproved, hasInvalidTradePlanLevels, normalizeRecommendation } from './analysis-normalizer';

/** Observation only. Never passed to decideSignal, a retry predicate or a public contract. */
export type ObservationStage = 'raw' | 'adapter' | 'worker' | 'persistence_candidate' | 'persisted' | 'public';
export interface ObservationAlert {
  code: string;
  field: string;
  impact: 'high' | 'medium' | 'low';
  certainty: 'deterministic' | 'text_pattern' | 'rounding_convention';
}
export interface AnalysisObservation {
  stage: ObservationStage;
  rawSha256?: string;
  snapshot: Record<string, unknown>;
  alerts: ObservationAlert[];
  differences: { field: string; before: unknown; after: unknown }[];
}
const obj = (x: unknown): Record<string, any> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, any> : {};
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const positive = (x: unknown): x is number => finite(x) && x > 0;
const levels = ['currentPrice', 'entry', 'stopLoss', 'takeProfit1', 'takeProfit2', 'invalidationLevel'] as const;
const numericFields = [...levels, 'riskRewardTp1', 'riskRewardTp2', 'factorsPresent', 'confluenceScore',
  'stopLossPercent', 'takeProfit1Percent', 'takeProfit2Percent', 'tp1ClosePercent', 'tp2ClosePercent',
  'probabilityTp1', 'probabilityTp2', 'probabilityStop'] as const;
/** A suffix 4/7 in prose is only an alert; it is not evidence of four valid factors. */
export function proseFactorCounts(value: unknown): number[] {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/\b([0-7])\s*\/\s*7\b/gu)].map(m => Number(m[1]));
}
function closeEnough(actual: number, expected: number): boolean {
  // V1 numeric-value convention: notation/terminal zeros do not change tolerance.
  const canonical = String(actual);
  const tolerance = /^-?\d+\.\d$/.test(canonical) ? 0.05 : 0.005;
  return Math.abs(actual - expected) <= tolerance + Number.EPSILON * Math.max(1, Math.abs(expected)) * 8;
}

export function observeAnalysis(value: unknown, stage: ObservationStage, previous?: AnalysisObservation,
  confidenceScale = 1): AnalysisObservation {
  const v = obj(value), nested = obj(v.result ?? v.fullResponse), a = { ...obj(v.analysis ?? nested.analysis) };
  if (stage === 'public') for (const key of [...numericFields, 'riskRewardRatio']) {
    if (Object.prototype.hasOwnProperty.call(v, key)) a[key] = v[key];
  }
  const fieldValue = (key: string) => Object.prototype.hasOwnProperty.call(a, key) ? a[key] : v[key];
  const side = normalizeRecommendation(v.recommendation ?? nested.recommendation);
  const wire = v.recommendation ?? nested.recommendation;
  const recognized = typeof wire === 'string' && ['BUY', 'SELL', 'HOLD', 'COMPRA', 'VENDA', 'AGUARDAR', 'WAIT'].includes(wire);
  const snapshot: Record<string, unknown> = { recommendation: recognized ? side : null };
  if (['pending', 'processing', 'completed', 'failed', 'error'].includes(v.status)) snapshot.status = v.status;
  if (typeof wire === 'string') snapshot.wireRecommendation = ['BUY', 'SELL', 'HOLD', 'COMPRA', 'VENDA', 'AGUARDAR', 'WAIT'].includes(wire) ? wire : 'unrecognized';
  if (typeof a.riskRewardRatio === 'string') snapshot.riskRewardRatio = /^1\s*[:/]\s*\d+(?:[.,]\d+)?$/u.test(a.riskRewardRatio) ? a.riskRewardRatio : 'unrecognized';
  else if (a.riskRewardRatio === null) snapshot.riskRewardRatio = null;
  if (Object.prototype.hasOwnProperty.call(v, 'confidence')) snapshot.confidence = v.confidence === null ? null : finite(v.confidence) ? v.confidence * confidenceScale : 'invalid';
  if (typeof v.is_financial_chart === 'boolean') snapshot.is_financial_chart = v.is_financial_chart;
  for (const key of numericFields) {
    const n = fieldValue(key);
    // Keep absence distinct from null. Never coerce strings into valid evidence.
    if (n !== undefined) snapshot[key] = finite(n) || n === null ? n : typeof n === 'number' ? 'non_finite' : 'wrong_type';
  }
  for (const key of ['reasoning', 'executiveSummary', 'structureValidation', 'multiTimeframeAlignment']) {
    const text = a[key] ?? (key === 'reasoning' ? v.reasoning : undefined);
    if (typeof text === 'string') snapshot[key + 'Sha256'] = createHash('sha256').update(text).digest('hex');
  }
  // C1: fingerprint the existing evidence text, never certify its market truth.
  // Flat hash keys let the same observer trace changes across API/worker stages.
  // No prose/levels are added to logs and no public/persisted field is created.
  for (const key of ['technicalAnalysis', 'identifiedPatterns', 'keyIndicators', 'timeframe', 'entryCondition']) {
    if (typeof a[key] === 'string') snapshot[key + 'Sha256'] = createHash('sha256').update(a[key]).digest('hex');
  }
  const structure = obj(a.marketStructure);
  for (const key of ['bias', 'lastStructure', 'breakOfStructure', 'priceZone', 'orderBlock']) {
    if (typeof structure[key] === 'string') snapshot['marketStructure.' + key + 'Sha256'] = createHash('sha256').update(structure[key]).digest('hex');
  }
  const alerts: ObservationAlert[] = [];
  const add = (code: string, field: string, impact: ObservationAlert['impact'] = 'high',
    certainty: ObservationAlert['certainty'] = 'deterministic') => alerts.push({ code, field, impact, certainty });
  for (const key of numericFields) {
    const n = fieldValue(key);
    if (n !== undefined && n !== null && !finite(n)) add('numeric_invalid', key);
  }
  if (v.confidence != null && (!finite(v.confidence) || v.confidence * confidenceScale < 0 || v.confidence * confidenceScale > 100)) add('confidence_bounds', 'confidence');
  if (stage === 'raw' && ['HOLD', 'AGUARDAR'].includes(v.recommendation) && [...levels.slice(1), 'riskRewardRatio', 'entryType', 'entryCondition', 'partialExitStrategy', 'tp1ClosePercent', 'tp2ClosePercent', 'breakevenTrigger', 'stopLossPercent', 'takeProfit1Percent', 'takeProfit2Percent', 'entryY', 'stopY', 'tp1Y', 'tp2Y'].some(k => a[k] != null)) add('raw_hold_operational_fields', 'analysis');
  // WAIT after a guard is not a raw HOLD. Preserved diagnostic plans are intentional.
  if (side !== 'WAIT') {
    // Reuse the existing numerical predicate, not the operational pipeline validator.
    // Observation must not add executions of validations/guards at each boundary.
    if (!positive(a.entry) || !positive(a.stopLoss) || !(positive(a.takeProfit1) || positive(a.takeProfit2))) add('incomplete', 'levels');
    if (hasInvalidTradePlanLevels(side, a.entry, a.stopLoss, a.takeProfit1, a.takeProfit2)) add('direction', 'levels');
    if (finite(a.stopLoss) && positive(a.invalidationLevel) && (side === 'BUY' ? a.stopLoss > a.invalidationLevel : a.stopLoss < a.invalidationLevel)) add('stop_inside_invalidation', 'levels');
  }
  const count = a.factorsPresent;
  if (count != null && (!Number.isInteger(count) || count < 0 || count > 7)) add('factor_count_bounds', 'factorsPresent');
  const approved = countChecklistApproved(a.structureValidation);
  if (approved !== null && finite(count) && approved !== count) add('checklist_count_mismatch', 'structureValidation');
  if (finite(count) && count >= 0 && count <= 7) {
    if (finite(a.confluenceScore) && (Number.isInteger(a.confluenceScore)
      ? Math.abs(a.confluenceScore - count / 7 * 100) > 0.5
      : !closeEnough(a.confluenceScore, count / 7 * 100))) add('confluence_mismatch', 'confluenceScore');
    for (const field of ['structureValidation', 'executiveSummary', 'reasoning']) {
      if (proseFactorCounts(a[field]).some(n => n !== count)) add('prose_count_conflict', field, 'medium', 'text_pattern');
    }
  }
  if (positive(a.entry) && positive(a.stopLoss)) {
    if (a.entry === a.stopLoss) add('zero_risk', 'stopLoss');
    const risk = Math.abs(a.entry - a.stopLoss);
    if (risk > 0 && finite(risk)) {
      for (const [target, field] of [['takeProfit1', 'riskRewardTp1'], ['takeProfit2', 'riskRewardTp2']] as const) {
        if (side !== 'WAIT' && positive(a[target])) {
          const r = computeRiskReward(a.entry, a.stopLoss, a[target], side);
          if (r !== null && finite(a[field]) && !closeEnough(a[field], r)) add('r_mismatch', field);
        }
      }
    }
    const ratio = typeof a.riskRewardRatio === 'string' ? a.riskRewardRatio.match(/^1\s*[:/]\s*(\d+(?:[.,]\d+)?)$/u) : null;
    if (ratio && side !== 'WAIT') {
      const declared = Number(ratio[1].replace(',', '.'));
      const values = [a.takeProfit1, a.takeProfit2].filter(positive).map(tp => computeRiskReward(a.entry, a.stopLoss, tp, side)).filter(finite);
      if (values.length && !values.some(r => closeEnough(declared, r))) add('r_text_matches_neither_target', 'riskRewardRatio');
    }
    const percents = computeLevelPercents(a.entry, a.stopLoss, a.takeProfit1, a.takeProfit2);
    for (const [field, expected] of Object.entries(percents)) {
      if (expected !== null && !finite(expected)) add('arithmetic_not_evaluable', field);
      else if (finite(expected) && finite(a[field]) && !closeEnough(a[field], expected)) {
        // Borderline V1 convention, not proof of an incorrect trading level.
        const tolerance = /^-?\d+\.\d$/.test(String(a[field])) ? 0.05 : 0.005;
        const borderline = (field !== 'stopLossPercent' || a[field] <= 0) && Math.abs(a[field] - expected) <= 2 * tolerance + 1e-12;
        add(borderline ? 'percent_rounding_borderline' : 'percent_mismatch', field, borderline ? 'low' : 'high', borderline ? 'rounding_convention' : 'deterministic');
      }
      if (field === 'stopLossPercent' && finite(a[field]) && a[field] > 0) add('stop_percent_positive', field);
    }
    if (!finite(risk)) add('arithmetic_not_evaluable', 'levels');
  }
  const p1 = a.tp1ClosePercent, p2 = a.tp2ClosePercent;
  if ([p1, p2].some(p => p != null && (!Number.isInteger(p) || p < 0 || p > 100)) || (finite(p1) && finite(p2) && p1 + p2 > 100) || (finite(p2) && p2 > 0 && !positive(a.takeProfit2))) add('partial_allocation_invalid', 'partials');
  const probabilities = ['probabilityTp1', 'probabilityTp2', 'probabilityStop'].map(k => a[k]);
  probabilities.forEach((p, i) => { if (p != null && (!finite(p) || p < 0 || p > 100)) add('probability_bounds', ['probabilityTp1', 'probabilityTp2', 'probabilityStop'][i]); });
  const [t1, t2, sl] = probabilities.map(p => positive(p) && p <= 100 ? p <= 1 && stage === 'raw' ? p * 100 : p : null);
  // Same pre-stop event and nested ordered targets only. No general sum-to-100 rule.
  const ordered = side === 'BUY' ? a.entry < a.takeProfit1 && a.takeProfit1 < a.takeProfit2
    : side === 'SELL' && a.entry > a.takeProfit1 && a.takeProfit1 > a.takeProfit2;
  if (ordered && positive(t1) && positive(t2) && t2 > t1) add('nested_probability_conflict', 'probabilityTp2');
  if (positive(t1) && positive(sl) && t1 + sl > 101) add('exclusive_probability_conflict', 'probabilities');
  // A narrow factual relation, not a general natural-language validator.
  const zone = typeof a.marketStructure?.priceZone === 'string' ? a.marketStructure.priceZone : '';
  const relation = zone.match(/\b(below|above|abaixo|acima)\s+(?:do\s+)?POC\s*[:=]?\s*(\d+(?:\.\d+)?)/iu);
  if (relation && !/\b(if|se|caso|not|não)\b/iu.test(zone) && positive(a.entry) && positive(a.currentPrice)) {
    const poc = Number(relation[2]), below = /below|abaixo/iu.test(relation[1]);
    if (positive(poc) && (below ? a.entry > poc && a.currentPrice > poc : a.entry < poc && a.currentPrice < poc)) add('poc_relation_conflict', 'marketStructure.priceZone', 'medium', 'text_pattern');
  }
  const differences = previous ? [...new Set([...Object.keys(previous.snapshot), ...Object.keys(snapshot)])]
    .filter(k => !Object.is(previous.snapshot[k], snapshot[k]))
    .map(field => ({ field, before: previous.snapshot[field], after: snapshot[field] })) : [];
  return { stage, snapshot, alerts, differences, ...(previous?.rawSha256 ? { rawSha256: previous.rawSha256 } : typeof v.fullResponse === 'string' ? { rawSha256: createHash('sha256').update(v.fullResponse).digest('hex') } : {}) };
}

/** Safe aggregate log: no image, raw prose, price, user ID, token or payload. */
export function logObservation(report: AnalysisObservation | undefined, emit: (line: string) => void): void {
  if (!report) return;
  try { emit(`[AnalysisObservation] ${JSON.stringify({ stage: report.stage, trace: report.rawSha256,
    alerts: report.alerts, differences: report.differences.map(d => d.field) })}`); } catch { /* fail-open diagnostics */ }
}
export function safeObserve(value: unknown, stage: ObservationStage, previous?: AnalysisObservation, confidenceScale = 1): AnalysisObservation | undefined {
  try { return observeAnalysis(value, stage, previous, confidenceScale); } catch { return undefined; }
}
export function rawObservation(content: string): AnalysisObservation | undefined {
  try { const report = safeObserve(JSON.parse(content), 'raw');
    if (report) report.rawSha256 = createHash('sha256').update(content).digest('hex');
    return report;
  } catch { return undefined; }
}
