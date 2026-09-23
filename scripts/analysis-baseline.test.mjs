import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCost, parseMetric, percentile, renderReport, summarizeLogs } from './analysis-baseline.mjs';

const metric = (status, id, attempt, latency, type = 'quick') =>
  `[Metrics] analysis ${status} | analysisId=${id} userId=private-user analysisType=${type} attempt=${attempt} queueWaitMs=-1 promptMs=10 aiMs=40 parseMs=3 annotateMs=2 persistMs=1 latencyMs=${latency} errorCode=PRIVATE_ERROR`;

test('lê os formatos reais e trata -1 como indisponível', () => {
  assert.deepEqual(parseMetric(metric('completed', 'a', 2, 100)).queueWaitMs, null);
  assert.equal(parseMetric(metric('failed', 'a', 2, 100)).errorCode, 'unclassified');
  assert.equal(parseMetric(metric('failed', 'a', 2, 100).replace('PRIVATE_ERROR', 'openai_rate_limit')).errorCode, 'openai_rate_limit');
  assert.equal(parseCost('[Cost] quick model=gpt-5.6-luna prompt=100 completion=40 reasoning=20 cost=$0.0003 revenue=$0.1450 margin=99.8%').costUsd, 0.0003);
  assert.equal(parseCost('[Cost] deep model=new-model prompt=100 completion=40 reasoning=20 cost=unknown revenue=$0.4350 margin=n/a').costUsd, null);
  assert.equal(parseMetric('[Metrics] analysis completed | sem campos'), null);
  assert.equal(percentile([10, 20, 30, null], 95), 30);
});

test('deduplica a mesma tentativa e preserva retry e estado final', () => {
  const content = [
    metric('retry', 'a', 1, 70),
    metric('completed', 'a', 2, 100),
    metric('failed', 'b', 1, 80, 'deep'),
    metric('retry', 'c', 1, 90),
    '[Cost] quick model=gpt-5.6-luna prompt=100 completion=40 reasoning=20 cost=$0.0003 revenue=$0.1450 margin=99.8%',
    '[Cost] deep model=future-model prompt=100 completion=40 reasoning=20 cost=unknown revenue=$0.4350 margin=n/a',
  ].join('\n');
  const logs = summarizeLogs([content, metric('completed', 'a', 2, 100)]);
  assert.equal(logs.analyses.length, 3);
  assert.equal(logs.attempts.length, 4);
  assert.equal(logs.analyses.find((a) => a.id === 'a').retried, true);
  assert.equal(logs.analyses.find((a) => a.id === 'c').outcome, 'retry');
  const report = renderReport({ logs });
  assert.match(report, /quick \| 2 \| 1 \| 0 \| 0 \| 1 \| 2/);
  assert.match(report, /future-model \| 1 \| 0 \| n\/d\/n\/d/);
  assert.match(report, /unclassified \| 1/);
  assert.doesNotMatch(report, /private-user|PRIVATE_ERROR|analysisId=|\ba\b.*\bb\b.*\bc\b/);
});

test('não transforma amostras sem preço ou sem resultado em acurácia', () => {
  const report = renderReport({ accuracy: {
    updatedAt: '2026-09-23T03:20:07.952Z',
    overall: { n: 3, wins: 1, rate: 33.3, low: 6.1, high: 79.2 },
    abstention: { wait: 4, total: 10 },
    breakdown: { WIN: 1, LOSS: 2, UNTRACKABLE: 5 },
    byConfidence: [], byModel: [], byGrounding: {},
  } });
  assert.match(report, /1\/3 \(33\.3%; IC 95%/);
  assert.match(report, /UNTRACKABLE \| 5/);
  assert.match(report, /WAIT: 40\.0% \(4\/10\)/);
  assert.match(report, /exclui NO_FILL, ABSTAIN, UNTRACKABLE/);
});
