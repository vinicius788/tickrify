#!/usr/bin/env node
/** Monta cartões de revisão offline; rótulos e chave ficam em arquivos separados. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backtest');
const RESULTS = path.join(ROOT, 'results');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`JSON inválido na linha ${index + 1} de ${path.basename(file)}`); }
  });
}

function uniqueById(rows, label) {
  const map = new Map();
  for (const row of rows) {
    assert(row && typeof row.id === 'string' && !map.has(row.id), `${label}: ID ausente ou duplicado`);
    map.set(row.id, row);
  }
  return map;
}

function reviewResponse(row) {
  return {
    status: row.error ? 'failed' : 'completed',
    recommendation: row.recommendation ?? null,
    bias: row.bias ?? null,
    confidence: row.confidence ?? null,
    entry: row.entry ?? null,
    stopLoss: row.stopLoss ?? null,
    takeProfit1: row.takeProfit1 ?? null,
    takeProfit2: row.takeProfit2 ?? null,
    analysis: row.analysis ?? null,
  };
}

export function buildBlindPacket({ baselineRows, candidateRows, manifestCases, randomBytes = crypto.randomBytes }) {
  const baseline = uniqueById(baselineRows, 'baseline');
  const candidate = uniqueById(candidateRows, 'candidate');
  const manifest = uniqueById(manifestCases, 'manifesto');
  assert(baseline.size > 0 && baseline.size === candidate.size, 'Variantes com tamanho diferente ou vazias');
  for (const mode of new Set(baselineRows.map((row) => row.analysisType))) {
    const basePrompts = new Set(baselineRows.filter((row) => row.analysisType === mode).map((row) => row.promptSha256));
    const candidatePrompts = new Set(candidateRows.filter((row) => row.analysisType === mode).map((row) => row.promptSha256));
    assert(basePrompts.size === 1 && candidatePrompts.size === 1 &&
      !basePrompts.has([...candidatePrompts][0]),
    `Cada variante precisa ter um hash de prompt único e diferente no modo ${mode}`);
  }

  const cards = [];
  const key = [];
  for (const [id, first] of baseline) {
    const second = candidate.get(id);
    const source = manifest.get(id);
    assert(second && source, `Par ou gráfico ausente: ${id}`);
    assert(first.chartSha256 === second.chartSha256 && first.chartSha256 === source.chartSha256 &&
      first.analysisType === second.analysisType && first.analysisType === source.mode &&
      first.assetClass === second.assetClass && first.assetClass === source.assetClass,
    `Entradas divergentes: ${id}`);
    const chart = path.resolve(ROOT, source.chartFile);
    assert(chart.startsWith(path.join(ROOT, 'charts') + path.sep), `Gráfico fora da pasta permitida: ${id}`);
    assert(fs.existsSync(chart) && crypto.createHash('sha256').update(fs.readFileSync(chart)).digest('hex') === source.chartSha256,
      `Gráfico ausente ou hash divergente: ${id}`);

    const flip = (randomBytes(1)[0] & 1) === 1;
    const caseId = `case-${String(cards.length + 1).padStart(2, '0')}`;
    cards.push({
      caseId,
      assetClass: source.assetClass,
      analysisType: source.mode,
      chartFile: chart,
      chartSha256: source.chartSha256,
      A: reviewResponse(flip ? second : first),
      B: reviewResponse(flip ? first : second),
    });
    key.push({
      caseId,
      sourceCaseId: id,
      A: flip ? 'candidate' : 'baseline',
      B: flip ? 'baseline' : 'candidate',
      baseline: { durationMs: first.durationMs, costUsd: first.estimatedCostUsd },
      candidate: { durationMs: second.durationMs, costUsd: second.estimatedCostUsd },
    });
  }
  return {
    packet: { schemaVersion: 1, rubricVersion: '2026-09-23-v1', cases: cards },
    key: { schemaVersion: 1, cases: key },
  };
}

function cli(args) {
  const baselineFiles = [];
  let candidateFile;
  let outName;
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    assert(value, `Valor ausente para ${flag}`);
    if (flag === '--baseline') baselineFiles.push(value);
    else if (flag === '--candidate' && !candidateFile) candidateFile = value;
    else if (flag === '--out' && !outName) outName = value;
    else throw new Error(`Argumento inválido ou repetido: ${flag}`);
  }
  assert(baselineFiles.length > 0 && candidateFile &&
    [...baselineFiles, candidateFile].every((name) => /^[A-Za-z0-9._-]{1,80}\.jsonl$/.test(name)) &&
    /^[A-Za-z0-9._-]{1,70}$/.test(outName || ''),
    'Uso: --baseline arquivo.jsonl [--baseline outro.jsonl] --candidate arquivo.jsonl --out nome');
  const packetFile = path.join(RESULTS, `${outName}.review.json`);
  const keyFile = path.join(RESULTS, `${outName}.key.json`);
  assert(!fs.existsSync(packetFile) && !fs.existsSync(keyFile), 'Arquivo de saída já existe');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'pilot-manifest.json'), 'utf8'));
  const inputs = baselineFiles.map((name) => readJsonl(path.join(RESULTS, name)));
  const baselineRows = inputs.flat();
  const candidateRows = readJsonl(path.join(RESULTS, candidateFile));
  const { packet, key } = buildBlindPacket({ baselineRows, candidateRows, manifestCases: manifest.cases });
  fs.writeFileSync(packetFile, JSON.stringify(packet, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(keyFile, JSON.stringify(key, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(`Preparados ${packet.cases.length} cartões para revisão local.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
