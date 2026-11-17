#!/usr/bin/env ts-node
/**
 * Replay de prints REAIS de producao pelo MESMO caminho do worker
 * (`buildAnalysisPrompt` + `AIAdapter.analyzeImage`, com a decisao e o
 * validador de producao), medido pela regua do sweeper (TP1 x SL em 48h, 30m).
 *
 * Um braco por execucao: roda o prompt que o codigo desta pasta usa hoje.
 * Para comparar dois prompts, rode cada um no seu checkout com --arm e
 * --out diferentes e o mesmo --candles (os candles saem do cache na 2a vez).
 *
 * Uso (em apps/backend, com o .env de producao para ler os prints):
 *   pnpm exec ts-node scripts/prompt-replay.ts --input ../../_local/replay-input.json --arm v10 --out ../../_local/replay-v10.jsonl --candles ../../_local/replay-candles.json
 * Sem --execute so conta casos. --budget <US$> para no teto (padrao 1.5),
 * contando o custo real devolvido pelo provedor. --summary so resume os
 * arquivos passados em --out (separados por virgula). Retomavel.
 * O prompt nunca e gravado; so as respostas resumidas (com o checklist).
 *
 * --real-data <gabarito> --history <cache.json> (27/10/2026): injeta o REAL
 * DATA de producao com os candles DA EPOCA do print (120 do tempo grafico,
 * terminando na hora do envio), pelo mesmo `buildCandleBlocks` do quick
 * (trava de print velho inclusa). Simbolo, tempo grafico e preco vem do
 * gabarito ("id8,simbolo,tf,preco;..."), nao da leitura do modelo. Funding,
 * juros e calendario ficam de fora: so existem ao vivo. Sem --execute, busca
 * os candles (gratis) e conta quantos prints recebem o bloco.
 *
 * v10.1 (27/10/2026): cada linha guarda tambem o estado e o watchPlan que o
 * MODELO deu (antes do validador), o ATR e o resumo do 4h do REAL DATA, para
 * o `replay-variants.ts` simular a ordem limit e as referencias sem chamar a IA.
 * Com --real-data, o 4h tambem sai do cache de candles da epoca.
 */
// Sem news guard em todo braco: o calendario de HOJE nao vale para um grafico
// antigo. Grounding so com --real-data, e com candles da epoca.
process.env.ENABLE_NEWS_GUARD = 'false';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { AIAdapter } from '../src/modules/ai/ai.adapter';
import { TIMEFRAME_MS } from '../src/modules/market/candle-store';
import { buildAnalysisPrompt } from '../src/modules/prompt/prompt-builder.service';
import { canonicalFxPair } from '../src/common/utils/analysis-normalizer';
import { computeCost } from '../src/modules/ai/model-cost';
import { FILL_CANDLE_RULE } from '../src/modules/ai/accuracy.util';
import { normalizeToBinancePerp } from '../src/modules/market/market.service';
import { evaluateTrade } from '../worker/outcome.sweeper';
import { Candle, fetchCryptoWindow, fetchFxWindow } from '../src/modules/market/candles';
import { enterTwelveDataExperimentMode, experimentRefusesFx, twelveDataOpenMs, twelveDataTimeSeries } from '../src/modules/market/twelve-data';

const WINDOW_MS = 48 * 60 * 60 * 1000;
const STATES = ['NO_TRADE', 'WATCH', 'ARMED', 'ENTER_NOW'] as const;
type State = (typeof STATES)[number];
type Cls = 'crypto' | 'metal' | 'forex';

