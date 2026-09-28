#!/usr/bin/env node
/** Comparação offline pareada. Entrada: somente notas adjudicadas, nunca imagens. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RUBRIC_VERSION = '2026-09-23-v1';
export const AXES = ['contexto', 'estrutura', 'evidencia', 'cenario_acao', 'plano', 'risco', 'clareza'];
const CLASSES = ['cripto', 'forex', 'metais', 'indices', 'outros'];
const MODES = ['quick', 'deep'];
const STATUSES = ['completed', 'invalid', 'failed', 'timeout'];

function allowedKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: objeto obrigatório`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label}: campo não permitido: ${key}`);
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateVariant(value, assessable, label) {
  allowedKeys(value, ['status', 'scores', 'critical', 'latencyMs', 'costUsd'], label);
  if (!STATUSES.includes(value.status)) throw new Error(`${label}: status inválido`);
  if (typeof value.critical !== 'boolean') throw new Error(`${label}: critical deve ser booleano`);
  for (const field of ['latencyMs', 'costUsd']) {
    if (value[field] !== undefined && !numeric(value[field])) throw new Error(`${label}: ${field} inválido`);
  }
  if (value.status !== 'completed') {
    if (value.scores !== undefined || value.critical) throw new Error(`${label}: falha não pode receber notas ou erro crítico de leitura`);
    return;
  }
  if (!Array.isArray(value.scores) || value.scores.length !== AXES.length) throw new Error(`${label}: sete notas obrigatórias`);
  value.scores.forEach((score, i) => {
    if (assessable[i] ? !Number.isInteger(score) || score < 0 || score > 2 : score !== null) {
      throw new Error(`${label}: nota inválida em ${AXES[i]}`);
    }
  });
}

export function validateDataset(dataset) {
  allowedKeys(dataset, ['rubricVersion', 'cases'], 'dataset');
  if (dataset.rubricVersion !== RUBRIC_VERSION) throw new Error(`Versão de rubrica esperada: ${RUBRIC_VERSION}`);
  if (!Array.isArray(dataset.cases) || dataset.cases.length === 0) throw new Error('cases deve conter pelo menos um caso');
  const ids = new Set();
  for (const item of dataset.cases) {
    allowedKeys(item, ['caseId', 'assetClass', 'analysisType', 'assessable', 'baseline', 'candidate'], 'caso');
    if (typeof item.caseId !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(item.caseId) || ids.has(item.caseId)) throw new Error('caseId ausente, repetido ou inválido');
    ids.add(item.caseId);
    if (!CLASSES.includes(item.assetClass) || !MODES.includes(item.analysisType)) throw new Error(`${item.caseId}: classe ou modo inválido`);
    if (!Array.isArray(item.assessable) || item.assessable.length !== AXES.length || !item.assessable.every((x) => typeof x === 'boolean') || !item.assessable.some(Boolean)) throw new Error(`${item.caseId}: assessable inválido`);
    validateVariant(item.baseline, item.assessable, `${item.caseId}/baseline`);
    validateVariant(item.candidate, item.assessable, `${item.caseId}/candidate`);
  }
  return dataset;
}

function percentile(values, p) {
  const sorted = values.filter(numeric).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil((p / 100) * sorted.length) - 1] : null;
}

function average(values) {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function quality(item, variant) {
  if (variant.status !== 'completed') return 0;
  const max = item.assessable.filter(Boolean).length * 2;
  return variant.scores.reduce((sum, score) => sum + (score ?? 0), 0) / max;
}

function metrics(cases) {
  const side = (name) => {
    const variants = cases.map((item) => item[name]);
    const completed = variants.filter((v) => v.status === 'completed');
    const observedCost = variants.map((v) => v.costUsd).filter(numeric);
    const observedLatency = variants.map((v) => v.latencyMs).filter(numeric);
    return {
      completed: completed.length,
      invalid: variants.filter((v) => v.status === 'invalid').length,
      failed: variants.filter((v) => v.status === 'failed').length,
      timeout: variants.filter((v) => v.status === 'timeout').length,
      critical: completed.filter((v) => v.critical).length,
      qualityAll: average(cases.map((item) => quality(item, item[name]))),
      qualityCompleted: average(cases.filter((item) => item[name].status === 'completed').map((item) => quality(item, item[name]))),
      latencySeen: observedLatency.length,
      latencyP50: percentile(observedLatency, 50),
      latencyP95: percentile(observedLatency, 95),
      costSeen: observedCost.length,
      costMean: average(observedCost),
      costP95: percentile(observedCost, 95),
    };
  };
  const differences = cases.map((item) => quality(item, item.candidate) - quality(item, item.baseline));
  return {
    n: cases.length,
    baseline: side('baseline'),
    candidate: side('candidate'),
    meanDelta: average(differences),
    improved: differences.filter((d) => d > 0).length,
    worse: differences.filter((d) => d < 0).length,
    tied: differences.filter((d) => d === 0).length,
  };
}

function fmt(value, digits = 1) {
  return value === null ? 'n/d' : value.toFixed(digits);
}

function pct(value) {
  return value === null ? 'n/d' : `${fmt(value * 100)}%`;
}

function row(name, m) {
  return `| ${name} | ${m.n} | ${m.baseline.completed}/${m.candidate.completed} | ${m.baseline.critical}/${m.candidate.critical} | ${pct(m.baseline.qualityAll)}/${pct(m.candidate.qualityAll)} | ${m.meanDelta === null ? 'n/d' : `${m.meanDelta >= 0 ? '+' : ''}${fmt(m.meanDelta * 100)} pp`} | ${m.improved}/${m.worse}/${m.tied} |`;
}

export function renderEvaluation(dataset) {
  validateDataset(dataset);
  const cases = dataset.cases;
  const groups = [['Todos', cases], ...MODES.map((mode) => [mode, cases.filter((x) => x.analysisType === mode)]), ...CLASSES.map((asset) => [asset, cases.filter((x) => x.assetClass === asset)])].filter(([, rows]) => rows.length);
  const all = metrics(cases);
  const out = [
    '# Avaliação offline pareada', '',
    `Rubrica: ${RUBRIC_VERSION}. Casos: ${cases.length}. O relatório contém somente agregados.`, '',
    '| Segmento | Casos | Concluídas base/candidata | Erros críticos base/candidata | Nota incluindo falhas base/candidata | Diferença média | Melhor/pior/igual |',
    '| --- | ---: | ---: | ---: | --- | ---: | --- |',
    ...groups.map(([name, rows]) => row(name, metrics(rows))), '',
    'Falha, JSON inválido e timeout recebem nota zero na medida principal; não desaparecem da comparação. A nota condicionada a respostas concluídas é apenas diagnóstico.', '',
    '| Variante | Inválidas | Falhas | Timeout | Nota nas concluídas | Latência p50/p95 (ms; cobertura) | Custo médio/p95 (USD; cobertura) |',
    '| --- | ---: | ---: | ---: | --- | --- | --- |',
  ];
  for (const [name, side] of [['base', all.baseline], ['candidata', all.candidate]]) {
    out.push(`| ${name} | ${side.invalid} | ${side.failed} | ${side.timeout} | ${pct(side.qualityCompleted)} | ${fmt(side.latencyP50, 0)}/${fmt(side.latencyP95, 0)} (${side.latencySeen}/${all.n}) | ${fmt(side.costMean, 4)}/${fmt(side.costP95, 4)} (${side.costSeen}/${all.n}) |`);
  }
  out.push('', 'Diferenças são pareadas por caso. Este relatório não prova significância estatística nem rentabilidade. Conferir tamanho de cada segmento, concordância entre revisores, cobertura, custo e resultado de mercado antes de uma decisão.', '');
  return out.join('\n');
}

function cli(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('Uso: node scripts/analysis-eval.mjs notas-adjudicadas.json [--out relatorio.md]\n');
    return;
  }
  if (!argv[0] || (argv.length !== 1 && (argv.length !== 3 || argv[1] !== '--out'))) throw new Error('Uso: node scripts/analysis-eval.mjs notas-adjudicadas.json [--out relatorio.md]');
  const report = renderEvaluation(JSON.parse(readFileSync(argv[0], 'utf8')));
  if (argv[2]) writeFileSync(argv[2], `${report}\n`);
  else process.stdout.write(`${report}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
