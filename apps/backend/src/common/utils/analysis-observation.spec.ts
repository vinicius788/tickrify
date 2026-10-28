import { createHash } from 'crypto';
import { observeAnalysis, safeObserve, rawObservation, logObservation } from './analysis-observation';

const checklist = '✅ HTF | ❌ Zone | ✅ ICT | ✅ Anti-retail | ✅ Structure | ✅ R:R | ❌ MTF → 4/7';
const plan = (extra: Record<string, unknown> = {}, side = 'BUY') => ({ recommendation: side, confidence: 60,
  analysis: { currentPrice: 101, entry: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 120,
    invalidationLevel: 96, entryType: 'limit', entryCondition: 'Pending order: buy limit 100; cancel after close below 96.',
    factorsPresent: 5, confluenceScore: 71.43, structureValidation: checklist.replace('4/7', '5/7'),
    riskRewardTp1: 2, riskRewardTp2: 4, stopLossPercent: -5, takeProfit1Percent: 10, takeProfit2Percent: 20,
    tp1ClosePercent: 50, tp2ClosePercent: 50, probabilityTp1: 60, probabilityTp2: 40, probabilityStop: 40,
    ...extra } });
const codes = (p: unknown, stage: Parameters<typeof observeAnalysis>[1] = 'raw') => observeAnalysis(p, stage).alerts.map(a => a.code);