interface InputRow {
  id: string;
  createdAt: string;
  imageUrl: string;
  symbol: string;
}
interface Plan {
  side: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
}
interface Done {
  id: string;
  arm: string;
  symbol: string;
  cls: Cls;
  state: State | 'ERROR';
  recommendation: string;
  confidence: number | null;
  currentPrice: number | null;
  /** Plano ativo (ARMED/ENTER_NOW) ou condicional (WATCH com niveis). */
  plan: Plan | null;
  /** WIN, LOSS, NO_FILL, TIMEOUT, UNTRACKABLE ou NONE (sem plano). */
  outcome: string;
  /** R realizado ate o TP1: WIN = R do TP1, LOSS = -1, o resto 0. */
  r: number;
  notes: string[];
  ms: number;
  costUsd: number;
  /** structureValidation da resposta (C1..C7) e o total do checklist. */
  checklist?: string;
  factors?: number | null;
  /** Cobertura dos candles com --real-data (injected, stale_withheld...). */
  coverage?: string | null;
  createdAt?: string;
  /** Estado e plano que o modelo deu, antes do validador (v10.1). */
  modelState?: string | null;
  watchPlan?: unknown;
  /** Do REAL DATA que entrou no prompt. */
  interval?: string | null;
  atr?: number | null;
  realPrice?: number | null;
  htfTrend?: string | null;
  htfVsEma50?: string | null;
  error?: string;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function classOf(symbol: string): Cls | null {
  if (normalizeToBinancePerp(symbol).isCrypto) return 'crypto';
  const pair = canonicalFxPair(symbol);
  if (!pair) return null;
  return pair.startsWith('XAU') || pair.startsWith('XAG') ? 'metal' : 'forex';
}

const num = (v: unknown): number | null => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** Estado da resposta; respostas sem `signalState` (prompt antigo) seguem a regra de leitura do historico. */
function stateOf(res: any): State {
  if (STATES.includes(res?.signalState)) return res.signalState;
  const rec = String(res?.recommendation || '');
  const type = String(res?.analysis?.entryType || '').toLowerCase();
  if (rec === 'BUY' || rec === 'SELL') return type === 'market' ? 'ENTER_NOW' : 'ARMED';
  return String(res?.analysis?.alternativeScenario || '').trim() ? 'WATCH' : 'NO_TRADE';
}

function planOf(res: any, state: State): Plan | null {
  const a = res?.analysis ?? {};
  if (state === 'ARMED' || state === 'ENTER_NOW') {
    const entry = num(a.entry); const stopLoss = num(a.stopLoss); const takeProfit1 = num(a.takeProfit1);
    if (entry == null || stopLoss == null || takeProfit1 == null) return null;
    return { side: res.recommendation === 'SELL' ? 'SELL' : 'BUY', entry, stopLoss, takeProfit1, takeProfit2: num(a.takeProfit2) };
  }
  // WATCH do v10.1 nao tem entrada nem stop: o replay-variants.ts simula o watchPlan.
  return null;
}

function loadCandles(file: string | null): Record<string, Candle[] | null> {
  return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

async function windowFor(row: InputRow, cls: Cls, cache: Record<string, Candle[] | null>, file: string | null): Promise<Candle[] | null> {
  if (row.id in cache) return cache[row.id];
  const start = createdAtMs(row);
  const { base } = normalizeToBinancePerp(row.symbol);
  let candles: Candle[] | null;
  if (cls === 'crypto' && base) {
    candles = await fetchCryptoWindow(base, start, start + WINDOW_MS);
  } else if (experimentRefusesFx('prompt-replay')) {
    // Sem a chave de experimento nao ha busca: fica sem medicao do sweeper.
    return null;
  } else {
    // Twelve Data gratis: 8 creditos por minuto.
    await new Promise((r) => setTimeout(r, 8_000));
    candles = await fetchFxWindow(row.symbol, start, start + WINDOW_MS);
  }
  cache[row.id] = candles;
  if (file) fs.writeFileSync(file, JSON.stringify(cache));
  return candles;
}

// ── Candles da epoca (--real-data) ──────────────────────────────────────────
type Gab = { s: string; tf: string; p: number };
function loadGabarito(file: string): Map<string, Gab> {
  return new Map(fs.readFileSync(file, 'utf8').trim().split(';').map((r) => {
    const [k, s, tf, p] = r.split(',');
    return [k, { s, tf: tf.toLowerCase(), p: Number(p) }] as const;
  }));
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'tickrify/1.0' }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** 120 candles do tempo grafico terminando em `endMs`, no formato do adapter ([ts,o,h,l,c,v]). */
async function historicalCrypto(base: string, interval: string, endMs: number): Promise<number[][] | null> {
  const bin = await getJson<Array<Array<string | number>>>(
    `https://api.binance.com/api/v3/klines?symbol=${base}USDT&interval=${interval}&endTime=${endMs}&limit=120`,
  );
  if (Array.isArray(bin) && bin.length >= 30) {
    return bin.map((r) => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[5])]);
  }
  const bar: Record<string, string> = { '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '1d': '1D', '1w': '1W' };
  const okx = await getJson<{ data?: string[][] }>(
    `https://www.okx.com/api/v5/market/history-candles?instId=${base}-USDT&bar=${bar[interval] ?? interval}&after=${endMs + 1}&limit=100`,
  );
  const rows = okx?.data;
  if (!Array.isArray(rows) || rows.length < 30) return null;
  return rows.map((r) => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[5])]).reverse();
}

