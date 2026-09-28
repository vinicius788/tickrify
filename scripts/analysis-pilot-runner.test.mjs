import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildMtfCandidate, buildMtfDeepInstructionCandidate, extractDeepInstruction } from './analysis-mtf-candidate.mjs';
import { extractPrompt } from './analysis-wait-candidate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'apps/backend');
const results = path.join(root, 'scripts/backtest/results');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('dry-run pins different quick/deep prompts without creating results or using an API key', () => {
  const out = 'pilot-runner-split-prompts-dry-test.jsonl';
  const temp = mkdtempSync(path.join(tmpdir(), 'tickrify-pilot-'));
  const quickFile = path.join(temp, 'quick.txt');
  const deepFile = path.join(temp, 'deep.txt');
  const promptSource = path.join(root, 'apps/backend/src/common/prompts/trading-system-prompt.ts');
  const deepSource = path.join(root, 'apps/backend/src/modules/prompt/prompt-builder.service.ts');
  const base = extractPrompt(readFileSync(promptSource, 'utf8'), promptSource);
  const quick = buildMtfCandidate(base);
  const deep = `${quick}\n\n${buildMtfDeepInstructionCandidate(extractDeepInstruction(readFileSync(deepSource, 'utf8')))}`;
  writeFileSync(quickFile, quick);
  writeFileSync(deepFile, deep);
  const args = [
    'exec', 'ts-node', 'scripts/analysis-pilot-runner.ts',
    '--prompt-file', quickFile,
    '--prompt-file-deep', deepFile,
    '--prompt-origin', 'versioned-reference',
    '--model-quick', 'gpt-5.6-luna', '--model-deep', 'gpt-5.6-luna',
    '--effort-quick', 'low', '--effort-deep', 'default',
    '--out', out, '--case-offset', '8', '--max-calls', '40',
    '--max-estimated-usd', '1', '--reserve-per-call-usd', '0.02',
  ];
  try {
    const stdout = execFileSync('pnpm', args, {
      cwd: backend, encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '' },
    });
    const plan = JSON.parse(stdout);
    assert.equal(plan.mode, 'dry-run');
    assert.deepEqual(plan.selectedByMode, { quick: 20, deep: 20 });
    assert.equal(plan.promptSha256, null);
    assert.equal(plan.promptSha256Quick, sha256(quick));
    assert.equal(plan.promptSha256Deep, sha256(deep));
    assert.notEqual(plan.effectivePromptSha256Quick, plan.effectivePromptSha256Deep);
    assert.equal(plan.deepEnrichmentInstructionCount, 1);
    assert.equal(existsSync(path.join(results, out)), false);
    assert.equal(existsSync(path.join(results, `${out}.meta.json`)), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