describe('V1-derived observations do not participate in trading decisions', () => {
  it('keeps a valid plan immutable and has no alerts', () => {
    const p = plan(), before = JSON.stringify(p); expect(codes(p)).toEqual([]); expect(JSON.stringify(p)).toBe(before);
  });
  it.each(['BUY', 'SELL'])('observes invalid %s geometry without fixing prices', side => {
    expect(codes(plan({ stopLoss: side === 'BUY' ? 101 : 99 }, side))).toContain('direction');
  });
  it('zero risk is diagnosed without division by zero', () => expect(codes(plan({ stopLoss: 100 }))).toContain('zero_risk'));
  it.each([Infinity, -Infinity, NaN, '100'])('does not certify invalid numeric value %s', entry => {
    expect(codes(plan({ entry }))).toContain('numeric_invalid');
  });
  it('distinguishes null, absent and malformed numeric values', () => {
    expect(observeAnalysis(plan({ takeProfit2: null }), 'raw').snapshot.takeProfit2).toBeNull();
    const p = plan(); delete (p.analysis as any).takeProfit2;
    expect(observeAnalysis(p, 'raw').snapshot).not.toHaveProperty('takeProfit2');
  });
  it('extreme arithmetic remains an observation and never throws', () => {
    expect(() => observeAnalysis(plan({ entry: Number.MAX_VALUE, stopLoss: Number.MIN_VALUE, takeProfit1: Number.MAX_VALUE }), 'raw')).not.toThrow();
  });
  it.each([0, -0, -0.00])('accepts legitimate tiny stop rounded to %s', stopLossPercent => {
    expect(codes(plan({ stopLoss: 99.99999, takeProfit1: 100.00001, takeProfit2: 100.00002,
      invalidationLevel: 99.999999, stopLossPercent, takeProfit1Percent: 0, takeProfit2Percent: 0,
      riskRewardTp1: 1, riskRewardTp2: 2 }))).not.toContain('percent_mismatch');
  });
  it.each([1.2, 1.20, 12e-1])('equivalent numerical notation gets the same tolerance %s', takeProfit1Percent => {
    expect(codes(plan({ takeProfit1: 101.2, takeProfit1Percent, riskRewardTp1: 0.24 }))).not.toContain('percent_mismatch');
  });
  it('records false stop sign and R disagreement', () => {
    expect(codes(plan({ stopLossPercent: 5, riskRewardTp1: 3 }))).toEqual(expect.arrayContaining(['stop_percent_positive', 'r_mismatch']));
  });
  it.each([[101, 0], [50, 51], [-1, 50], [50.5, 49.5]])('invalid partials %s/%s', (tp1ClosePercent, tp2ClosePercent) => {
    expect(codes(plan({ tp1ClosePercent, tp2ClosePercent }))).toContain('partial_allocation_invalid');
  });
  it('leaves valid residual allocation alone', () => expect(codes(plan({ tp1ClosePercent: 25, tp2ClosePercent: 25 }))).not.toContain('partial_allocation_invalid'));
  it('only raw HOLD with operational fields is flagged, not a guard WAIT', () => {
    expect(codes(plan({}, 'HOLD'))).toContain('raw_hold_operational_fields');
    expect(codes(plan({}, 'WAIT'), 'persisted')).not.toContain('raw_hold_operational_fields');
    expect(codes({ recommendation: 'HOLD', analysis: { invalidationLevel: 95 } })).toContain('raw_hold_operational_fields');
  });
  it('valid HOLD without plan passes', () => expect(codes({ recommendation: 'HOLD', confidence: 35, analysis: {} })).toEqual([]));
  it('score and prose conflict are alerts, not new factor evidence', () => {
    expect(codes(plan({ executiveSummary: 'Checklist 4/7', confluenceScore: 100 }))).toEqual(expect.arrayContaining(['prose_count_conflict', 'confluence_mismatch']));
  });
  it.each([-1, 101, Infinity])('confidence and probability bounds %s', value => {
    const p = plan({ probabilityTp1: value }); p.confidence = value;
    expect(codes(p)).toEqual(expect.arrayContaining(['confidence_bounds', 'probability_bounds']));
  });
  it('only checks unambiguous nested probabilities with ordered targets', () => {
    expect(codes(plan({ probabilityTp2: 80 }))).toContain('nested_probability_conflict');
    expect(codes(plan({ takeProfit2: 105, probabilityTp2: 80 }))).not.toContain('nested_probability_conflict');
  });
  it('accepts fraction probabilities according to the existing raw convention', () => {
    expect(codes(plan({ probabilityTp1: 0.6, probabilityTp2: 0.4, probabilityStop: 0.4 }))).not.toContain('exclusive_probability_conflict');
  });
  it('limits POC text checking to non-hypothetical, unambiguous comparisons', () => {
    expect(codes(plan({ marketStructure: { priceZone: 'Abaixo do POC 90' } }))).toContain('poc_relation_conflict');
    expect(codes(plan({ marketStructure: { priceZone: 'Se abaixo do POC 90, aguardar' } }))).not.toContain('poc_relation_conflict');
    expect(codes(plan({ entry: 90, currentPrice: 101, marketStructure: { priceZone: 'below POC 95' } }))).not.toContain('poc_relation_conflict');
  });
  it('compares states under explicit confidence units and keeps absence distinct', () => {
    const raw = observeAnalysis(plan(), 'raw'); const p = plan({ takeProfit2: null }); p.confidence = 0.6;
    const worker = observeAnalysis(p, 'worker', raw, 100);
    expect(worker.differences).toContainEqual({ field: 'takeProfit2', before: 120, after: null });
    expect(worker.differences.some(d => d.field === 'confidence')).toBe(false);
  });
  it('observes explicit R text only if it matches neither valid target, with rounding tolerance', () => {
    expect(codes(plan({ riskRewardRatio: '1:9' }))).toContain('r_text_matches_neither_target');
    expect(codes(plan({ riskRewardRatio: '1:2.0' }))).not.toContain('r_text_matches_neither_target');
    expect(codes(plan({ riskRewardRatio: '1:4,00' }))).not.toContain('r_text_matches_neither_target');
  });
  it('does not misclassify an invalid raw recommendation as a raw HOLD', () => {
    expect(codes(plan({}, 'nonsense'))).not.toContain('raw_hold_operational_fields');
  });
  it('public DTO nulls take precedence over a retained nested diagnostic plan', () => {
    const stored = { recommendation: 'WAIT', confidence: 45, result: plan().analysis ? { recommendation: 'WAIT', analysis: plan().analysis } : {} };
    const prior = observeAnalysis(stored, 'persisted');
    const report = observeAnalysis({ recommendation: 'WAIT', confidence: 45, fullResponse: stored.result,
      entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null }, 'public', prior);
    expect(report.snapshot.entry).toBeNull();
    expect(report.differences).toContainEqual({ field: 'entry', before: 100, after: null });
    expect(report.alerts.map(a => a.code)).not.toContain('raw_hold_operational_fields');
  });
  it.each([[6, 85.7], [3, 42.9], [6, 86], [5, 71.43]])('legitimate rounded confluence %s/%s is not an error', (factorsPresent, confluenceScore) => {
    expect(codes(plan({ factorsPresent, confluenceScore }))).not.toContain('confluence_mismatch');
  });
  it('retains the two historical rounding-borderline cases as low-certainty convention alerts', () => {
    const r = observeAnalysis(plan({ entry: 2378, stopLoss: 2364, takeProfit1: 2400, takeProfit2: 2415,
      stopLossPercent: -0.59, takeProfit1Percent: 0.93, takeProfit2Percent: 1.55 }), 'raw');
    expect(r.alerts).toContainEqual({ code: 'percent_rounding_borderline', field: 'takeProfit2Percent', impact: 'low', certainty: 'rounding_convention' });
  });
  it('does not report missing/failed recommendations as legitimate WAIT', () => {
    const report = observeAnalysis({ status: 'failed', recommendation: null, result: null }, 'persisted');
    expect(report.snapshot).toMatchObject({ status: 'failed', recommendation: null });
    expect(observeAnalysis(plan({}, 'HOLD'), 'raw').snapshot.recommendation).toBe('WAIT');
  });
  it('logs no raw text, prices, images, credentials or payloads and tolerates logger failure', () => {
    const p = plan({ executiveSummary: 'private text', entryCondition: 'Touch 100' });
    const report = rawObservation(JSON.stringify(p))!; const emit = jest.fn(); logObservation(report, emit);
    const line = emit.mock.calls[0][0]; expect(line).not.toMatch(/private text|Touch 100|currentPrice|rawSha256/);
    expect(() => logObservation(report, () => { throw Error('log unavailable'); })).not.toThrow();
    expect(safeObserve(new Proxy({}, { get: () => { throw Error(); } }), 'raw')).toBeUndefined();
  });
});