// Twelve Data gratis: 8 creditos por minuto. Fila unica: o tempo grafico e o 4h
// sao pedidos em paralelo e, com uma espera por chamada, saiam juntos (~15/min).
let twelveDataQueue: Promise<void> = Promise.resolve();
const twelveDataSlot = (): Promise<void> => (twelveDataQueue = twelveDataQueue.then(() => new Promise((r) => setTimeout(r, 8_000))));

async function historicalFx(symbol: string, interval: string, endMs: number): Promise<number[][] | null> {
  const itv: Record<string, string> = {
    '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1day',
  };
  const pair = canonicalFxPair(symbol);
  const step = TIMEFRAME_MS[interval];
  if (!pair || !itv[interval] || !step) return null;
  await twelveDataSlot();
  const res = await twelveDataTimeSeries({
    consumer: 'analysis', pair, interval: itv[interval], outputsize: 120, window: { startMs: endMs - 200 * step, endMs },
  });
  if (!res.ok || res.series.values.length < 30) return null;
  return res.series.values
    .map((v) => [twelveDataOpenMs(v.datetime), Number(v.open), Number(v.high), Number(v.low), Number(v.close), 0])
    .reverse();
}

/**
 * Liga o grounding do quick ao print atual com candles da epoca: o adapter
 * roda o `buildCandleBlocks` de producao, so troca a fonte dos candles e o
 * simbolo lido. Devolve a funcao que aponta o adapter para um print.
 */
function wireHistoricalGrounding(adapter: any, gabarito: Map<string, Gab>, cacheFile: string) {
  const cache: Record<string, number[][] | null> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  let current: { row: InputRow; endMs: number; gab: Gab | null } | null = null;
  const cached = async (key: string, load: () => Promise<number[][] | null>) => {
    if (!(key in cache)) {
      cache[key] = await load();
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    }
    return cache[key];
  };
  adapter.extractSymbol = async () =>
    current?.gab ? { symbol: current.gab.s, timeframe: current.gab.tf, lastPrice: current.gab.p } : null;
  // As velas da epoca no lugar do armazem (mesmas chaves de cache de antes).
  adapter.fetchCandles = async (symbol: string, interval: string) => {
    const { isCrypto, base } = normalizeToBinancePerp(symbol);
    const candles = isCrypto && base
      ? await cached(`${current!.row.id}:c:${base}:${interval}`, () => historicalCrypto(base, interval, current!.endMs))
      : await cached(`${current!.row.id}:f:${symbol}:${interval}`, () => historicalFx(symbol, interval, current!.endMs));
    return { candles, source: 'replay', denied: null };
  };
  adapter.buildCryptoEnrichment = async () => null;
  adapter.buildFxEnrichment = async () => null;
  // Forex/metal com as velas da epoca no cache nao precisa de chave; cache vazio
  // busca pelo medidor em modo experimento (sem a chave de experimento, nada sai).
  adapter.fxSourceConfigured = () => true;
  // Velas fechadas e gatilho contados na hora do print, nao agora.
  adapter.nowMs = () => current!.endMs;
  return (row: InputRow) => {
    current = { row, endMs: createdAtMs(row), gab: gabarito.get(row.id.slice(-8)) ?? null };
    return current.gab;
  };
}

function createdAtMs(row: InputRow): number {
  // O Supabase exporta "2026-10-01 10:00:00.123" sem fuso; a coluna e UTC.
  const raw = row.createdAt.trim().replace(' ', 'T');
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(raw) ? raw : `${raw}Z`);
}

