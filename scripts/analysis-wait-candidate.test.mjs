import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { extractPrompt, buildWaitCandidate } from './analysis-wait-candidate.mjs';

const source = fs.readFileSync(path.resolve('apps/backend/src/common/prompts/trading-system-prompt.ts'), 'utf8');
const baseline = extractPrompt(source, 'trading-system-prompt.ts');

test('gera candidata de WAIT útil sem trocar limiares ou guardas de entrada', () => {
  const candidate = buildWaitCandidate(baseline);
  assert.notEqual(candidate, baseline);
  assert.match(candidate, /every legible HOLD, state the concrete blocker/);
  assert.match(candidate, /6-7 ✅ → BUY\/SELL/);
  assert.match(candidate, /4-5 ✅ → BUY\/SELL/);
  assert.match(candidate, /≤3 ✅ → HOLD/);
  assert.match(candidate, /MANDATORY ITEMS: items 5 .* and 6 .* are eliminatory/);
  assert.match(candidate, /No reliable trigger/iu);
  assert.doesNotMatch(candidate, /An empty HOLD is only acceptable/);
});

test('recusa baseline desconhecido em vez de criar um prompt parcial', () => {
  assert.throws(() => buildWaitCandidate('outro prompt'), /Baseline incompatível/);
  assert.throws(() => extractPrompt('export const X = `foo`;', 'x.ts'), /sem TRADING_SYSTEM_PROMPT/);
});