// C1 synthetic: traceability only; these strings do not certify market events.
describe('C1 technical evidence text trace', () => {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const texts = [
    'BOS potential; candle close pending', 'BOS potencial; fechamento pendente',
    'BOS potencial; cierre pendiente', 'BOS potentiel; clôture en attente',
    'BOS möglich; Schlusskurs ausstehend', 'BOS候補、終値での確認待ち',
  ];
  const fields = ['technicalAnalysis', 'identifiedPatterns', 'keyIndicators', 'timeframe', 'entryCondition',
    'marketStructure.bias', 'marketStructure.lastStructure', 'marketStructure.breakOfStructure',
    'marketStructure.priceZone', 'marketStructure.orderBlock'];
  const fixture = (field: string, text: unknown) => field.startsWith('marketStructure.')
    ? plan({ marketStructure: { [field.split('.')[1]]: text } }) : plan({ [field]: text });
  it.each(texts)('hashes verbatim evidence without certifying it: %s', text => {
    const value = fixture('marketStructure.breakOfStructure', text), before = JSON.stringify(value);
    const report = observeAnalysis(value, 'raw');
    expect(report.snapshot['marketStructure.breakOfStructureSha256']).toBe(hash(text));
    expect(JSON.stringify(report.snapshot)).not.toContain(text);
    expect(report.alerts).toEqual([]);
    expect(JSON.stringify(value)).toBe(before);
  });
  it.each(fields)('tracks only the hash of a changed technical field: %s', field => {
    const before = observeAnalysis(fixture(field, 'C1 candidate, not confirmed'), 'raw');
    const after = observeAnalysis(fixture(field, 'C1 reported confirmation'), 'adapter', before);
    expect(after.differences).toEqual([{ field: field + 'Sha256', before: hash('C1 candidate, not confirmed'), after: hash('C1 reported confirmation') }]);
    const logged: string[] = [];
    logObservation(after, line => logged.push(line));
    expect(logged.join('')).not.toContain('C1 reported confirmation');
    expect(logged.join('')).toContain(field + 'Sha256');
  });
  it('preserves evidence fingerprints across existing in-memory and stored-shaped paths', () => {
    const value = fixture('marketStructure.orderBlock', 'candidate OB, origin not certified');
    let report = observeAnalysis(value, 'raw');
    for (const stage of ['adapter', 'worker', 'persistence_candidate', 'persisted', 'public'] as const) {
      const shaped = stage === 'persisted' || stage === 'public'
        ? { ...value, analysis: undefined, fullResponse: { analysis: value.analysis } } : value;
      report = observeAnalysis(shaped, stage, report);
      expect(report.differences).toEqual([]);
    }
  });
  it('does not manufacture text fingerprints for missing or non-string fields', () => {
    for (const value of [undefined, null, 0, false, [], {}]) {
      expect(observeAnalysis(fixture('marketStructure.breakOfStructure', value), 'raw').snapshot['marketStructure.breakOfStructureSha256'])
        .toBeUndefined();
    }
  });
});
