import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCoverageLine, renderCoverageReport } from './analysis-data-coverage-report.mjs';

const coverage = (overrides = {}) => ({
  schema: 1,
  analysisType: 'quick',
  assetClass: 'crypto',
  candles: 'injected',
  marketContext: 'injected',
  htfImagesRequested: 1,
  htfImagesDelivered: 1,
  ...overrides,
});

const logLine = (entry) => `2026-09-23T12:00:00Z [AnalysisDataCoverage] ${JSON.stringify(entry)}`;

test('accepts the bounded schema and discards additional sensitive fields', () => {
  const parsed = parseCoverageLine(logLine(coverage({
    userId: 'private-user',
    symbol: 'BTCUSDT',
    prompt: 'private-prompt',
  })));
  assert.deepEqual(parsed, {
    analysisType: 'quick',
    assetClass: 'crypto',
    candles: 'injected',
    marketContext: 'injected',
    htfImagesRequested: 1,
    htfImagesDelivered: 1,
  });
});

test('rejects malformed, unknown, or inconsistent coverage records', () => {
  assert.equal(parseCoverageLine('unrelated log'), null);
  assert.equal(parseCoverageLine('[AnalysisDataCoverage] {bad json'), null);
  assert.equal(parseCoverageLine(logLine(coverage({ schema: 2 }))), null);
  assert.equal(parseCoverageLine(logLine(coverage({ assetClass: 'BTCUSDT' }))), null);
  assert.equal(parseCoverageLine(logLine(coverage({ htfImagesRequested: 0, htfImagesDelivered: 1 }))), null);
  assert.equal(parseCoverageLine(logLine(coverage({ htfImagesRequested: -1 }))), null);
});

test('aggregates modes and assets with separate denominators and never prints raw records', () => {
  const report = renderCoverageReport([
    logLine(coverage({ symbol: 'SECRET-TICKER', prompt: 'SECRET-PROMPT', userId: 'SECRET-USER' })),
    logLine(coverage({ assetClass: 'forex', candles: 'stale_withheld', marketContext: 'stale_withheld', htfImagesRequested: 1, htfImagesDelivered: 0 })),
    logLine(coverage({ analysisType: 'deep', assetClass: 'metal', candles: 'not_attempted', marketContext: 'unavailable', htfImagesRequested: 0, htfImagesDelivered: 0 })),
    '[AnalysisDataCoverage] invalid-json',
  ].join('\n'));
  assert.match(report, /Registros válidos: 3/);
  assert.match(report, /Linhas de cobertura inválidas ou com esquema desconhecido: 1/);
  assert.match(report, /\| Todas \| 3 \| 1\/2 \(50\.0%\) \| 0\/1 \(0\.0%\) \| 1\/3 \(33\.3%\) \| 1\/2 \(50\.0%\) \|/);
  assert.match(report, /\| quick \| stale_withheld \| 1 \|/);
  assert.match(report, /\| deep \| not_attempted \| 1 \|/);
  assert.match(report, /## Motivos de contexto por modo/);
  assert.match(report, /\| deep \| unavailable \| 1 \|/);
  for (const secret of ['SECRET-TICKER', 'SECRET-PROMPT', 'SECRET-USER']) {
    assert.doesNotMatch(report, new RegExp(secret));
  }
});

test('shows unavailable percentages when no records are present', () => {
  const report = renderCoverageReport('other log\n[AnalysisDataCoverage] invalid');
  assert.match(report, /Registros válidos: 0/);
  assert.match(report, /\| Todas \| 0 \| 0\/0 \(n\/d\) \| 0\/0 \(n\/d\) \|/);
});
