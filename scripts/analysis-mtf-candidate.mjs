#!/usr/bin/env node
/** Variante offline: não apresenta HTF não fornecido como leitura verificada. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractPrompt } from './analysis-wait-candidate.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = path.resolve(ROOT, '../apps/backend/src/common/prompts/trading-system-prompt.ts');
const DEFAULT_OUTPUT = path.join(ROOT, 'backtest/results/candidate-mtf-evidence-v1.txt');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const edits = [
  [
    `**STEP 0 — HTF BIAS + MULTI-TIMEFRAME ALIGNMENT**
MULTI-CHART: If more than one chart image is provided, the FIRST is the execution timeframe and the OTHERS are higher timeframes. In that case, read the HTF bias and MTF alignment DIRECTLY from those higher-timeframe charts (REAL top-down), do NOT infer. Only infer (below) when a single chart is provided.

A) Higher Timeframe Bias:
- If 5m chart → infer 1H/4H structure from visible swings
- If 15m chart → infer 1H/4H bias
- If 1H chart → infer 4H/D1 bias
- State: "HTF bias is BULLISH/BEARISH/NEUTRAL because [HH+HL / LH+LL / etc.]"

B) Multi-Timeframe Alignment (infer from the single chart visible):
- Current TF: what does the structure on screen show? BULLISH / BEARISH / NEUTRAL
- One TF higher: infer from larger swing structure visible on chart. BULLISH / BEARISH / NEUTRAL
- Two TFs higher: infer from macro trend visible. BULLISH / BEARISH / NEUTRAL
- Count aligned TFs: 3/3 = strong, 2/3 = moderate, 1/3 or 0/3 = weak/counter-trend
- Write result as: "M15 BEARISH | H1 BEARISH | H4 NEUTRAL → 2/3 aligned — moderate setup"
- → populate multiTimeframeAlignment field`,
    `**STEP 0 — VISIBLE STRUCTURE + VERIFIED MULTI-TIMEFRAME CONTEXT**
MULTI-CHART: The FIRST image is the execution timeframe. Only the additional images are higher timeframes. Read their structure directly; label each timeframe only if it is visible. Never invent a missing chart.
SINGLE-CHART: Describe larger and smaller swings as structure within the SAME visible timeframe. Do NOT label them H1/H4/D1 or claim 2/3 or 3/3 alignment. Real higher-timeframe bias is unavailable. Set multiTimeframeAlignment to null and say higher-timeframe charts were not supplied when relevant.

A) Directional Bias:
- With one chart: marketStructure.bias is the bias of the visible chart. Use its actual HH+HL, LH+LL, or range as evidence; call larger swings "visible larger swings", never a different timeframe.
- With additional charts: distinguish the execution timeframe from every verified higher timeframe; explain agreement or conflict using the supplied images only.

B) Multi-Timeframe Alignment:
- With one chart: unknown; multiTimeframeAlignment = null. Do not award checklist item 7.
- With additional charts: count only timeframes actually supplied and legible. State the bias of each before claiming alignment. An unreadable chart cannot count as agreement.
- Never turn an inference from a single image into a measured HTF fact.`,
  ],
  ['1. HTF bias aligns with trade direction', '1. Visible larger-swing bias aligns with trade direction; if HTF images exist, note their verified bias separately'],
  ['7. Multi-timeframe alignment ≥ 2/3 TFs agree', '7. Verified alignment between execution chart and at least one supplied, legible HTF chart; if no HTF image is supplied, mark N/A and count zero passes'],
  ['□ marketStructure.bias reflects HTF bias from Step 0', '□ marketStructure.bias reflects the visible chart; any HTF claim requires a supplied HTF image'],
  ['"multiTimeframeAlignment": "Ex: M15 BEARISH | H1 BEARISH | H4 NEUTRAL → 2/3 aligned" or null,', '"multiTimeframeAlignment": "Only verified supplied charts: M15 BEARISH | H1 BEARISH → 2/2 aligned" or null when one chart or HTF unreadable,'],
  ['"technicalAnalysis": "Narrative ICT/SMC in the OUTPUT LANGUAGE with HTF bias, setup, session. Be specific about price levels. MAX 350 characters, no repetition of what other fields already say."', '"technicalAnalysis": "Narrative ICT/SMC in the OUTPUT LANGUAGE with visible-chart bias, verified HTF context only if supplied, setup and session. Be specific about price levels. MAX 350 characters, no repetition."'],
  ['"structureValidation": "7-item checklist on a SINGLE line, each item is a mark plus its price evidence in at most 6 words: ✅/❌ HTF | Zone | ICT setup | Anti-retail | Structure | R:R | MTF → X/7 → signal. MAX 300 characters."', '"structureValidation": "7-item checklist on a SINGLE line: ✅/❌ Visible bias | Zone | ICT setup | Anti-retail | Structure | R:R | ✅/❌/N/A verified MTF → X/7 passes → signal. With one chart, MTF is N/A and counts zero. MAX 300 characters."'],
  ['"executiveSummary": "3 short blocks in the OUTPUT LANGUAGE, one or two sentences each: (1) HTF + ICT context, (2) checklist + conviction, (3) entry + invalidation + plan B. End with a clear action sentence. MAX 450 characters total."', '"executiveSummary": "3 short blocks in the OUTPUT LANGUAGE: (1) visible structure + ICT context, noting when HTF images were not supplied, (2) checklist + conviction, (3) entry + invalidation + plan B. End with a clear action sentence. MAX 450 characters total."'],
  ['1. HTF bias + MTF alignment mandatory — never skip Step 0.', '1. Visible-chart structure mandatory. Claim HTF bias or MTF alignment only from additional supplied, legible charts; otherwise state that HTF is unavailable.'],
];

export function buildMtfCandidate(baseline) {
  let candidate = baseline;
  for (const [before, after] of edits) {
    if (candidate.split(before).length !== 2) {
      throw new Error(`Baseline incompatível com a variante MTF: ${before.slice(0, 55)}...`);
    }
    candidate = candidate.replace(before, after);
  }
  return candidate;
}

function cli(args) {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--baseline-file', '--out'].includes(args[i]) || !args[i + 1]) {
      throw new Error('Uso: node scripts/analysis-mtf-candidate.mjs [--baseline-file prompt.ts|prompt.txt] [--out candidato.txt]');
    }
    opts[args[i]] = args[i + 1];
  }
  const sourceFile = path.resolve(opts['--baseline-file'] || DEFAULT_BASELINE);
  const outputFile = path.resolve(opts['--out'] || DEFAULT_OUTPUT);
  if (sourceFile === outputFile || fs.existsSync(outputFile)) throw new Error('Saída inválida ou existente');
  const baseline = extractPrompt(fs.readFileSync(sourceFile, 'utf8'), sourceFile);
  const candidate = buildMtfCandidate(baseline);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, candidate + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ baselineSha256: sha256(baseline), candidateSha256: sha256(candidate), edits: edits.length, output: outputFile, apiCalls: 0 }, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
