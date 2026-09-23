import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildBlindPacket } from './analysis-blind-packet.mjs';

const source = JSON.parse(fs.readFileSync(new URL('./backtest/pilot-manifest.json', import.meta.url), 'utf8')).cases[0];
const row = (promptSha256, analysis) => ({
  id: source.id,
  chartSha256: source.chartSha256,
  analysisType: source.mode,
  assetClass: source.assetClass,
  promptSha256,
  recommendation: 'WAIT',
  bias: 'neutral',
  confidence: 50,
  analysis,
  error: null,
  durationMs: 100,
  estimatedCostUsd: 0.01,
});

test('shuffles labels while keeping the key out of review cards', () => {
  const baseline = row('baseline-hash', { reasoning: 'base answer' });
  const candidate = row('candidate-hash', { reasoning: 'candidate answer' });
  const { packet, key } = buildBlindPacket({
    baselineRows: [baseline], candidateRows: [candidate], manifestCases: [source],
    randomBytes: () => Buffer.from([1]),
  });
  assert.equal(packet.cases.length, 1);
  assert.equal(packet.cases[0].A.analysis.reasoning, 'candidate answer');
  assert.equal(packet.cases[0].B.analysis.reasoning, 'base answer');
  assert.deepEqual([key.cases[0].A, key.cases[0].B], ['candidate', 'baseline']);
  const reviewText = JSON.stringify(packet);
  for (const hidden of ['baseline-hash', 'candidate-hash', 'durationMs', 'costUsd', 'sourceCaseId']) {
    assert.equal(reviewText.includes(hidden), false);
  }
});

test('rejects missing pairs, duplicate cases, and different chart inputs', () => {
  const baseline = row('baseline-hash', {});
  const candidate = row('candidate-hash', {});
  const args = { baselineRows: [baseline], candidateRows: [candidate], manifestCases: [source] };
  assert.throws(() => buildBlindPacket({ ...args, candidateRows: [] }), /tamanho diferente/);
  assert.throws(() => buildBlindPacket({ ...args, baselineRows: [baseline, baseline] }), /duplicado/);
  assert.throws(() => buildBlindPacket({ ...args, candidateRows: [{ ...candidate, chartSha256: 'wrong' }] }), /divergentes/);
  assert.throws(() => buildBlindPacket({ ...args, candidateRows: [{ ...candidate, promptSha256: 'baseline-hash' }] }), /diferente/);
});
