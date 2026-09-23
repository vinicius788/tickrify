#!/usr/bin/env node
/** Diagnóstico agregado de WAIT em resultados locais. Nunca chama a IA. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function action(value) {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'BUY' || normalized === 'COMPRA') return 'BUY';
  if (normalized === 'SELL' || normalized === 'VENDA') return 'SELL';
  if (normalized === 'WAIT' || normalized === 'HOLD' || normalized === 'AGUARDAR') return 'WAIT';
  return null;
}

function parseJsonl(content) {
  const records = new Map();
  let duplicates = 0;
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); }
    catch { throw new Error(`Linha JSONL ${index + 1} inválida`); }
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string') {
      throw new Error(`Linha JSONL ${index + 1} sem id válido`);
    }
    if (records.has(row.id)) duplicates++;
    records.set(row.id, row); // tentativa mais recente é o estado da análise
  }
  return { records, duplicates };
}

function emptyCounts(expected) {
  return {
    expected, seen: 0, completed: 0, failed: 0, incomplete: 0,
    rawKnown: 0, rawWait: 0, finalWait: 0, finalSignal: 0,
    signalDowngraded: 0, waitPromoted: 0, modeUnknown: 0, modeMismatch: 0,
    chartHashUnknown: 0, chartHashMismatch: 0, symbolMismatch: 0,
  };
}

export function diagnoseVariant(manifest, content) {
  if (!manifest || !Array.isArray(manifest.cases) || !manifest.cases.length) {
    throw new Error('Manifesto sem casos');
  }
  if (manifest.cases.some((c) =>
    !c || typeof c.id !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(c.id) ||
    typeof c.symbol !== 'string' || typeof c.interval !== 'string')) {
    throw new Error('Manifesto com identificação de caso inválida');
  }
  const ids = new Set(manifest.cases.map((c) => c.id));
  if (ids.size !== manifest.cases.length) throw new Error('Manifesto com ids repetidos');
  const { records, duplicates } = parseJsonl(content);
  const counts = emptyCounts(manifest.cases.length);
  const byMode = { quick: emptyCounts(0), deep: emptyCounts(0) };
  const completed = new Map();
  for (const c of manifest.cases) {
    const group = byMode[c.mode];
    if (!group || !/^[a-f0-9]{64}$/.test(c.chartSha256 || '')) {
      throw new Error('Manifesto sem modo ou hash de gráfico válido');
    }
    group.expected++;
    const row = records.get(c.id);
    if (!row) continue;
    for (const target of [counts, group]) {
      target.seen++;
      if (row.analysisType === undefined) target.modeUnknown++;
      else if (row.analysisType !== c.mode) target.modeMismatch++;
      if (row.chartSha256 === undefined) target.chartHashUnknown++;
      else if (row.chartSha256 !== c.chartSha256) target.chartHashMismatch++;
      if (row.symbol !== c.symbol || row.interval !== c.interval) target.symbolMismatch++;
      if (row.error) { target.failed++; continue; }
      const final = action(row.recommendation);
      if (!final) { target.incomplete++; continue; }
      target.completed++;
      if (final === 'WAIT') target.finalWait++;
      else target.finalSignal++;
      const raw = action(row.rawRecommendation);
      if (raw) {
        target.rawKnown++;
        if (raw === 'WAIT') target.rawWait++;
        if (raw !== 'WAIT' && final === 'WAIT') target.signalDowngraded++;
        if (raw === 'WAIT' && final !== 'WAIT') target.waitPromoted++;
      }
    }
    const inputVerified = row.analysisType === c.mode &&
      row.chartSha256 === c.chartSha256 &&
      row.symbol === c.symbol && row.interval === c.interval;
    if (!row.error && inputVerified) {
      const final = action(row.recommendation);
      if (final) completed.set(c.id, final);
    }
  }
  return {
    counts,
    byMode,
    completed,
    duplicates,
    outsideManifest: [...records.keys()].filter((id) => !ids.has(id)).length,
  };
}

const ratio = (n, d) => d ? `${(100 * n / d).toFixed(1)}% (${n}/${d})` : 'n/d';

export function renderDiagnostic(manifest, baselineContent, candidateContent = null) {
  const base = diagnoseVariant(manifest, baselineContent);
  const candidate = candidateContent === null ? null : diagnoseVariant(manifest, candidateContent);
  const out = [
    '# Diagnóstico offline de WAIT', '',
    `Casos congelados: ${manifest.cases.length}. Apenas ações e metadados agregados; sem imagem, resposta bruta ou identificadores.`, '',
    '| Medida | Baseline | Candidata |', '| --- | ---: | ---: |',
  ];
  const cell = (variant, fn) => variant ? fn(variant.counts) : 'n/d';
  const rows = [
    ['Casos presentes', (c) => `${c.seen}/${c.expected}`],
    ['Concluídos', (c) => `${c.completed}/${c.expected}`],
    ['Falhas / incompletos', (c) => `${c.failed} / ${c.incomplete}`],
    ['WAIT na resposta crua conhecida', (c) => ratio(c.rawWait, c.rawKnown)],
    ['WAIT após regras', (c) => ratio(c.finalWait, c.completed)],
    ['Sinal cru rebaixado para WAIT', (c) => `${c.signalDowngraded}/${c.rawKnown}`],
    ['WAIT cru promovido a sinal', (c) => `${c.waitPromoted}/${c.rawKnown}`],
    ['Modo não verificável / divergente', (c) => `${c.modeUnknown} / ${c.modeMismatch}`],
    ['Hash do gráfico não verificável / divergente', (c) => `${c.chartHashUnknown} / ${c.chartHashMismatch}`],
    ['Ativo ou período divergente', (c) => String(c.symbolMismatch)],
  ];
  for (const [label, fn] of rows) out.push(`| ${label} | ${cell(base, fn)} | ${cell(candidate, fn)} |`);
  out.push('', 'Por modo:', '', '| Modo | Baseline concluído / WAIT final | Candidata concluído / WAIT final |', '| --- | --- | --- |');
  for (const mode of ['quick', 'deep']) {
    const format = (result) => result ? `${result.byMode[mode].completed}/${result.byMode[mode].expected} · ${ratio(result.byMode[mode].finalWait, result.byMode[mode].completed)}` : 'n/d';
    out.push(`| ${mode} | ${format(base)} | ${format(candidate)} |`);
  }
  if (candidate) {
    const paired = [...base.completed.keys()].filter((id) => candidate.completed.has(id));
    const waitToSignal = paired.filter((id) => base.completed.get(id) === 'WAIT' && candidate.completed.get(id) !== 'WAIT').length;
    const signalToWait = paired.filter((id) => base.completed.get(id) !== 'WAIT' && candidate.completed.get(id) === 'WAIT').length;
    out.push('', `Comparação pareada de ação com entrada verificada: ${paired.length} casos concluídos em ambas; WAIT→sinal ${waitToSignal}; sinal→WAIT ${signalToWait}.`);
  }
  out.push('', `Linhas repetidas baseline/candidata: ${base.duplicates}/${candidate?.duplicates ?? 'n/d'}; fora do manifesto: ${base.outsideManifest}/${candidate?.outsideManifest ?? 'n/d'}.`,
    'Uma queda de WAIT não prova leitura melhor nem retorno financeiro. Conferir a rubrica cega, falhas, cobertura e outcomes separadamente. Casos sem resposta crua não entram na taxa pré-regras. A comparação pareada exige modo, hash do gráfico, ativo e período verificados em ambas as variantes.', '');
  return out.join('\n');
}

function cli(args) {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--manifest', '--baseline', '--candidate', '--out'].includes(key) || !args[i + 1]) {
      throw new Error('Uso: --manifest pilot-manifest.json --baseline resultados.jsonl [--candidate resultados.jsonl] [--out relatorio.md]');
    }
    opts[key] = args[i + 1];
  }
  if (!opts['--manifest'] || !opts['--baseline']) throw new Error('Manifesto e baseline são obrigatórios');
  const report = renderDiagnostic(
    JSON.parse(readFileSync(opts['--manifest'], 'utf8')),
    readFileSync(opts['--baseline'], 'utf8'),
    opts['--candidate'] ? readFileSync(opts['--candidate'], 'utf8') : null,
  );
  if (opts['--out']) writeFileSync(opts['--out'], report + '\n');
  else process.stdout.write(report + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
