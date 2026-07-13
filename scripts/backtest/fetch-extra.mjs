#!/usr/bin/env node
/**
 * BACKTEST — Etapa A2: XAUUSD e EURUSD via Yahoo Finance (grátis, sem chave).
 *
 * Limitações do Yahoo (documentadas no relatório):
 *  - 30m: só os últimos 60 dias.
 *  - 4h: não existe nativo → baixamos 1h de 12 meses e agregamos em blocos
 *    de 4h alinhados a UTC (aprox. do 4h de corretora; horário varia entre elas).
 *  - Forex/metais spot não têm volume → gráfico sai sem painel de volume
 *    (como um print de FX real).
 *
 * Rodar (da raiz do repo):  node scripts/backtest/fetch-extra.mjs
 * Requer Node 18+. Sem dependências. Cache: pula arquivos existentes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

const DAY_MS = 24 * 3_600_000;
const H4_MS = 4 * 3_600_000;
const anchorEnd = Math.floor(Date.now() / DAY_MS) * DAY_MS;

// Candidatos em ordem de preferência — o Yahoo removeu XAUUSD=X em algumas
// regiões; GC=F (futuro de ouro COMEX) é o proxy padrão do spot (basis de
// poucos dólares; documentado no relatório via campo "source").
const CANDIDATES = {
  XAUUSD: ['GC=F', 'XAUUSD=X', 'XAU=X'], // XAUUSD=X deu 404 → futuro COMEX primeiro
  EURUSD: ['EURUSD=X', 'EUR=X'],
};

const JOBS = [
  { symbol: 'XAUUSD', interval: '30m', yInterval: '30m', days: 60 },
  { symbol: 'XAUUSD', interval: '4h', yInterval: '60m', days: 365 },
  { symbol: 'EURUSD', interval: '30m', yInterval: '30m', days: 60 },
  { symbol: 'EURUSD', interval: '4h', yInterval: '60m', days: 365 },
];

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA_STR =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Sessão Yahoo (cookie + crumb) ─────────────────────────────────────────
// O Yahoo passou a responder 429 para chamadas "secas" à API de chart.
// O fluxo abaixo é o mesmo que o yfinance usa: pega um cookie em
// fc.yahoo.com, troca por um "crumb", e manda ambos em cada chamada.
let SESSION = null; // { cookie, crumb }

async function getSession() {
  if (SESSION) return SESSION;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://fc.yahoo.com/', {
        headers: { 'User-Agent': UA_STR },
        redirect: 'manual',
      }).catch(() => null);
      const setCookie = res?.headers?.get('set-cookie') || '';
      const cookie = setCookie.split(';')[0] || '';
      const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'User-Agent': UA_STR, ...(cookie ? { Cookie: cookie } : {}) },
      });
      if (crumbRes.ok) {
        const crumb = (await crumbRes.text()).trim();
        if (crumb && !crumb.includes('<')) {
          SESSION = { cookie, crumb };
          console.log('  sessão Yahoo ok (cookie + crumb)');
          return SESSION;
        }
      }
      console.log(`  sessão Yahoo: tentativa ${attempt} falhou (HTTP ${crumbRes.status}) — aguardando 30s...`);
    } catch (err) {
      console.log(`  sessão Yahoo: tentativa ${attempt} falhou (${err.message}) — aguardando 30s...`);
    }
    await sleep(30_000);
  }
  console.log('  sem sessão Yahoo — seguindo sem crumb (pode funcionar mesmo assim)');
  SESSION = { cookie: '', crumb: '' };
  return SESSION;
}

async function yahooChart(yahooSymbol, yInterval, startMs, endMs) {
  const { cookie, crumb } = await getSession();
  let lastErr = null;
  // backoff para 429: o limite do Yahoo é por janela de tempo curta
  for (const wait of [0, 25_000, 60_000]) {
    if (wait) {
      console.log(`  429 do Yahoo — aguardando ${wait / 1000}s antes de tentar de novo...`);
      await sleep(wait);
    }
    for (const host of HOSTS) {
      const url =
        `${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
        `?interval=${yInterval}&period1=${Math.floor(startMs / 1000)}&period2=${Math.floor(endMs / 1000)}` +
        (crumb ? `&crumb=${encodeURIComponent(crumb)}` : '');
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA_STR, ...(cookie ? { Cookie: cookie } : {}) },
        });
        if (!res.ok) {
          lastErr = new Error(`Yahoo HTTP ${res.status} para ${yahooSymbol} ${yInterval}`);
          if (res.status === 404) return Promise.reject(lastErr); // símbolo não existe — não insistir
          continue;
        }
        const body = await res.json();
        const result = body?.chart?.result?.[0];
        if (!result?.timestamp) throw new Error(`Yahoo sem dados para ${yahooSymbol} ${yInterval}`);
        return parseChart(result);
      } catch (err) {
        lastErr = err;
      }
    }
    if (!String(lastErr?.message || '').includes('429')) break; // erro que não é rate limit: desiste logo
  }
  throw lastErr || new Error(`Yahoo falhou para ${yahooSymbol}`);
}

function parseChart(result) {
  const q = result.indicators.quote[0];
  const candles = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if (o == null || h == null || l == null || c == null) continue; // buracos do Yahoo
    const t = result.timestamp[i] * 1000;
    candles.push([t, o, h, l, c, q.volume?.[i] ?? 0, t]);
  }
  return candles;
}

/** Agrega candles 1h em blocos de 4h alinhados a UTC (00,04,08,12,16,20). */
function aggregate4h(h1) {
  const buckets = new Map();
  for (const c of h1) {
    const b = Math.floor(c[0] / H4_MS) * H4_MS;
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(c);
  }
  const out = [];
  for (const b of [...buckets.keys()].sort((a, z) => a - z)) {
    const cs = buckets.get(b);
    out.push([
      b,
      cs[0][1],
      Math.max(...cs.map((c) => c[2])),
      Math.min(...cs.map((c) => c[3])),
      cs[cs.length - 1][4],
      cs.reduce((s, c) => s + c[5], 0),
      b + H4_MS - 1,
    ]);
  }
  return out;
}

