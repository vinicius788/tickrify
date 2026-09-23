#!/usr/bin/env node
/** Verificações objetivas de respostas do piloto com UMA imagem por caso. Sem notas humanas. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backtest', 'results');
const FILE = /^[A-Za-z0-9._-]{1,80}\.jsonl$/;

export function readPilotRows(name) {
  if (!FILE.test(name)) throw new Error('Nome de arquivo JSONL inválido');
  return fs.readFileSync(path.join(ROOT, name), 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function byId(rows, name) {
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || map.has(row.id)) throw new Error(`${name}: ID ausente ou repetido`);
    map.set(row.id, row);
  }
  return map;
}

const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const namedHtf = /\b(?:H1|H4|D1|1H|4H|1D)\b/i;
const alignmentRatio = /\b[0-3]\/[23]\b/;
const passedMtf = /(?:✅|✔|\[x\])[^|\n]{0,90}\b(?:MTF|multi[- ]?timeframe)\b/i;

export function auditRows(rows) {
  const counts = {
    cases: rows.length, failed: 0, wait: 0, buy: 0, sell: 0,
    mtfFieldFilledWithoutHtf: 0, namedHtfInProseNeedsReview: 0,
    alignmentRatioNeedsReview: 0, checklistAwardsMtfWithoutHtf: 0,
    tradePlanMissingLevels: 0, tradePlanWrongSide: 0, waitHasActiveLevels: 0,
  };
  for (const row of rows) {
    if (row.error) { counts.failed++; continue; }
    const a = row.analysis || {};
    const action = String(row.recommendation || '').toUpperCase();
    if (action === 'WAIT') counts.wait++;
    if (action === 'BUY') counts.buy++;
    if (action === 'SELL') counts.sell++;
    if (String(a.multiTimeframeAlignment || '').trim()) counts.mtfFieldFilledWithoutHtf++;
    const prose = ['technicalAnalysis', 'executiveSummary', 'reasoning', 'marketRegimeNote']
      .map((field) => String(a[field] || '')).join('\n');
    if (namedHtf.test(prose)) counts.namedHtfInProseNeedsReview++;
    if (alignmentRatio.test([prose, a.structureValidation, a.multiTimeframeAlignment].join('\n'))) {
      counts.alignmentRatioNeedsReview++;
    }
    if (passedMtf.test(String(a.structureValidation || ''))) counts.checklistAwardsMtfWithoutHtf++;
    const levels = [a.entry, a.stopLoss, a.takeProfit1];
    if (action === 'WAIT' && levels.some(positive)) counts.waitHasActiveLevels++;
    if (action === 'BUY' || action === 'SELL') {
      if (!levels.every(positive)) counts.tradePlanMissingLevels++;
      else if (action === 'BUY' ? !(a.stopLoss < a.entry && a.entry < a.takeProfit1)
        : !(a.takeProfit1 < a.entry && a.entry < a.stopLoss)) counts.tradePlanWrongSide++;
    }
  }
  return counts;
}

export function auditPair(baseline, candidate) {
  const base = byId(baseline, 'baseline');
  const other = byId(candidate, 'candidato');
  if (!base.size || base.size !== other.size) throw new Error('Pares ausentes ou tamanhos diferentes');
  for (const [id, row] of base) {
    const pair = other.get(id);
    if (!pair || row.chartSha256 !== pair.chartSha256 || row.analysisType !== pair.analysisType ||
        row.assetClass !== pair.assetClass) throw new Error('Entradas divergentes no par');
  }
  return {
    scope: 'Piloto de uma imagem; contagens não são notas humanas nem prova de acerto financeiro.',
    baseline: auditRows(baseline),
    candidate: auditRows(candidate),
  };
}

function cli(args) {
  const baseline = [];
  let candidate;
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value) throw new Error('Argumento sem valor');
    if (args[i] === '--baseline') baseline.push(value);
    else if (args[i] === '--candidate' && !candidate) candidate = value;
    else throw new Error('Argumento inválido');
  }
  if (!baseline.length || !candidate) throw new Error('Uso: --baseline arquivo.jsonl [--baseline outro.jsonl] --candidate arquivo.jsonl');
  const result = auditPair(baseline.flatMap(readPilotRows), readPilotRows(candidate));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
