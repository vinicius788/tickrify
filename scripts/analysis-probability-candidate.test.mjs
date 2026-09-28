import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildProbabilityCandidate } from './analysis-probability-candidate.mjs';
import { extractPrompt } from './analysis-wait-candidate.mjs';

const source = new URL('../apps/backend/src/common/prompts/trading-system-prompt.ts', import.meta.url);

test('probability candidate defines a horizon and keeps TP2 nested inside TP1', () => {
  const baseline = extractPrompt(readFileSync(source, 'utf8'), source.pathname);
  const candidate = buildProbabilityCandidate(baseline);
  assert.match(candidate, /next 96 candles of the execution timeframe/);
  assert.match(candidate, /Do NOT add TP2 to this sum/);
  assert.match(candidate, /Do not derive missing values from confidence/);
  assert.doesNotMatch(candidate, /The three should sum to ~100/);
  assert.match(candidate, /6-7 ✅ → BUY\/SELL/);
});

test('rejects changed baseline rather than silently using a partial candidate', () => {
  assert.throws(() => buildProbabilityCandidate('different prompt'), /Baseline incompatível/);
});
