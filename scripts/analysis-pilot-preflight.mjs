#!/usr/bin/env node
/** Verifica entradas congeladas do piloto. Offline: não importa o backend nem chama APIs. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BACKTEST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backtest');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const isHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isId = (value) => typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(value);

function containedFile(root, relative, subdir) {
  if (typeof relative !== 'string') throw new Error('Caminho inválido no manifesto');
  const absolute = path.resolve(root, relative);
  const allowed = path.join(root, subdir) + path.sep;
  if (!absolute.startsWith(allowed)) throw new Error('Arquivo fora do diretório permitido');
  return absolute;
}

function verifiedHash(file, expected) {
  if (!isHash(expected)) throw new Error('Hash SHA-256 inválido no manifesto');
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== expected) throw new Error(`Hash divergente: ${path.basename(file)}`);
  return bytes;
}

export function verifyPilot(root = BACKTEST) {
  const manifestBytes = fs.readFileSync(path.join(root, 'pilot-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.cases) ||
      manifest.cases.length === 0 || manifest.count !== manifest.cases.length) {
    throw new Error('Manifesto do piloto inválido ou incompleto');
  }
  verifiedHash(path.join(root, 'samples.json'), manifest.sourceSamplesSha256);
  verifiedHash(path.join(root, 'pilot-selection.json'), manifest.selectionSha256);

  const ids = new Set();
  const modes = { quick: 0, deep: 0 };
  const classes = {};
  const seriesHashes = new Map();
  let chartBytes = 0;
  for (const c of manifest.cases) {
    if (!c || !isId(c.id) || ids.has(c.id) || !isId(c.symbol) ||
        !/^(\d+[mhdw])$/.test(c.interval || '') ||
        !Object.hasOwn(modes, c.mode) || !isId(c.assetClass)) {
      throw new Error('Caso inválido ou repetido no manifesto');
    }
    ids.add(c.id);
    modes[c.mode]++;
    classes[c.assetClass] = (classes[c.assetClass] || 0) + 1;

    const chart = containedFile(root, c.chartFile, 'charts');
    if (!chart.endsWith('.png')) throw new Error('Gráfico não é PNG');
    const bytes = verifiedHash(chart, c.chartSha256);
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      throw new Error('Gráfico sem assinatura PNG');
    }
    chartBytes += bytes.length;

    const series = `${c.symbol}_${c.interval}`;
    const data = containedFile(root, `data/${series}.json`, 'data');
    if (!seriesHashes.has(series)) seriesHashes.set(series, sha256(fs.readFileSync(data)));
    if (!isHash(c.dataSha256) || c.dataSha256 !== seriesHashes.get(series)) {
      throw new Error(`Dados divergentes: ${series}`);
    }
  }
  if (modes.quick === 0 || modes.deep === 0) throw new Error('Piloto sem os dois modos');
  if (JSON.stringify(classes) !== JSON.stringify(manifest.countByClass)) {
    throw new Error('Contagem de classes divergente');
  }
  return {
    status: 'verified_offline_no_api_calls',
    manifestSha256: sha256(manifestBytes),
    cases: manifest.cases.length,
    modes,
    classes,
    chartBytes,
    distinctSeries: seriesHashes.size,
    requiredCallsForTwoVariantsWithoutRetries: manifest.cases.length * 2,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Uso: node scripts/analysis-pilot-preflight.mjs');
    process.stdout.write(JSON.stringify(verifyPilot(), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
