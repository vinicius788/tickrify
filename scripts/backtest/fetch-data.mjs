#!/usr/bin/env node
/**
 * BACKTEST — Etapa A: dados históricos (Binance API pública, sem chave).
 *
 * Baixa klines de BTCUSDT e ETHUSDT (30m e 4h) dos últimos 12 meses e salva
 * em scripts/backtest/data/ como JSON. Cache: se o arquivo já existe, pula.
 *
 * Rodar (da raiz do repo):  node scripts/backtest/fetch-data.mjs
 * Requer Node 18+ (fetch nativo). Sem dependências.
 *
 * Reprodutibilidade: o período é ancorado no início do dia UTC em que o
 * download foi feito (gravado em data/meta.json). Re-rodar no mesmo dia
 * produz exatamente o mesmo dataset.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const INTERVALS = { '30m': 30 * 60_000, '4h': 4 * 3_600_000 };
const DAYS = 365;

// Hosts em ordem de preferência (data-api é o espelho público de market data).
const HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

const DAY_MS = 24 * 3_600_000;
const anchorEnd = Math.floor(Date.now() / DAY_MS) * DAY_MS; // hoje 00:00 UTC
const anchorStart = anchorEnd - DAYS * DAY_MS;

async function fetchKlines(symbol, interval, startTime, endTime) {
  const all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const params = new URLSearchParams({
      symbol,
      interval,
      startTime: String(cursor),
      endTime: String(endTime),
      limit: '1000',
    });
    let batch = null;
    let lastErr = null;
    for (const host of HOSTS) {
      try {
        const res = await fetch(`${host}/api/v3/klines?${params}`);
        if (!res.ok) {
          lastErr = new Error(`${host} HTTP ${res.status}`);
          continue;
        }
        batch = await res.json();
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!batch) throw lastErr || new Error('all hosts failed');
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      all.push([
        k[0], // openTime (ms)
        Number(k[1]), // open
        Number(k[2]), // high
        Number(k[3]), // low
        Number(k[4]), // close
        Number(k[5]), // volume
        k[6], // closeTime (ms)
      ]);
    }
    cursor = batch[batch.length - 1][6] + 1; // depois do closeTime do último
    process.stdout.write(`\r${symbol} ${interval}: ${all.length} candles...`);
    await new Promise((r) => setTimeout(r, 250)); // gentil com o rate limit
  }
  process.stdout.write('\n');
  return all;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const meta = {
    anchorStart,
    anchorEnd,
    anchorStartIso: new Date(anchorStart).toISOString(),
    anchorEndIso: new Date(anchorEnd).toISOString(),
    symbols: SYMBOLS,
    intervals: Object.keys(INTERVALS),
    fetchedAt: new Date().toISOString(),
    source: 'Binance /api/v3/klines (spot)',
  };

  for (const symbol of SYMBOLS) {
    for (const interval of Object.keys(INTERVALS)) {
      const file = path.join(DATA_DIR, `${symbol}_${interval}.json`);
      if (fs.existsSync(file)) {
        const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
        console.log(`✓ cache: ${symbol} ${interval} (${existing.candles.length} candles) — pulando`);
        continue;
      }
      console.log(`Baixando ${symbol} ${interval} (${DAYS} dias)...`);
      const candles = await fetchKlines(symbol, interval, anchorStart, anchorEnd);
      // Sanidade: série ordenada e sem duplicatas
      for (let i = 1; i < candles.length; i++) {
        if (candles[i][0] <= candles[i - 1][0]) {
          throw new Error(`série fora de ordem em ${symbol} ${interval} @${i}`);
        }
      }
      fs.writeFileSync(
        file,
        JSON.stringify({ symbol, interval, ...meta, candles }),
      );
      console.log(`✓ salvo: ${path.relative(process.cwd(), file)} (${candles.length} candles)`);
    }
  }

  fs.writeFileSync(path.join(DATA_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log('\nEtapa A concluída. Dados em scripts/backtest/data/');
}

main().catch((err) => {
  console.error('\nERRO:', err.message || err);
  process.exit(1);
});
