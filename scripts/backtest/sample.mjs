#!/usr/bin/env node
/**
 * BACKTEST — Etapa B: amostragem CEGA de timestamps (seed fixa).
 *
 * Sorteia pontos de corte aleatórios em cada série (ativo × timeframe), com:
 *  - seed fixa (reprodutível — mesmo dataset ⇒ mesma amostra, sempre);
 *  - ≥120 candles ANTES do corte (pro render) e ≥96 DEPOIS (pra avaliação);
 *  - espaçamento mínimo de 24h entre amostras da mesma série (sem sobreposição);
 *  - NENHUM filtro de "setup bonito". O sorteio é cego por construção:
 *    este script não olha preço, só timestamps.
 *
 * Rodar: node scripts/backtest/sample.mjs
 * Saída: scripts/backtest/samples.json + distribuição impressa no terminal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const OUT = path.join(__dirname, 'samples.json');

const SEED = 20260713; // fixa — nunca mudar depois de rodar (regra anti p-hacking)
const PER_SERIES = 75; // fallback
// 300 análises divididas IGUALMENTE por mercado (75 cada), fixado antes da
// rodada principal (13/07/2026). Nos 30m de XAU/EUR a janela de 60 dias da
// fonte limita a 25; o 4h compensa com 50.
const TARGETS = {
  'BTCUSDT_30m': 38,
  'BTCUSDT_4h': 37,
  'ETHUSDT_30m': 38,
  'ETHUSDT_4h': 37,
  'XAUUSD_30m': 25,
  'XAUUSD_4h': 50,
  'EURUSD_30m': 25,
  'EURUSD_4h': 50,
};
const LOOKBACK = 120; // candles no gráfico
const HORIZON = 96; // candles de avaliação após o corte
const MIN_GAP_MS = 24 * 3_600_000; // 24h entre amostras da mesma série

// PRNG determinístico (mulberry32)
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const files = fs
  .readdirSync(DATA_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'meta.json')
  .sort(); // ordem determinística

if (files.length === 0) {
  console.error('Nenhum dado em scripts/backtest/data/. Rode antes: node scripts/backtest/fetch-data.mjs');
  process.exit(1);
}

const rng = mulberry32(SEED);
const samples = [];
const distByMonth = {};

for (const file of files) {
  const { symbol, interval, candles } = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, file), 'utf8'),
  );
  const target = TARGETS[`${symbol}_${interval}`] ?? PER_SERIES;
  const eligible = [];
  for (let i = LOOKBACK; i <= candles.length - HORIZON; i++) eligible.push(i);

  const chosen = [];
  for (const i of shuffled(eligible, rng)) {
    const t = candles[i][0];
    if (chosen.every((j) => Math.abs(candles[j][0] - t) >= MIN_GAP_MS)) {
      chosen.push(i);
      if (chosen.length === target) break;
    }
  }
  chosen.sort((a, b) => a - b);

  if (chosen.length < target) {
    console.warn(
      `AVISO: ${symbol} ${interval} só comporta ${chosen.length}/${target} amostras com gap de 24h.`,
    );
  }

  for (const i of chosen) {
    const cutTime = candles[i][0]; // openTime do 1º candle NÃO visível
    const id = `${symbol}_${interval}_${cutTime}`;
    samples.push({
      id,
      symbol,
      interval,
      cutIndex: i, // gráfico mostra candles[i-120 .. i-1]; avaliação usa [i .. i+95]
      cutTime,
      cutTimeIso: new Date(cutTime).toISOString(),
    });
    const month = new Date(cutTime).toISOString().slice(0, 7);
    distByMonth[`${symbol} ${interval}`] ??= {};
    distByMonth[`${symbol} ${interval}`][month] =
      (distByMonth[`${symbol} ${interval}`][month] || 0) + 1;
  }
  console.log(`${symbol} ${interval}: ${chosen.length} amostras`);
}

fs.writeFileSync(
  OUT,
  JSON.stringify({ seed: SEED, perSeries: PER_SERIES, lookback: LOOKBACK, horizon: HORIZON, minGapMs: MIN_GAP_MS, generatedAt: new Date().toISOString(), samples }, null, 1),
);

console.log(`\nTotal: ${samples.length} amostras → ${path.relative(process.cwd(), OUT)}`);
console.log('\nDistribuição por mês:');
for (const [series, months] of Object.entries(distByMonth)) {
  const line = Object.keys(months)
    .sort()
    .map((m) => `${m.slice(2)}:${months[m]}`)
    .join('  ');
  console.log(`  ${series}\n    ${line}`);
}