function measure(plan: Plan | null, window: Candle[] | null, symbol: string): { outcome: string; r: number } {
  if (!plan) return { outcome: 'NONE', r: 0 };
  if (!window) return { outcome: 'UNTRACKABLE', r: 0 };
  const { outcome } = evaluateTrade(
    { recommendation: plan.side, symbol, entry: plan.entry, stopLoss: plan.stopLoss, takeProfit1: plan.takeProfit1, takeProfit2: plan.takeProfit2 },
    window,
    FILL_CANDLE_RULE,
  );
  const rTp1 = Math.abs(plan.takeProfit1 - plan.entry) / Math.abs(plan.entry - plan.stopLoss);
  return { outcome, r: outcome === 'WIN' ? rTp1 : outcome === 'LOSS' ? -1 : 0 };
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const isSignal = (d: Done) => d.state === 'ARMED' || d.state === 'ENTER_NOW';
const isDecided = (d: Done) => d.outcome === 'WIN' || d.outcome === 'LOSS';
const sumR = (xs: Done[]) => xs.reduce((s, d) => s + d.r, 0);
const perR = (xs: Done[]) => (xs.length ? (sumR(xs) / xs.length).toFixed(3) : '-');

function summarize(rows: Done[]): void {
  for (const arm of [...new Set(rows.map((d) => d.arm))]) {
    const all = rows.filter((d) => d.arm === arm);
    const ok = all.filter((d) => !d.error);
    const signals = ok.filter(isSignal);
    const tracked = signals.filter((d) => d.outcome !== 'UNTRACKABLE' && d.outcome !== 'NONE');
    const decided = signals.filter(isDecided);
    const armed = tracked.filter((d) => d.state === 'ARMED');
    const dist = signals
      .filter((d) => d.plan && d.currentPrice)
      .map((d) => Math.abs((d.plan as Plan).entry - (d.currentPrice as number)) / Math.abs((d.plan as Plan).entry - (d.plan as Plan).stopLoss));
    console.log(`\n=== ${arm}: n=${ok.length} (erros ${all.length - ok.length}), custo US$ ${all.reduce((s, d) => s + d.costUsd, 0).toFixed(3)}`);
    console.log(`estados: ${STATES.map((s) => `${s} ${ok.filter((d) => d.state === s).length} (${pct(ok.filter((d) => d.state === s).length, ok.length)})`).join(' | ')}`);
    console.log(`expectancy por analise (WATCH/NO_TRADE = 0): ${ok.length ? (sumR(signals) / ok.length).toFixed(3) : '-'}R`);
    console.log(`expectancy por sinal medido (NO_FILL/TIMEOUT = 0): ${perR(tracked)}R (n=${tracked.length}); por sinal decidido: ${perR(decided)}R (n=${decided.length})`);
    console.log(`acerto do TP1: ${pct(decided.filter((d) => d.outcome === 'WIN').length, decided.length)} (WIN ${decided.filter((d) => d.outcome === 'WIN').length} / LOSS ${decided.filter((d) => d.outcome === 'LOSS').length}); NO_FILL ${tracked.filter((d) => d.outcome === 'NO_FILL').length}, TIMEOUT ${tracked.filter((d) => d.outcome === 'TIMEOUT').length}, sem candles ${signals.filter((d) => d.outcome === 'UNTRACKABLE').length}`);
    console.log(`ARMED preenchidas em 48h (96 velas de 30m): ${pct(armed.filter((d) => d.outcome !== 'NO_FILL').length, armed.length)} (n=${armed.length})`);
    console.log(`distancia entrada-preco nos sinais (em R de stop): media ${dist.length ? (dist.reduce((s, x) => s + x, 0) / dist.length).toFixed(2) : '-'}, mediana ${quantile(dist, 0.5).toFixed(2)}`);
    for (const [label, lo, hi] of [['<50', 0, 50], ['50-59', 50, 60], ['60-69', 60, 70], ['70+', 70, 101]] as const) {
      const band = decided.filter((d) => d.confidence != null && d.confidence >= lo && d.confidence < hi);
      if (band.length) console.log(`  confianca ${label}: acerto ${pct(band.filter((d) => d.outcome === 'WIN').length, band.length)} (n=${band.length})`);
    }
    for (const cls of ['crypto', 'metal', 'forex'] as Cls[]) {
      const c = ok.filter((d) => d.cls === cls);
      if (!c.length) continue;
      const cs = c.filter(isSignal);
      console.log(`  ${cls}: n=${c.length}, sinais ${cs.length}, decididos ${cs.filter(isDecided).length}, ${perR(cs.filter(isDecided))}R por decidido, ${(sumR(cs) / c.length).toFixed(3)}R por analise`);
    }
    const reasons = new Map<string, number>();
    for (const d of ok) for (const n of d.notes) reasons.set(n, (reasons.get(n) ?? 0) + 1);
    console.log(`rebaixamentos do validador: ${ok.filter((d) => d.notes.length).length} analises; motivos: ${[...reasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'nenhum'}`);
    const withChecklist = ok.filter((d) => d.checklist);
    if (withChecklist.length) {
      const items = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((code) => {
        const verdicts = withChecklist
          .map((d) => d.checklist!.match(new RegExp(`\\b${code}\\b[^;|\\n]{0,30}?\\b(PASS|FAIL)\\b`, 'i'))?.[1]?.toUpperCase())
          .filter(Boolean);
        return `${code} ${pct(verdicts.filter((v) => v === 'PASS').length, verdicts.length)}`;
      });
      console.log(`PASS por item do checklist (n=${withChecklist.length}): ${items.join(' | ')}`);
      const byCount = new Map<number, number>();
      for (const d of withChecklist) if (d.factors != null) byCount.set(d.factors, (byCount.get(d.factors) ?? 0) + 1);
      console.log(`total de PASS: ${[...byCount].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}/7 ${v}`).join(', ')}`);
    }
    const cov = new Map<string, number>();
    for (const d of ok) if (d.coverage) cov.set(d.coverage, (cov.get(d.coverage) ?? 0) + 1);
    if (cov.size) console.log(`cobertura do REAL DATA: ${[...cov].map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const ms = ok.map((d) => d.ms);
    console.log(`latencia: p50 ${(quantile(ms, 0.5) / 1000).toFixed(1)} s, p95 ${(quantile(ms, 0.95) / 1000).toFixed(1)} s`);
  }
}

async function main() {
  // Script de medicao: so a chave TWELVE_DATA_API_KEY_EXPERIMENTS, nunca a de producao.
  enterTwelveDataExperimentMode();
  const outs = (arg('--out') || '').split(',').filter(Boolean);
  if (process.argv.includes('--summary')) {
    summarize(outs.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    return;
  }
  const input = arg('--input');
  const arm = arg('--arm');
  const out = outs[0];
  if (!input || !arm || !out) throw new Error('Passe --input, --arm e --out');
  const budget = Number(arg('--budget') ?? 1.5);
  const candlesFile = arg('--candles');
  const rows = (JSON.parse(fs.readFileSync(input, 'utf8')) as InputRow[]).filter((r) => r.id && r.imageUrl && r.createdAt);
  const cases = rows.map((r) => ({ row: r, cls: classOf(r.symbol) })).filter((c): c is { row: InputRow; cls: Cls } => c.cls !== null)
    // Forex/metal sem a chave de experimento so com --history: as velas da epoca
    // vem do cache e nenhuma busca usa a chave de producao (o medidor so le a de experimento).
    .filter((c) => c.cls === 'crypto' || !!arg('--history') || !experimentRefusesFx('prompt-replay'));
  const done: Done[] = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const doneIds = new Set(done.filter((d) => !d.error).map((d) => d.id));
  const todo = cases.filter((c) => !doneIds.has(c.row.id));
  console.log(`Casos mediveis: ${cases.length} de ${rows.length}. A fazer: ${todo.length}. Teto: US$ ${budget}.`);
  const adapter: any = new AIAdapter();
  adapter.groundingEnabled = process.argv.includes('--real-data');
  const gabaritoFile = arg('--real-data');
  const historyFile = arg('--history');
  if (gabaritoFile && !historyFile) throw new Error('--real-data exige --history <cache.json>');
  const pointTo = gabaritoFile ? wireHistoricalGrounding(adapter, loadGabarito(gabaritoFile), historyFile as string) : null;
  if (!process.argv.includes('--execute')) {
    if (pointTo) {
      // Sem IA: busca os candles da epoca e conta quantos prints recebem o REAL DATA.
      const coverage = new Map<string, number>();
      for (const t of todo) {
        const gab = pointTo(t.row);
        const c = gab
          ? (await adapter.buildCandleBlocks({ symbol: gab.s, timeframe: gab.tf, lastPrice: gab.p })).candleCoverage
          : 'sem_gabarito';
        coverage.set(c, (coverage.get(c) ?? 0) + 1);
        process.stdout.write('.');
      }
      console.log(`\nCobertura do REAL DATA: ${[...coverage].map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
    console.log('Dry-run. Para rodar de verdade, repita com --execute.');
    return;
  }

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  // --variant A|B|C (16/11/2026): o braco usa essa variante do prompt do codigo.
  const variant = arg('--variant');
  if (variant && !['A', 'B', 'C', 'D'].includes(variant)) throw new Error('--variant aceita A, B, C ou D');
  const prompt = buildAnalysisPrompt({ userLanguage: 'en', analysisType: 'quick' }, (variant ?? 'A') as 'A' | 'B' | 'C' | 'D');
  let spent = done.reduce((s, d) => s + (d.costUsd || 0), 0);
  let callCost = 0;
  // Custo real de cada chamada (inclui a nova tentativa do adapter), para o teto.
  const model = adapter.visionModel;
  const complete = model.complete.bind(model);
  model.complete = async (req: unknown) => {
    const result = await complete(req);
    callCost += computeCost(result.model, result.usage, 0).costUsd ?? 0;
    return result;
  };
  const candles = loadCandles(candlesFile);
  let i = 0;
  for (const t of todo) {
    if (spent >= budget) {
      console.log(`Teto de US$ ${budget} atingido (US$ ${spent.toFixed(3)}). Parando.`);
      break;
    }
    i += 1;
    callCost = 0;
    const t0 = Date.now();
    let record: Done;
    try {
      pointTo?.(t.row);
      const res: any = await adapter.analyzeImage(t.row.imageUrl, prompt, 'quick');
      const ms = Date.now() - t0;
      const state = stateOf(res);
      const plan = planOf(res, state);
      const window = plan ? await windowFor(t.row, t.cls, candles, candlesFile) : null;
      const notes: unknown[] = res.engineMeta?.validatorReasons ?? [];
      const raw = (() => { try { return JSON.parse(String(res.rawContent ?? '')); } catch { return {}; } })();
      const numbers = res.groundingStats?.coverage === 'injected' ? res.groundingStats.numbers : null;
      record = {
        id: t.row.id, arm, symbol: t.row.symbol, cls: t.cls, state, recommendation: String(res.recommendation),
        confidence: Number.isFinite(Number(res.confidence)) ? Number(res.confidence) : null,
        currentPrice: num(res.analysis?.currentPrice), plan, ...measure(plan, window, t.row.symbol),
        notes: notes.map(String), ms, costUsd: callCost,
        checklist: String(res.analysis?.structureValidation ?? ''),
        factors: Number.isFinite(Number(res.analysis?.factorsPresent)) ? Number(res.analysis.factorsPresent) : null,
        coverage: res.groundingStats?.coverage ?? null,
        createdAt: t.row.createdAt,
        modelState: typeof raw.signalState === 'string' ? raw.signalState : null,
        watchPlan: raw.watchPlan ?? null,
        interval: res.groundingStats?.interval ?? null,
        atr: numbers?.atr14 ?? null,
        realPrice: numbers?.lastClose ?? null,
        htfTrend: numbers?.htfTrend ?? null,
        htfVsEma50: numbers?.htfVsEma50 ?? null,
      };
    } catch (err) {
      record = {
        id: t.row.id, arm, symbol: t.row.symbol, cls: t.cls, state: 'ERROR', recommendation: 'ERROR', confidence: null,
        currentPrice: null, plan: null, outcome: 'ERROR', r: 0, notes: [], ms: Date.now() - t0, costUsd: callCost,
        error: err instanceof Error ? err.message.slice(0, 200) : 'erro',
      };
    }
    spent += record.costUsd;
    fs.appendFileSync(out, `${JSON.stringify(record)}\n`);
    done.push(record);
    console.log(`[${i}/${todo.length}] ${t.row.symbol} -> ${record.state} ${record.outcome} US$ ${spent.toFixed(3)}${record.error ? ` (${record.error})` : ''}`);
  }
  summarize(done);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
