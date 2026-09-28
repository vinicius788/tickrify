#!/usr/bin/env node
/** Prepare and verify a local, blind chart-reading pilot without model calls. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BACKTEST = path.join(ROOT, 'backtest');
const SELECTION = path.join(BACKTEST, 'pilot-selection.json');
const OUTPUT = path.join(BACKTEST, 'pilot-manifest.json');
const SEED = 'tickrify-analysis-pilot-v1';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const marketOf = (symbol) => {
  if (/USDT$/.test(symbol)) return 'crypto';
  if (symbol === 'XAUUSD' || symbol === 'XAGUSD') return 'metal';
  if (/^[A-Z]{6}$/.test(symbol)) return 'forex';
  return 'other';
};

export function selectPilot(samples, target = 48) {
  if (!Number.isInteger(target) || target < 1) throw new Error('target deve ser inteiro positivo');
  const groups = new Map();
  samples.forEach((sample, sampleIndex) => {
    const series = `${sample.symbol}_${sample.interval}`;
    if (!groups.has(series)) groups.set(series, []);
    groups.get(series).push({ ...sample, sampleIndex, series });
  });
  if (!groups.size) throw new Error('Amostra vazia');
  const keys = [...groups.keys()].sort();
  const floor = Math.floor(target / keys.length);
  const remainder = target % keys.length;
  const selected = [];
  keys.forEach((key, groupIndex) => {
    const count = floor + (groupIndex < remainder ? 1 : 0);
    const group = groups.get(key).sort((a, b) => {
      const ah = sha256(`${SEED}:${a.id}`);
      const bh = sha256(`${SEED}:${b.id}`);
      return ah.localeCompare(bh);
    });
    if (group.length < count) throw new Error(`${key}: apenas ${group.length}/${count} casos disponíveis`);
    group.slice(0, count).forEach((s, index) => {
      selected.push({
        id: s.id,
        sampleIndex: s.sampleIndex,
        symbol: s.symbol,
        interval: s.interval,
        assetClass: marketOf(s.symbol),
        mode: index % 2 === 0 ? 'quick' : 'deep',
        cutTimeIso: s.cutTimeIso,
      });
    });
  });
  return selected.sort((a, b) => a.sampleIndex - b.sampleIndex);
}

export function verifyCut(sample, candles, lookback, horizon) {
  const i = sample.cutIndex;
  if (!Number.isInteger(i) || i < lookback || i + horizon > candles.length) {
    throw new Error(`${sample.id}: janela insuficiente`);
  }
  const previous = candles[i - 1];
  const next = candles[i];
  if (next[0] !== sample.cutTime || previous[0] >= sample.cutTime || previous[6] >= sample.cutTime) {
    throw new Error(`${sample.id}: corte temporal inválido ou dado futuro visível`);
  }
  return {
    lastVisibleOpenTimeIso: new Date(previous[0]).toISOString(),
    lastVisibleCloseTimeIso: new Date(previous[6]).toISOString(),
  };
}

function prepare(target) {
  const sampleFile = path.join(BACKTEST, 'samples.json');
  const source = readJson(sampleFile);
  const selection = selectPilot(source.samples, target);
  const output = {
    schemaVersion: 1,
    seed: SEED,
    target,
    sourceSamplesSha256: sha256(fs.readFileSync(sampleFile)),
    preparedAt: new Date().toISOString(),
    selection,
  };
  if (fs.existsSync(SELECTION)) {
    const previous = readJson(SELECTION);
    if (previous.sourceSamplesSha256 !== output.sourceSamplesSha256 ||
        JSON.stringify(previous.selection) !== JSON.stringify(selection)) {
      throw new Error('Seleção existente difere da atual; preserve o piloto congelado e use outro diretório para uma nova rodada');
    }
    console.log(`${selection.length} casos já congelados em ${SELECTION}`);
    return;
  }
  fs.writeFileSync(SELECTION, JSON.stringify(output, null, 2) + '\n');
  console.log(`${selection.length} casos selecionados em ${SELECTION}`);
  for (const key of [...new Set(selection.map((s) => `${s.assetClass}/${s.symbol}_${s.interval}`))]) {
    const cases = selection.filter((s) => `${s.assetClass}/${s.symbol}_${s.interval}` === key);
    console.log(`  ${key}: ${cases.length} (${cases.filter((s) => s.mode === 'quick').length} quick, ${cases.filter((s) => s.mode === 'deep').length} deep)`);
  }
}

function finalize() {
  const selection = readJson(SELECTION);
  const sampleFile = path.join(BACKTEST, 'samples.json');
  if (sha256(fs.readFileSync(sampleFile)) !== selection.sourceSamplesSha256) {
    throw new Error('samples.json mudou após a seleção; refaça o piloto antes de avaliar');
  }
  const source = readJson(sampleFile);
  const rendered = new Map(readJson(path.join(BACKTEST, 'manifest.json')).entries.map((e) => [e.id, e]));
  const seriesCache = new Map();
  const cases = selection.selection.map((choice) => {
    const sample = source.samples[choice.sampleIndex];
    if (!sample || sample.id !== choice.id) throw new Error(`${choice.id}: amostra alterada`);
    const entry = rendered.get(choice.id);
    if (!entry) throw new Error(`${choice.id}: gráfico não renderizado`);
    const seriesKey = `${sample.symbol}_${sample.interval}`;
    if (!seriesCache.has(seriesKey)) {
      const file = path.join(BACKTEST, 'data', `${seriesKey}.json`);
      seriesCache.set(seriesKey, { data: readJson(file), hash: sha256(fs.readFileSync(file)) });
    }
    const { data, hash } = seriesCache.get(seriesKey);
    const lastVisible = verifyCut(sample, data.candles, source.lookback, source.horizon);
    const chartFile = path.resolve(BACKTEST, entry.file);
    if (!chartFile.startsWith(path.join(BACKTEST, 'charts') + path.sep)) {
      throw new Error(`${choice.id}: caminho de gráfico inválido`);
    }
    const chartSha256 = sha256(fs.readFileSync(chartFile));
    return {
      ...choice,
      cutTimeIso: sample.cutTimeIso,
      ...lastVisible,
      chartFile: path.relative(BACKTEST, chartFile),
      chartSha256,
      dataSource: data.source,
      dataSha256: hash,
    };
  });
  const countByClass = Object.fromEntries([...new Set(cases.map((c) => c.assetClass))].sort().map((kind) => [kind, cases.filter((c) => c.assetClass === kind).length]));
  const output = {
    schemaVersion: 1,
    purpose: 'piloto local de leitura de gráficos; sem respostas de IA ou resultado financeiro',
    seed: selection.seed,
    sourceSamplesSha256: selection.sourceSamplesSha256,
    selectionSha256: sha256(fs.readFileSync(SELECTION)),
    finalizedAt: new Date().toISOString(),
    count: cases.length,
    countByClass,
    missingClasses: ['crypto', 'forex', 'metal', 'index'].filter((kind) => !countByClass[kind]),
    cases,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(`${cases.length} gráficos verificados em ${OUTPUT}`);
  console.log(`Classes ausentes: ${output.missingClasses.join(', ') || 'nenhuma'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === 'prepare') prepare(Number(process.argv[3] ?? 48));
    else if (command === 'finalize') finalize();
    else throw new Error('Uso: node scripts/analysis-pilot.mjs prepare [48] | finalize');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
