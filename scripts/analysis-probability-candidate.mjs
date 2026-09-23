#!/usr/bin/env node
/** Corrige apenas a semântica das probabilidades em um prompt congelado. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractPrompt } from './analysis-wait-candidate.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = path.resolve(ROOT, '../apps/backend/src/common/prompts/trading-system-prompt.ts');
const DEFAULT_OUTPUT = path.join(ROOT, 'backtest/results/candidate-probability-semantics-v1.txt');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const edits = [
  [
    `E) OUTCOME PROBABILITIES: Estimate the realistic probability distribution for this setup.
- probabilityTp1: integer 0-100 — chance price reaches TP1 before the stop
- probabilityTp2: integer 0-100 — chance price reaches TP2 before the stop (must be ≤ probabilityTp1)
- probabilityStop: integer 0-100 — chance price hits the stop before TP1
- The three should sum to ~100. Base them on confluence, trend strength, and regime — be honest, not optimistic.
- For HOLD: set all three to null.`,
    `E) OUTCOME PROBABILITIES: Estimate outcomes over the next 96 candles of the execution timeframe, measured from the proposed entry after its conditions are met. These are estimates, not measured historical rates.
- probabilityTp1: integer 0-100 — chance TP1 is reached before stop within that horizon.
- probabilityTp2: integer 0-100 — chance TP2 is reached before stop within that horizon; this event is INCLUDED in TP1, so it must be ≤ probabilityTp1.
- probabilityStop: integer 0-100 — chance stop is reached before TP1 within that horizon.
- TP1 and Stop are mutually exclusive; their estimates must sum to no more than 100. Any remainder is neither level reached within the horizon. Do NOT add TP2 to this sum.
- If the plan has no valid entry, stop, TP1 and entry condition, set all three to null. For HOLD, set all three to null. Do not derive missing values from confidence.`,
  ],
  [
    `"confidence" for BUY/SELL is a PROBABILITY ESTIMATE: out of 100 charts that look like this one, in how many does price reach takeProfit1 BEFORE hitting stopLoss? It is NOT a measure of how sure you are about the narrative.`,
    `"confidence" for BUY/SELL is a PROBABILITY ESTIMATE: out of 100 comparable charts, in how many does price reach takeProfit1 BEFORE stopLoss within the next 96 execution-timeframe candles after a valid entry? It is NOT a measure of how sure you are about the narrative.`,
  ],
];

export function buildProbabilityCandidate(baseline) {
  let candidate = baseline;
  for (const [before, after] of edits) {
    if (candidate.split(before).length !== 2) {
      throw new Error(`Baseline incompatível com a variante de probabilidades: ${before.slice(0, 55)}...`);
    }
    candidate = candidate.replace(before, after);
  }
  return candidate;
}

function cli(args) {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--baseline-file', '--out'].includes(args[i]) || !args[i + 1]) {
      throw new Error('Uso: node scripts/analysis-probability-candidate.mjs [--baseline-file prompt.ts|prompt.txt] [--out candidato.txt]');
    }
    opts[args[i]] = args[i + 1];
  }
  const sourceFile = path.resolve(opts['--baseline-file'] || DEFAULT_BASELINE);
  const outputFile = path.resolve(opts['--out'] || DEFAULT_OUTPUT);
  if (sourceFile === outputFile || fs.existsSync(outputFile)) throw new Error('Saída inválida ou existente');
  const baseline = extractPrompt(fs.readFileSync(sourceFile, 'utf8'), sourceFile);
  const candidate = buildProbabilityCandidate(baseline);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, candidate + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ baselineSha256: sha256(baseline), candidateSha256: sha256(candidate),
    edits: edits.length, output: outputFile, apiCalls: 0 }, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
