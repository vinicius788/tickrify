import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEvaluation, RUBRIC_VERSION, validateDataset } from './analysis-eval.mjs';

const assessable = [true, true, true, true, true, true, true];
const completed = (scores, critical = false, costUsd = 0.01) => ({ status: 'completed', scores, critical, latencyMs: 100, costUsd });
const failed = (status) => ({ status, critical: false });
const sample = {
  rubricVersion: RUBRIC_VERSION,
  cases: [
    { caseId: 'PRIVATE_CASE_1', assetClass: 'cripto', analysisType: 'quick', assessable, baseline: completed([1, 1, 1, 1, 1, 1, 1]), candidate: completed([2, 2, 2, 2, 2, 2, 2]) },
    { caseId: 'PRIVATE_CASE_2', assetClass: 'forex', analysisType: 'deep', assessable, baseline: completed([2, 2, 2, 2, 2, 2, 2], true), candidate: failed('timeout') },
    { caseId: 'PRIVATE_CASE_3', assetClass: 'indices', analysisType: 'quick', assessable, baseline: failed('invalid'), candidate: completed([1, 1, 1, 1, 1, 1, 1]) },
  ],
};

test('conta falhas como zero e compara todos os casos de forma pareada', () => {
  const report = renderEvaluation(sample);
  assert.match(report, /Todos \| 3 \| 2\/2 \| 1\/0 \| 50\.0%\/50\.0% \| \+0\.0 pp \| 2\/1\/0/);
  assert.match(report, /candidata \| 0 \| 0 \| 1/);
  assert.doesNotMatch(report, /PRIVATE_CASE|scores|caseId/);
});

test('N/A tem mesmo denominador nas duas variantes', () => {
  const data = structuredClone(sample);
  data.cases = [{ ...data.cases[0], assessable: [true, false, true, false, true, false, true], baseline: completed([1, null, 1, null, 1, null, 1]), candidate: completed([2, null, 2, null, 2, null, 2]) }];
  assert.match(renderEvaluation(data), /50\.0%\/100\.0%/);
});

test('rejeita casos repetidos, notas fora da rubrica e campos com dados brutos', () => {
  const duplicate = structuredClone(sample);
  duplicate.cases[1].caseId = duplicate.cases[0].caseId;
  assert.throws(() => validateDataset(duplicate), /caseId/);
  const invalidScore = structuredClone(sample);
  invalidScore.cases[0].candidate.scores[0] = 3;
  assert.throws(() => validateDataset(invalidScore), /nota inválida/);
  const rawImage = structuredClone(sample);
  rawImage.cases[0].imageUrl = 'private';
  assert.throws(() => validateDataset(rawImage), /campo não permitido: imageUrl/);
});
