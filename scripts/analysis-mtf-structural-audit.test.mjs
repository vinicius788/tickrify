import assert from 'node:assert/strict';
import test from 'node:test';
import { auditPair, auditRows } from './analysis-mtf-structural-audit.mjs';

const row = (overrides = {}) => ({
  id: 'case-1', chartSha256: 'same-chart', analysisType: 'quick', assetClass: 'crypto',
  recommendation: 'WAIT', analysis: { multiTimeframeAlignment: null, structureValidation: 'N/A MTF' },
  ...overrides,
});

test('separates unsupported MTF field and checklist pass from mere HTF wording', () => {
  const result = auditRows([
    row({ analysis: { multiTimeframeAlignment: 'M30 bullish | H1 bullish → 2/3',
      structureValidation: '✅ MTF 2/3', technicalAnalysis: 'H1 bullish' } }),
    row({ id: 'case-2', analysis: { multiTimeframeAlignment: null,
      structureValidation: 'N/A MTF', technicalAnalysis: 'HTF charts were not supplied' } }),
  ]);
  assert.equal(result.mtfFieldFilledWithoutHtf, 1);
  assert.equal(result.checklistAwardsMtfWithoutHtf, 1);
  assert.equal(result.alignmentRatioNeedsReview, 1);
  assert.equal(result.namedHtfInProseNeedsReview, 1);
});

test('checks only objective plan geometry and preserves failures in denominator', () => {
  const result = auditRows([
    row({ recommendation: 'BUY', analysis: { entry: 100, stopLoss: 105, takeProfit1: 110 } }),
    row({ id: 'case-2', recommendation: 'SELL', analysis: { entry: 100, stopLoss: 105, takeProfit1: 90 } }),
    row({ id: 'case-3', recommendation: 'WAIT', analysis: { entry: 100 } }),
    row({ id: 'case-4', error: 'timeout' }),
  ]);
  assert.equal(result.cases, 4);
  assert.equal(result.failed, 1);
  assert.equal(result.tradePlanWrongSide, 1);
  assert.equal(result.waitHasActiveLevels, 1);
});

test('rejects unpaired or different charts before comparing variants', () => {
  assert.throws(() => auditPair([row()], [row({ chartSha256: 'other' })]), /divergentes/);
  assert.throws(() => auditPair([row()], []), /Pares ausentes/);
  assert.equal(auditPair([row()], [row()]).baseline.cases, 1);
});