// ── Twelve Data (plano B — chave grátis: https://twelvedata.com, 800 req/dia) ──
// Usada automaticamente quando TWELVEDATA_API_KEY está no ambiente.
// Precisamos de só 4 requisições (XAU/USD e EUR/USD, 30min e 4h nativos).
const TD_SYMBOLS = { XAUUSD: 'XAU/USD', EURUSD: 'EUR/USD' };
const TD_INTERVALS = { '30m': '30min', '4h': '4h' };

async function twelveDataSeries(asset, interval, startMs, endMs, apikey) {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(TD_SYMBOLS[asset])}` +
    `&interval=${TD_INTERVALS[interval]}&start_date=${iso(startMs)}&end_date=${iso(endMs)}` +
    `&outputsize=5000&timezone=UTC&order=ASC&apikey=${apikey}`;
  const res = await fetch(url);
  const body = await res.json();
  if (body.status === 'error' || !Array.isArray(body.values)) {
    throw new Error(`Twelve Data: ${body.message || `HTTP ${res.status}`}`);
  }
  const candles = [];
  for (const v of body.values) {
    const t = Date.parse(v.datetime.replace(' ', 'T') + 'Z');
    const [o, h, l, c] = [Number(v.open), Number(v.high), Number(v.low), Number(v.close)];
    if (![t, o, h, l, c].every(Number.isFinite)) continue;
    candles.push([t, o, h, l, c, Number(v.volume || 0), t]);
  }
  candles.sort((a, z) => a[0] - z[0]);
  return candles;
}

async function mainTwelveData(apikey) {
  for (const job of JOBS) {
    const file = path.join(DATA_DIR, `${job.symbol}_${job.interval}.json`);
    if (fs.existsSync(file)) {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log(`✓ cache: ${job.symbol} ${job.interval} (${existing.candles.length} candles) — pulando`);
      continue;
    }
    const start = anchorEnd - job.days * DAY_MS;
    console.log(`Baixando ${job.symbol} ${job.interval} via Twelve Data (${job.days} dias)...`);
    try {
      const candles = await twelveDataSeries(job.symbol, job.interval, start, anchorEnd, apikey);
      if (candles.length < 400) {
        console.warn(`✗ ${job.symbol} ${job.interval}: só ${candles.length} candles — insuficiente (>=400), pulando.`);
        continue;
      }
      fs.writeFileSync(
        file,
        JSON.stringify({
          symbol: job.symbol,
          interval: job.interval,
          source: `Twelve Data ${TD_SYMBOLS[job.symbol]} (${TD_INTERVALS[job.interval]} nativo)`,
          sourceLabel: '',
          anchorEndIso: new Date(anchorEnd).toISOString(),
          rangeDays: job.days,
          fetchedAt: new Date().toISOString(),
          candles,
        }),
      );
      console.log(`✓ salvo: ${path.relative(process.cwd(), file)} (${candles.length} candles)`);
    } catch (err) {
      console.warn(`✗ ${job.symbol} ${job.interval}: ${err.message} — pulando (segue com o resto).`);
    }
    await sleep(9_000); // limite free: 8 req/min
  }
  console.log('\nEtapa A2 concluída (Twelve Data).');
}

/** Descobre qual símbolo do Yahoo responde (probe barato de 5 dias). */
async function resolveSymbol(asset) {
  for (const cand of CANDIDATES[asset]) {
    try {
      const probe = await yahooChart(cand, '60m', anchorEnd - 5 * DAY_MS, anchorEnd);
      if (probe.length > 10) {
        console.log(`  → ${asset}: usando "${cand}" (${probe.length} candles no probe)`);
        return cand;
      }
    } catch (err) {
      console.log(`  → ${asset}: "${cand}" falhou (${err.message})`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const tdKey = process.env.TWELVEDATA_API_KEY?.trim();
  if (tdKey) {
    return mainTwelveData(tdKey);
  }
  console.log('(sem TWELVEDATA_API_KEY no ambiente — tentando Yahoo)');

  const resolved = {};
  const failedAssets = [];
  for (const asset of Object.keys(CANDIDATES)) {
    console.log(`Resolvendo símbolo Yahoo para ${asset}...`);
    resolved[asset] = await resolveSymbol(asset);
    if (!resolved[asset]) failedAssets.push(asset);
  }

  for (const job of JOBS) {
    const yahoo = resolved[job.symbol];
    if (!yahoo) continue;
    const file = path.join(DATA_DIR, `${job.symbol}_${job.interval}.json`);
    if (fs.existsSync(file)) {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log(`✓ cache: ${job.symbol} ${job.interval} (${existing.candles.length} candles) — pulando`);
      continue;
    }
    const start = anchorEnd - job.days * DAY_MS;
    console.log(`Baixando ${job.symbol} ${job.interval} via Yahoo "${yahoo}" (${job.days} dias, ${job.yInterval})...`);
    try {
      let candles = await yahooChart(yahoo, job.yInterval, start, anchorEnd);
      if (job.interval === '4h') candles = aggregate4h(candles);
      // sanidade: estritamente crescente
      candles = candles.filter((c, i) => i === 0 || c[0] > candles[i - 1][0]);
      if (candles.length < 400) {
        console.warn(`✗ ${job.symbol} ${job.interval}: só ${candles.length} candles — insuficiente (>=400), pulando.`);
        continue;
      }
      const proxyNote = yahoo === 'GC=F' ? ' — futuro COMEX como proxy do spot XAU' : '';
      fs.writeFileSync(
        file,
        JSON.stringify({
          symbol: job.symbol,
          interval: job.interval,
          source: `Yahoo Finance ${yahoo} (${job.yInterval}${job.interval === '4h' ? ' agregado em 4h UTC' : ''})${proxyNote}`,
          sourceLabel: '',
          anchorEndIso: new Date(anchorEnd).toISOString(),
          rangeDays: job.days,
          fetchedAt: new Date().toISOString(),
          candles,
        }),
      );
      console.log(`✓ salvo: ${path.relative(process.cwd(), file)} (${candles.length} candles)`);
    } catch (err) {
      console.warn(`✗ ${job.symbol} ${job.interval}: ${err.message} — pulando (segue com o resto).`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (failedAssets.length) {
    console.warn(`\nATENÇÃO: sem fonte para ${failedAssets.join(', ')} — o backtest segue sem esse(s) ativo(s).`);
  }
  console.log('\nEtapa A2 concluída.');
}

main().catch((err) => {
  console.error('\nERRO:', err.message || err);
  process.exit(1);
});
