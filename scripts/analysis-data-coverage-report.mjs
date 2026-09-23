#!/usr/bin/env node
/** Resume logs categóricos de cobertura. Nunca imprime linhas brutas. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIX = '[AnalysisDataCoverage] ';
const MODES = new Set(['quick', 'deep']);
const CLASSES = new Set(['crypto', 'forex', 'metal', 'index', 'other', 'unknown']);
const CANDLES = new Set([
  'disabled', 'not_attempted', 'symbol_unreadable', 'timeframe_unreadable',
  'unsupported_asset', 'provider_unconfigured', 'source_unavailable',
  'stale_withheld', 'block_unavailable', 'injected', 'timeout', 'error',
]);
const CONTEXT = new Set(['disabled', 'not_attempted', 'unavailable', 'stale_withheld', 'injected', 'timeout', 'error']);

function validCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 2;
}

export function parseCoverageLine(line) {
  const at = line.indexOf(PREFIX);
  if (at < 0) return null;
  let value;
  try { value = JSON.parse(line.slice(at + PREFIX.length)); }
  catch { return null; }
  if (!value || value.schema !== 1 || !MODES.has(value.analysisType) ||
      !CLASSES.has(value.assetClass) || !CANDLES.has(value.candles) ||
      !CONTEXT.has(value.marketContext) || !validCount(value.htfImagesRequested) ||
      !validCount(value.htfImagesDelivered) || value.htfImagesDelivered > value.htfImagesRequested) {
    return null;
  }
  return {
    analysisType: value.analysisType,
    assetClass: value.assetClass,
    candles: value.candles,
    marketContext: value.marketContext,
    htfImagesRequested: value.htfImagesRequested,
    htfImagesDelivered: value.htfImagesDelivered,
  };
}

function percent(n, total) {
  return total ? `${(100 * n / total).toFixed(1)}%` : 'n/d';
}

function lineFor(name, rows) {
  const n = rows.length;
  const quick = rows.filter((x) => x.analysisType === 'quick');
  const deep = rows.filter((x) => x.analysisType === 'deep');
  const quickCandles = quick.filter((x) => x.candles === 'injected').length;
  const deepCandles = deep.filter((x) => x.candles === 'injected').length;
  const context = rows.filter((x) => x.marketContext === 'injected').length;
  const htfRequested = rows.filter((x) => x.htfImagesRequested > 0).length;
  const htfDelivered = rows.filter((x) => x.htfImagesDelivered > 0).length;
  return `| ${name} | ${n} | ${quickCandles}/${quick.length} (${percent(quickCandles, quick.length)}) | ${deepCandles}/${deep.length} (${percent(deepCandles, deep.length)}) | ${context}/${n} (${percent(context, n)}) | ${htfDelivered}/${htfRequested} (${percent(htfDelivered, htfRequested)}) |`;
}

export function renderCoverageReport(text) {
  const coverageLines = text.split(/\r?\n/).filter((line) => line.includes(PREFIX));
  const rows = coverageLines.map(parseCoverageLine).filter(Boolean);
  const out = [
    '# Cobertura de dados da análise', '',
    `Registros válidos: ${rows.length}. Denominador = linhas de cobertura observadas, não todas as análises iniciadas.`, '',
    `Linhas de cobertura inválidas ou com esquema desconhecido: ${coverageLines.length - rows.length}.`, '',
    '| Classe | Registros | Candles quick | Candles deep | Contexto injetado | HTF entregue quando solicitado |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    lineFor('Todas', rows),
    ...['crypto', 'forex', 'metal', 'index', 'other', 'unknown']
      .map((name) => [name, rows.filter((x) => x.assetClass === name)])
      .filter(([, group]) => group.length)
      .map(([name, group]) => lineFor(name, group)),
    '',
    '## Motivos por modo', '',
    '| Modo | Estado de candles | Casos |', '| --- | --- | ---: |',
  ];
  for (const mode of ['quick', 'deep']) {
    for (const state of CANDLES) {
      const n = rows.filter((x) => x.analysisType === mode && x.candles === state).length;
      if (n) out.push(`| ${mode} | ${state} | ${n} |`);
    }
  }
  out.push('', '## Motivos de contexto por modo', '',
    '| Modo | Estado do contexto | Casos |', '| --- | --- | ---: |');
  for (const mode of ['quick', 'deep']) {
    for (const state of CONTEXT) {
      const n = rows.filter((x) => x.analysisType === mode && x.marketContext === state).length;
      if (n) out.push(`| ${mode} | ${state} | ${n} |`);
    }
  }
  out.push('', 'O estado `injected` significa que o bloco foi anexado ao prompt, não que os valores ou a análise final estejam corretos. O deep não tenta o bloco OHLCV/RSI quick. Falhas antes da montagem do conteúdo não geram esta linha.', '');
  return out.join('\n');
}

function cli(argv) {
  if (argv.length !== 1 || argv[0] === '--help') {
    process.stdout.write('Uso: node scripts/analysis-data-coverage-report.mjs logs-exportados.txt\n');
    if (argv.length !== 1) process.exitCode = 1;
    return;
  }
  process.stdout.write(renderCoverageReport(fs.readFileSync(argv[0], 'utf8')));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Erro de leitura'}\n`); process.exitCode = 1; }
}
