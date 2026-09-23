#!/usr/bin/env node
/** Simula a guarda de preço/ATR em prints históricos do piloto, sem rede ou IA. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backtest');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Mesma regra de preço da guarda atual em ai.adapter.ts; se ela mudar, refazer
// esta simulação e conferir a equivalência antes de usar os números no plano.
export function pricePassesThreeAtrGuard(candles, imagePrice) {
  if (!Number.isFinite(imagePrice) || imagePrice <= 0 || candles.length < 20) return false;
  const lastClose = candles.at(-1)[4];
  if (!Number.isFinite(lastClose) || lastClose <= 0) return false;
  const ratio = imagePrice / lastClose;
  if (ratio < 0.5 || ratio > 2) return false;
  const ranges = candles.slice(1).map((row, i) => Math.max(
    row[2] - row[3], Math.abs(row[2] - candles[i][4]), Math.abs(row[3] - candles[i][4]),
  ));
  const atr = ranges.slice(-14).reduce((sum, value) => sum + value, 0) / Math.min(14, ranges.length);
  return Number.isFinite(atr) && atr > 0 && Math.abs(imagePrice - lastClose) / atr <= 3;
}

export function simulate(manifest, readData) {
  const groups = {};
  let oldPrints = 0;
  let oldPrintsPassingPriceGuard = 0;
  const passingAgesDays = [];
  for (const item of manifest.cases) {
    const key = `${item.symbol}_${item.interval}`;
    const source = readData(key);
    if (source.sha256 !== item.dataSha256) throw new Error('Hash de candles divergente');
    const rows = source.candles;
    const cut = Date.parse(item.cutTimeIso);
    const next = rows.findIndex((row) => row[0] >= cut);
    if (next < 1 || rows[next][0] !== cut) throw new Error('Corte histórico inválido');
    const visible = rows[next - 1];
    const feed = rows.slice(-120);
    if (new Date(visible[0]).toISOString() !== item.lastVisibleOpenTimeIso || feed.length < 20) {
      throw new Error('Fonte visível ou feed inválido');
    }
    const ageDays = (feed.at(-1)[0] - visible[0]) / 86_400_000;
    if (!(ageDays > 1)) throw new Error('Caso não é print antigo');
    const passes = pricePassesThreeAtrGuard(feed, visible[4]);
    const group = groups[key] || (groups[key] = { oldPrints: 0, priceGuardPasses: 0 });
    group.oldPrints++;
    group.priceGuardPasses += Number(passes);
    oldPrints++;
    oldPrintsPassingPriceGuard += Number(passes);
    if (passes) passingAgesDays.push(Math.round(ageDays));
  }
  return {
    scope: 'Preço real do último candle visível versus últimos 120 candles locais da mesma série; não testa OCR, UI nem resultado financeiro.',
    oldPrints, oldPrintsPassingPriceGuard, passingAgesDays: passingAgesDays.sort((a, b) => a - b), groups,
  };
}

function cli() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'pilot-manifest.json'), 'utf8'));
  const cache = new Map();
  const readData = (key) => {
    if (!cache.has(key)) {
      const bytes = fs.readFileSync(path.join(ROOT, 'data', `${key}.json`));
      cache.set(key, { sha256: hash(bytes), candles: JSON.parse(bytes.toString('utf8')).candles });
    }
    return cache.get(key);
  };
  process.stdout.write(JSON.stringify(simulate(manifest, readData), null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
