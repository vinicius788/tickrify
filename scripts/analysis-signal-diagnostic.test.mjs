import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseVariant, renderDiagnostic } from './analysis-signal-diagnostic.mjs';

const hash = 'a'.repeat(64);
const manifest = { cases: [
  { id: 'case-a', symbol: 'BTCUSDT', interval: '30m', mode: 'quick', chartSha256: hash },
  { id: 'case-b', symbol: 'ETHUSDT', interval: '4h', mode: 'deep', chartSha256: hash },
  { id: 'case-c', symbol: 'ETHUSDT', interval: '30m', mode: 'quick', chartSha256: hash },
] };
const lines = (...rows) => rows.map((row) => JSON.stringify(row)).join('\n');

test('separa WAIT do modelo e rebaixamento posterior, com denominadores explícitos', () => {
  const base = lines(
    { id: 'case-a', symbol: 'BTCUSDT', interval: '30m', analysisType: 'quick', chartSha256: hash, rawRecommendation: 'BUY', recommendation: 'WAIT' },
    { id: 'case-b', symbol: 'ETHUSDT', interval: '4h', analysisType: 'deep', chartSha256: hash, rawRecommendation: 'HOLD', recommendation: 'WAIT' },
    { id: 'case-c', symbol: 'ETHUSDT', interval: '30m', error: 'prompt privado falhou' },
  );
  const candidate = lines(
    { id: 'case-a', symbol: 'BTCUSDT', interval: '30m', analysisType: 'quick', chartSha256: hash, rawRecommendation: 'BUY', recommendation: 'BUY' },
    { id: 'case-b', symbol: 'ETHUSDT', interval: '4h', analysisType: 'deep', chartSha256: hash, rawRecommendation: 'HOLD', recommendation: 'WAIT' },
  );
  const stats = diagnoseVariant(manifest, base);
  assert.equal(stats.counts.rawWait, 1);
  assert.equal(stats.counts.finalWait, 2);
  assert.equal(stats.counts.signalDowngraded, 1);
  assert.equal(stats.counts.failed, 1);
  const report = renderDiagnostic(manifest, base, candidate);
  assert.match(report, /WAIT na resposta crua conhecida \| 50\.0% \(1\/2\)/);
  assert.match(report, /WAIT→sinal 1; sinal→WAIT 0/);
  assert.doesNotMatch(report, /prompt privado|case-a|case-b|case-c/);
});

test('marca entradas não verificáveis e rejeita arquivo malformado', () => {
  const content = lines(
    { id: 'case-a', symbol: 'BTCUSDT', interval: '30m', rawRecommendation: 'SELL', recommendation: 'VENDA' },
    { id: 'case-a', symbol: 'BTCUSDT', interval: '30m', rawRecommendation: 'SELL', recommendation: 'AGUARDAR' },
    { id: 'fora', symbol: 'X', interval: '1h', recommendation: 'BUY' },
  );
  const stats = diagnoseVariant(manifest, content);
  assert.equal(stats.duplicates, 1);
  assert.equal(stats.outsideManifest, 1);
  assert.equal(stats.counts.modeUnknown, 1);
  assert.equal(stats.counts.chartHashUnknown, 1);
  assert.equal(stats.completed.size, 0);
  assert.throws(() => diagnoseVariant(manifest, '{broken'), /Linha JSONL 1 inválida/);
  assert.throws(() => diagnoseVariant({ cases: [{ ...manifest.cases[0], id: '../privado' }] }, ''), /identificação de caso inválida/);
});
