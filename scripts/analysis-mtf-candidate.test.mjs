import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildMtfCandidate, buildMtfDeepInstructionCandidate, extractDeepInstruction } from './analysis-mtf-candidate.mjs';
import { extractPrompt } from './analysis-wait-candidate.mjs';

const sourceFile = new URL('../apps/backend/src/common/prompts/trading-system-prompt.ts', import.meta.url);
const deepSourceFile = new URL('../apps/backend/src/modules/prompt/prompt-builder.service.ts', import.meta.url);

test('single-chart candidate removes invented HTF scoring while preserving decision bands', () => {
  const baseline = extractPrompt(readFileSync(sourceFile, 'utf8'), sourceFile.pathname);
  const candidate = buildMtfCandidate(baseline);
  assert.notEqual(candidate, baseline);
  assert.match(candidate, /With one chart: unknown; multiTimeframeAlignment = null/);
  assert.match(candidate, /no HTF image is supplied, mark N\/A and count zero passes/);
  assert.match(candidate, /6-7 ✅ → BUY\/SELL/);
  assert.match(candidate, /4-5 ✅ → BUY\/SELL/);
  assert.doesNotMatch(candidate, /Only infer \(below\) when a single chart is provided/);
});

test('rejects a changed baseline instead of silently applying partial edits', () => {
  assert.throws(() => buildMtfCandidate('other prompt'), /Baseline incompatível/);
});

test('deep suffix does not contradict the single-chart MTF candidate', () => {
  const source = readFileSync(deepSourceFile, 'utf8');
  const deepInstruction = extractDeepInstruction(source);
  const candidate = buildMtfDeepInstructionCandidate(deepInstruction);
  assert.match(candidate, /alinhamento entre períodos não é verificável/);
  assert.match(candidate, /Com imagens adicionais, cite somente os períodos legíveis/);
  assert.doesNotMatch(candidate, /infira o contexto maior com cautela/);
  assert.equal(candidate.match(/MULTI-TIMEFRAME:/g)?.length, 1);
  assert.throws(() => buildMtfDeepInstructionCandidate('other instruction'), /DEEP incompatível/);
});
