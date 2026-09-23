#!/usr/bin/env node
/** Relatório local e agregado. Não envia logs ou identificadores a serviços externos. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = ['quick', 'deep', 'unknown'];
const OUTCOMES = ['completed', 'invalid', 'failed', 'retry'];

function finiteNonnegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fields(line) {
  return Object.fromEntries([...line.matchAll(/\b([A-Za-z][A-Za-z0-9]*)=([^\s]+)/g)].map((m) => [m[1], m[2]]));
}

function typeOf(raw) {
  return raw === 'quick' || raw === 'deep' ? raw : 'unknown';
}

function safeModel(raw) {
  return typeof raw === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(raw) ? raw : 'unknown';
}

export function parseMetric(line) {
  const match = line.match(/\[Metrics\] analysis (completed|invalid|failed|retry)\s*\|/);
  if (!match) return null;
  const f = fields(line.slice(match.index + match[0].length));
  if (!f.analysisId || !/^\d+$/.test(f.attempt || '')) return null;
  return {
    id: f.analysisId,
    type: typeOf(f.analysisType),
    outcome: match[1],
    attempt: Number(f.attempt),
    latencyMs: finiteNonnegative(f.latencyMs),
    queueWaitMs: finiteNonnegative(f.queueWaitMs),
    aiMs: finiteNonnegative(f.aiMs),
  };
}

export function parseCost(line) {
  const match = line.match(/\[Cost\]\s+(quick|deep)\s+/);
  if (!match) return null;
  const f = fields(line.slice(match.index + match[0].length));
  const money = f.cost === 'unknown' ? null : finiteNonnegative(f.cost?.replace(/^\$/, ''));
  return {
    type: typeOf(match[1]),
    model: safeModel(f.model),
    prompt: finiteNonnegative(f.prompt),
    completion: finiteNonnegative(f.completion),
    reasoning: finiteNonnegative(f.reasoning),
    costUsd: money,
  };
}

export function percentile(values, percentage) {
  const sorted = values.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1)];
}

function average(values) {
  const valid = values.filter((v) => v !== null && Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

export function summarizeLogs(contents) {
  const attempts = new Map();
  const costs = [];
  const counts = { metrics: 0, costs: 0, discardedMetrics: 0 };
  for (const content of contents) {
    for (const line of content.split(/\r?\n/)) {
      if (line.includes('[Metrics]')) {
        const metric = parseMetric(line);
        if (!metric) { counts.discardedMetrics++; continue; }
        counts.metrics++;
        // Sobreposição entre arquivos de exportação não duplica tentativas.
        attempts.set(`${metric.id}\0${metric.attempt}\0${metric.outcome}`, metric);
      }
      if (line.includes('[Cost]')) {
        const cost = parseCost(line);
        if (cost) { counts.costs++; costs.push(cost); }
      }
    }
  }
  const byId = new Map();
  for (const attempt of attempts.values()) {
    const list = byId.get(attempt.id) || [];
    list.push(attempt);
    byId.set(attempt.id, list);
  }
  const statusPriority = { retry: 0, failed: 1, invalid: 2, completed: 3 };
  const analyses = [...byId.values()].map((list) => {
    const last = [...list].sort((a, b) => a.attempt - b.attempt || statusPriority[a.outcome] - statusPriority[b.outcome]).at(-1);
    return { ...last, retried: list.some((x) => x.outcome === 'retry'), attempts: list.length };
  });
  return {
    counts,
    analyses,
    attempts: [...attempts.values()],
    costs,
  };
}

function countBy(items, key) {
  return items.filter((item) => item[key]).length;
}

function fmt(value, digits = 0) {
  return value === null || value === undefined ? 'n/d' : Number(value).toFixed(digits);
}

function fmtRate(n, d) {
  return d ? `${fmt((100 * n) / d, 1)}% (${n}/${d})` : 'n/d';
}

function resultCell(row) {
  return row && Number.isFinite(row.n) && row.n > 0
    ? `${row.wins}/${row.n} (${fmt(row.rate, 1)}%; IC 95% ${fmt(row.low, 1)}–${fmt(row.high, 1)}%)`
    : 'n/d';
}

export function renderReport({ accuracy = null, logs = null, source = 'arquivo JSON fornecido' } = {}) {
  const out = ['# Linha de base da análise de IA', '', `Fontes: ${source}${logs ? '; exportação local de logs' : ''}.`, ''];
  if (accuracy) {
    out.push('## Resultados já maturados', '');
    out.push(`Atualização da API: ${String(accuracy.updatedAt || 'n/d').replace(/[^0-9TZ:.+\-]/g, '') || 'n/d'}.`);
    out.push(`WIN/(WIN+LOSS): ${resultCell(accuracy.overall)}. Esse denominador exclui NO_FILL, ABSTAIN, UNTRACKABLE e resultados ainda pendentes.`);
    const abst = accuracy.abstention;
    if (abst) out.push(`Ação WAIT: ${fmtRate(abst.wait, abst.total)} das recomendações contadas pela API; WAIT pode ter cenário direcional.`);
    out.push('', '| Resultado registrado | Quantidade |', '| --- | ---: |');
    for (const key of ['WIN', 'LOSS', 'NO_FILL', 'TIMEOUT', 'ABSTAIN', 'INCOMPLETE', 'UNTRACKABLE']) {
      out.push(`| ${key} | ${Number(accuracy.breakdown?.[key] || 0)} |`);
    }
    out.push('', '| Confiança | Acertos/conclusivas |', '| --- | --- |');
    for (const row of accuracy.byConfidence || []) out.push(`| ${row.band} | ${resultCell(row)} |`);
    out.push('', '| Grounding | Acertos/conclusivas |', '| --- | --- |');
    for (const key of ['before', 'after']) out.push(`| ${key} | ${resultCell(accuracy.byGrounding?.[key])} |`);
    out.push('', '| Versão de prompt agrupada pela API | Acertos/conclusivas |', '| --- | --- |');
    for (const [key, row] of Object.entries(accuracy.byPrompt || {})) {
      out.push(`| ${safeModel(key)} | ${resultCell(row)} |`);
    }
    out.push('', '| Modelo registrado | Acertos/conclusivas |', '| --- | --- |');
    for (const row of accuracy.byModel || []) out.push(`| ${safeModel(row.model)} | ${resultCell(row)} |`);
    out.push('', 'As coortes pequenas e os intervalos sobrepostos não permitem atribuir ganho ao modelo, ao grounding ou à confiança. Modelos ausentes no histórico não entram nas linhas por modelo.', '');
  }
  if (logs) {
    out.push('## Operação medida nos logs', '');
    out.push(`Linhas [Metrics] válidas: ${logs.counts.metrics}; únicas após deduplicar tentativa/estado: ${logs.attempts.length}; malformadas: ${logs.counts.discardedMetrics}. Linhas [Cost]: ${logs.counts.costs}.`);
    out.push('Uma análise é identificada pelo último número de tentativa observado. `retry` como último estado significa que o export pode estar incompleto.', '');
    out.push('| Tipo | Análises vistas | Concluídas | Inválidas | Falhas | Só retry | Com retry | p50/p95 total concluídas (ms) | p95 IA (ms) |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |');
    for (const type of TYPES) {
      const rows = logs.analyses.filter((a) => a.type === type);
      if (!rows.length) continue;
      const complete = rows.filter((a) => a.outcome === 'completed');
      out.push(`| ${type} | ${rows.length} | ${complete.length} | ${rows.filter((a) => a.outcome === 'invalid').length} | ${rows.filter((a) => a.outcome === 'failed').length} | ${rows.filter((a) => a.outcome === 'retry').length} | ${countBy(rows, 'retried')} | ${fmt(percentile(complete.map((a) => a.latencyMs), 50))}/${fmt(percentile(complete.map((a) => a.latencyMs), 95))} | ${fmt(percentile(complete.map((a) => a.aiMs), 95))} |`);
    }
    out.push('', '| Tipo | Modelo | Chamadas de custo | Preço conhecido | Custo médio/p95 conhecido (USD) | Tokens entrada/saída/raciocínio médios |', '| --- | --- | ---: | ---: | --- | --- |');
    const groups = new Map();
    for (const cost of logs.costs) {
      const key = `${cost.type}\0${cost.model}`;
      const group = groups.get(key) || [];
      group.push(cost);
      groups.set(key, group);
    }
    for (const [key, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const [type, model] = key.split('\0');
      const priced = rows.map((r) => r.costUsd).filter((v) => v !== null);
      out.push(`| ${type} | ${model} | ${rows.length} | ${priced.length} | ${fmt(average(priced), 4)}/${fmt(percentile(priced, 95), 4)} | ${fmt(average(rows.map((r) => r.prompt)))}/${fmt(average(rows.map((r) => r.completion)))}/${fmt(average(rows.map((r) => r.reasoning)))} |`);
    }
    out.push('', 'Os logs de custo não têm `analysisId`: chamadas de custo não podem ser ligadas a resultados nem deduplicadas entre exportações sobrepostas. Raciocínio já está incluído em tokens de saída. O custo em USD usa a tabela de preços do backend, que deve ser revisada antes de orçamento. Log parcial não mede taxa real de falha nem gasto total.', '');
  }
  if (!accuracy && !logs) out.push('Nenhuma fonte fornecida. Passe `--accuracy` e/ou `--logs`.', '');
  return out.join('\n');
}

function cli(argv) {
  let accuracyPath = null;
  let outputPath = null;
  const logPaths = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help') {
      process.stdout.write('Uso: node scripts/analysis-baseline.mjs [--accuracy snapshot.json] [--logs export.log ...] [--out report.md]\n');
      return;
    }
    if (!['--accuracy', '--logs', '--out'].includes(flag) || !argv[i + 1]) throw new Error(`Argumento inválido: ${flag}`);
    const value = argv[++i];
    if (flag === '--accuracy') accuracyPath = value;
    if (flag === '--logs') logPaths.push(value);
    if (flag === '--out') outputPath = value;
  }
  const accuracy = accuracyPath ? JSON.parse(readFileSync(accuracyPath, 'utf8')) : null;
  const logs = logPaths.length ? summarizeLogs(logPaths.map((p) => readFileSync(p, 'utf8'))) : null;
  const report = renderReport({ accuracy, logs, source: accuracyPath ? 'snapshot JSON local' : 'sem snapshot de acurácia' });
  if (outputPath) writeFileSync(outputPath, `${report}\n`);
  else process.stdout.write(`${report}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
