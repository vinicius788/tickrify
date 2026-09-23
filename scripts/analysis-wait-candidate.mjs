#!/usr/bin/env node
/** Gera uma variante de prompt apenas para avaliação offline; não altera o motor. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = path.resolve(ROOT, '../apps/backend/src/common/prompts/trading-system-prompt.ts');
const DEFAULT_OUTPUT = path.join(ROOT, 'backtest/results/candidate-wait-actionable-v1.txt');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const edits = [
  [
    '  - Only return a bare HOLD (alternativeScenario null) when the chart is genuinely directionless chop with no forming setup on either side.',
    '  - For any legible HOLD, alternativeScenario MUST name the decisive missing evidence and ONE observable condition for re-evaluation. In directionless chop, use a visible range boundary and require a close beyond it. If no trustworthy level is readable, say that no numeric trigger can be specified from this image and request a clearer/new chart. Do NOT invent a trade, level, other timeframe, or future outcome.',
  ],
  [
    '□ HOLD → entry, stopLoss, takeProfit1, takeProfit2, invalidationLevel all null (but alternativeScenario SHOULD carry the trigger plan if a setup is forming — HOLD-WATCH rule)',
    '□ HOLD → entry, stopLoss, takeProfit1, takeProfit2, invalidationLevel all null; for a legible chart, alternativeScenario explains the blocker and observable re-evaluation condition without presenting it as an active trade',
  ],
  [
    '"alternativeScenario": "Plan B in the OUTPUT LANGUAGE: if price does X, the setup flips to Y. MAX 200 characters" or null,',
    '"alternativeScenario": "In the OUTPUT LANGUAGE: for BUY/SELL, Plan B; for HOLD, missing evidence + one observable condition to re-evaluate, or state that no reliable trigger can be read. Never imply an active trade on HOLD. MAX 200 characters" or null,',
  ],
  [
    '11. invalidationLevel, entryType, partialExitStrategy: always fill for BUY/SELL, null for HOLD. alternativeScenario: always fill for BUY/SELL; for HOLD, fill it with the trigger plan whenever a setup is FORMING (HOLD-WATCH rule) — null only when there is genuinely no scenario worth watching.',
    '11. invalidationLevel, entryType, partialExitStrategy: always fill for BUY/SELL, null for HOLD. alternativeScenario: always fill for BUY/SELL; for every legible HOLD, state the concrete blocker and one observable condition to re-evaluate, or explain that the image does not support a reliable trigger. Keep numeric trade levels null for HOLD.',
  ],
  [
    '19. HOLD-WATCH mandatory — when a setup is forming but unconfirmed, the HOLD must carry the trigger plan in alternativeScenario and the watch level in the executiveSummary. An empty HOLD is only acceptable in genuine directionless chop.',
    '19. HOLD EXPLANATION mandatory — for a legible chart, WAIT/HOLD must explain what is missing and what observable evidence would change the assessment; a forming setup may name a watch level, while directionless chop must not fabricate one. The executiveSummary must reflect the same condition. Do not force BUY/SELL to avoid an empty HOLD.',
  ],
];

export function extractPrompt(source, filename = '') {
  if (!filename.endsWith('.ts')) return source.trim();
  const match = source.match(/export const TRADING_SYSTEM_PROMPT = `([\s\S]*?)`;/);
  if (!match) throw new Error('Arquivo TS sem TRADING_SYSTEM_PROMPT literal');
  return match[1].trim();
}

export function buildWaitCandidate(baseline) {
  let candidate = baseline;
  for (const [before, after] of edits) {
    if (candidate.split(before).length !== 2) {
      throw new Error(`Baseline incompatível com a variante WAIT: ${before.slice(0, 55)}...`);
    }
    candidate = candidate.replace(before, after);
  }
  return candidate;
}

function cli(args) {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--baseline-file', '--out'].includes(args[i]) || !args[i + 1]) {
      throw new Error('Uso: node scripts/analysis-wait-candidate.mjs [--baseline-file prompt.ts|prompt.txt] [--out candidato.txt]');
    }
    opts[args[i]] = args[i + 1];
  }
  const sourceFile = path.resolve(opts['--baseline-file'] || DEFAULT_BASELINE);
  const outputFile = path.resolve(opts['--out'] || DEFAULT_OUTPUT);
  if (sourceFile === outputFile) throw new Error('Saída não pode sobrescrever o baseline');
  if (fs.existsSync(outputFile)) throw new Error('Candidato já existe; não sobrescrever uma variante congelada');
  const baseline = extractPrompt(fs.readFileSync(sourceFile, 'utf8'), sourceFile);
  const candidate = buildWaitCandidate(baseline);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, candidate + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({
    sourceKind: sourceFile === DEFAULT_BASELINE ? 'versioned_reference_not_verified_active' : 'provided_local_snapshot',
    baselineSha256: sha256(baseline),
    candidateSha256: sha256(candidate),
    edits: edits.length,
    output: outputFile,
    apiCalls: 0,
  }, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
