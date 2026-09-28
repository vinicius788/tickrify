import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildBlindPacket } from './analysis-blind-packet.mjs';

const source = JSON.parse(fs.readFileSync(new URL('./backtest/pilot-manifest.json', import.meta.url), 'utf8')).cases[0];
const row = (promptSha256, analysis, chart = source) => ({
  id: chart.id,
  chartSha256: chart.chartSha256,
  analysisType: chart.mode,
  assetClass: chart.assetClass,
  promptSha256,
  recommendation: 'WAIT',
  bias: 'neutral',
  confidence: 50,
  analysis,
  error: null,
  durationMs: 100,
  estimatedCostUsd: 0.01,
});

test('accepts distinct quick and deep candidate prompts without mixing either mode', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('./backtest/pilot-manifest.json', import.meta.url), 'utf8')).cases;
  const quick = manifest.find((item) => item.mode === 'quick');
  const deep = manifest.find((item) => item.mode === 'deep');
  const baselineRows = [row('base', {}, quick), row('base', {}, deep)];
  const candidateRows = [row('candidate-quick', {}, quick), row('candidate-deep', {}, deep)];
  const { packet } = buildBlindPacket({ baselineRows, candidateRows, manifestCases: [quick, deep] });
  assert.equal(packet.cases.length, 2);
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
