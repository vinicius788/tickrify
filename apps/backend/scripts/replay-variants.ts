#!/usr/bin/env ts-node
/**
 * Medicao offline do validador do v11 SEM chamar a IA (02/11/2026). Le as
 * respostas gravadas pelo prompt-replay.ts (estado, checklist e watchPlan do
 * modelo; ATR, preco e 4h do REAL DATA), refaz as velas fechadas antes do print
 * (--history: swings fractais e maturidade) e decide o estado pelo MESMO
 * decideSignal da producao. Depois mede com a regua do rastreador (trackPlan):
 * ENTER_NOW a mercado na primeira vela fina depois do print (a configuracao de
 * producao; o ARMED nao e mais emitido)
 * TP1 x stop em 48h depois da execucao
 * (stop_only), spread tipico do ativo descontado em R.
 *
 * Referencia: a direcao do plano a mercado no print, stop e alvo de 1 ATR,
 * com o mesmo spread.
 *
 * --runs, --gabarito, --after e --history aceitam varios arquivos separados
 * por virgula; a mesma analise num arquivo seguinte substitui a anterior. Velas
 * que faltarem vao para o ULTIMO --after (cripto gratis; forex/metal so com a
 * chave TWELVE_DATA_API_KEY_EXPERIMENTS).
 *
 * --calibrate --cache <velas.json> --out src/common/utils/engine-calibration.ts
 * (02/11/2026, so dados, sem IA): gera a tabela de alcance e a margem P80 do
 * stop por par e regime de volatilidade, calibradas nos 70% mais antigos de
 * cada serie e validadas nos 30% mais recentes. Cripto pela Binance; ouro e
 * forex pelo Twelve Data com a chave de PRODUCAO (decisao do dono) e o MESMO
 * medidor de producao (Redis, pelo REDIS_URL): so pede com o total do dia
 * abaixo de 550 (sobram 250 para os usuarios), 1 pedido a cada 15 s. O cache
 * guarda cada serie: retomar nao repete pedido.
 *
 * --review [--since AAAA-MM-DD] (02/11/2026): a revisao mensal do motor. Le o
 * rastreador de producao ("AnalysisTrack", SO LEITURA, pelo DATABASE_URL) e
 * reporta, por estado, classe de ativo, compra/venda e versao do motor: n,
 * acerto do TP1 (Wilson), R liquido (bootstrap, spread descontado) e a
 * referencia de direcao; depois aplica as REVIEW_RULES ao ENTER_NOW da versao
 * atual. So reporta: nunca muda nada sozinho.
 *
 * Uso (em apps/backend):
 *   pnpm exec ts-node scripts/replay-variants.ts --runs <A.jsonl>,<B.jsonl> --gabarito <A.txt>,<B.txt> --after <velas.json> --history <historico.json>
 */
import 'dotenv/config';
import * as fs from 'fs';
import { canonicalFxPair } from '../src/common/utils/analysis-normalizer';
import { spreadOf, trackedTradeR } from '../src/modules/ai/accuracy.util';
import { normalizeToBinancePerp } from '../src/modules/market/market.service';
import {
  enterTwelveDataCalibrationMode,
  enterTwelveDataExperimentMode,
  experimentRefusesFx,
  TWELVE_DATA_BUDGET,
  twelveDataOpenMs,
  twelveDataTimeSeries,
  twelveDataUsage,
} from '../src/modules/market/twelve-data';
import { TIMEFRAME_MS, fetchWindow } from '../src/modules/market/candle-store';
import { PrismaClient } from '@prisma/client';
import { calibrationPair, decideSignal, type SignalDecisionResult, type SignalState } from '../src/common/utils/signal-decision';
import { ENGINE_VERSION } from '../src/modules/ai/engine-contract';
import { ENGINE_REPORT_SINCE, isFilledWatch, reviewDecision } from '../src/modules/admin/engine-report';
import {
  ENGINE_RULES,
  atr14Series,
  clampValidity,
  closedBars,
  fractalSwings,
  isValidWatchPlan,
  moveIsLate,
  resolveTp1,
  stopMarginAtr,
  trackPlan,
  volatilityRegime,
  type Bar,
  type VolRegime,
  type WatchPlan,
} from '../src/common/utils/plan-engine';

const H = 3_600_000;
const RESOLVE_MS = 48 * H;
/** Criterio de aprovacao do v11 (fixado pelo dono em 02/11, antes de ver o resultado). */
const CRITERION = { minTrades: 15, minMeanR: -0.05, maxBelowReference: 0.1, minActionable: 0.15, maxActionable: 0.45 } as const;
const FINE_MAX_MINUTES = 5000;

interface Row {
  id: string;
  symbol: string;
  cls: 'crypto' | 'metal' | 'forex';
  state: string;
  modelState?: string | null;
  currentPrice?: number | null;
  watchPlan?: any;
  checklist?: string;
  createdAt?: string;
  interval?: string | null;
  atr?: number | null;
  realPrice?: number | null;
  htfTrend?: 'uptrend' | 'downtrend' | 'range' | null;
  error?: string;
}
type Gab = { s: string; tf: string; p: number };
type Window = { tf: Bar[]; fine: Bar[]; fineStep: number } | null;
/** Velas em cache de varios arquivos; o que for buscado agora vai so para o ultimo. */
interface CandleStore { all: Record<string, Window>; own: Record<string, Window>; file: string }

function loadStore(files: string): CandleStore {
  const list = files.split(',');
  const read = (f: string): Record<string, Window> => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
  const own = read(list[list.length - 1]);
  const all: Record<string, Window> = Object.assign({}, ...list.slice(0, -1).map(read), own);
  return { all, own, file: list[list.length - 1] };
}

function remember(store: CandleStore, key: string, w: Window): Window {
  store.all[key] = w;
  store.own[key] = w;
  fs.writeFileSync(store.file, JSON.stringify(store.own));
  return w;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const createdAtMs = (raw: string) => {
  const s = raw.trim().replace(' ', 'T');
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
};

/**
 * Janela de velas pelo armazem (fetchWindow), a mesma do rastreador. Forex/metal
 * so em modo experimento (chave TWELVE_DATA_API_KEY_EXPERIMENTS), 8 por minuto.
 */
async function bars(row: Row, gab: Gab, interval: string, fromMs: number, toMs: number): Promise<Bar[] | null> {
  if (row.cls !== 'crypto' && experimentRefusesFx('replay-variants')) return null;
  return (await fetchWindow(gab.s, interval, fromMs, toMs, 'sweeper', row.cls === 'crypto' ? 0 : 8_000)).candles;
}

/** Velas do tempo grafico agregadas das velas de 1m (alinhadas ao passo, como as da corretora em UTC). */
function aggregate(fine: Bar[], step: number): Bar[] {
  const out: number[][] = [];
  for (const b of fine) {
    const t = Math.floor(b[0] / step) * step;
    const last = out[out.length - 1];
    if (last && last[0] === t) {
      last[2] = Math.max(last[2], b[2]);
      last[3] = Math.min(last[3], b[3]);
      last[4] = b[4];
    } else out.push([t, b[1], b[2], b[3], b[4]]);
  }
  return out;
}

/**
 * Velas do tempo grafico depois do print e velas finas ate 48h depois da
 * ultima execucao possivel. Sem a janela do plano em cache, serve a de 1m de
 * 96h da medicao anterior (`<id>:m1`), com o tempo grafico agregado dela.
 */
async function windowFor(row: Row, gab: Gab, interval: string, store: CandleStore): Promise<Window> {
  if (store.all[row.id]) return store.all[row.id];
  const m1 = store.all[`${row.id}:m1`];
  if (m1 && m1.fine.length) return { tf: aggregate(m1.fine, TIMEFRAME_MS[interval]), fine: m1.fine, fineStep: TIMEFRAME_MS['1m'] };
  if (row.id in store.all) return store.all[row.id];
  const step = TIMEFRAME_MS[interval];
  const print = createdAtMs(row.createdAt!);
  const span = (ENGINE_RULES.validMaxCandles + 2) * step + RESOLVE_MS;
  // Fim de semana do forex: folga de 3 dias nas velas do tempo grafico.
  const tfEnd = print + span + (row.cls === 'crypto' ? 0 : 72 * H);
  const fineInterval = span / 60_000 <= FINE_MAX_MINUTES || row.cls === 'crypto' ? '1m' : '5m';
  const tf = await bars(row, gab, interval, print - step, tfEnd);
  const fine = tf ? await bars(row, gab, fineInterval, print - step, tfEnd) : null;
  return remember(store, row.id, tf && fine ? { tf, fine, fineStep: TIMEFRAME_MS[fineInterval] } : null);
}

// ── Simulacao ───────────────────────────────────────────────────────────────
interface Trade {
  long: boolean;
  outcome: 'WIN' | 'LOSS' | 'TIMEOUT';
  /** R liquido: WIN = R do TP1 a partir do preco executado, LOSS = -1, TIMEOUT = 0; menos o spread em R. */
  r: number;
}
interface Ctx { row: Row; plan: WatchPlan; atr: number; price: number; step: number; print: number; w: NonNullable<Window>; history: Bar[] }

function netTrade(c: Ctx, long: boolean, fill: { price: number }, stop: number, tp1: number, outcome: Trade['outcome']): Trade {
  const risk = Math.abs(fill.price - stop);
  const gross = outcome === 'WIN' ? Math.abs(tp1 - fill.price) / risk : outcome === 'LOSS' ? -1 : 0;
  return { long, outcome, r: gross - spreadOf(c.row.symbol, fill.price) / risk };
}

/** O estado do v11 pelo decideSignal da producao, com o REAL DATA refeito das velas antes do print. */
async function decide(c: Ctx): Promise<SignalDecisionResult> {
  const model = (c.row.modelState ?? 'NO_TRADE') as SignalState;
  const signal = model === 'ARMED' || model === 'ENTER_NOW';
  const swings = fractalSwings(c.history).map(({ kind, price }) => ({ kind, price }));
  return decideSignal({
    state: model,
    recommendation: signal ? (c.plan.direction === 'long' ? 'BUY' : 'SELL') : 'WAIT',
    confidence: 50,
    trendStrength: null,
    structureValidation: c.row.checklist ?? '',
    symbol: c.row.symbol,
    currentPrice: c.row.currentPrice ?? null,
    watchPlan: c.plan,
    estimatedLevels: null,
    probabilities: { probabilityTp1: null, probabilityTp2: null, probabilityStop: null },
    realData: {
      price: c.price, atr: c.atr, htfTrend: c.row.htfTrend ?? null, swings,
      late: { long: moveIsLate(c.history, c.atr, 'long'), short: moveIsLate(c.history, c.atr, 'short') },
      volRegime: volatilityRegime(c.history),
      rangePosPct: null,
    },
  });
}

/** ENTER_NOW a mercado, pela regua do rastreador; null = nao executou. */
function simulate(c: Ctx, d: SignalDecisionResult): Trade | null {
  if (d.state !== 'ENTER_NOW') return null;
  const plan = d.watchPlan as WatchPlan;
  const t = trackPlan({
    plan, enterNow: d.state === 'ENTER_NOW', atr: c.atr, marginAtr: stopMarginAtr(calibrationPair(c.row.symbol), volatilityRegime(c.history)),
    levels: { entry: d.levels.entry as number, stopLoss: d.levels.stopLoss as number, takeProfit1: d.levels.takeProfit1 as number },
    tf: c.w.tf, tfStepMs: c.step, fine: c.w.fine, startMs: c.print, resolveMs: RESOLVE_MS,
  });
  if (!t.fill || !t.levels || !t.resolution) return null;
  return netTrade(c, plan.direction === 'long', t.fill, t.levels.stopLoss, t.levels.takeProfit1, t.resolution.outcome);
}

/** Referencia: a direcao do plano a mercado no print, stop e alvo de 1 ATR. */
function reference(c: Ctx): Trade | null {
  const i = c.w.fine.findIndex((b) => b[0] >= c.print);
  if (i < 0) return null;
  const long = c.plan.direction === 'long';
  const fill = { index: i, price: c.w.fine[i][1] };
  const stop = long ? fill.price - c.atr : fill.price + c.atr;
  const tp1 = long ? fill.price + c.atr : fill.price - c.atr;
  return netTrade(c, long, fill, stop, tp1, resolveTp1(c.w.fine, long, fill, stop, tp1, c.w.fine[i][0] + RESOLVE_MS).outcome);
}

// ── Estatistica ─────────────────────────────────────────────────────────────
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function bootstrapMean(xs: number[], times = 2000): [number, number] {
  if (!xs.length) return [0, 0];
  const means: number[] = [];
  for (let t = 0; t < times; t++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rand() * xs.length)];
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * times)], means[Math.floor(0.975 * times)]];
}

const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const signed = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(2)}R` : '-');

function count(xs: string[]): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
}

/** Linha da tabela: planos, executados, acerto do TP1 (decididos), R liquido medio (TIMEOUT = 0R menos spread), TIMEOUT. */
function line(name: string, plans: number, trades: Trade[]): string {
  const decided = trades.filter((t) => t.outcome !== 'TIMEOUT');
  const wins = decided.filter((t) => t.outcome === 'WIN').length;
  const [lo, hi] = wilson(wins, decided.length);
  const rs = trades.map((t) => t.r);
  const [blo, bhi] = bootstrapMean(rs);
  return `| ${name} | ${plans} | ${trades.length} | ${decided.length ? `${pct(wins / decided.length)} (${pct(lo)} a ${pct(hi)}), n=${decided.length}` : '-'} | ${
    rs.length ? `${signed(mean(rs))} (${blo.toFixed(2)} a ${bhi.toFixed(2)})` : '-'
  } | ${trades.length - decided.length} |`;
}

/** Distancia do preco real a invalidacao do modelo, em ATR (positiva = do lado certo). */
function distanceToInvalidation(ctxs: Ctx[]): string {
  const d = ctxs.map((c) => (c.plan.direction === 'long' ? c.price - c.plan.invalidation : c.plan.invalidation - c.price) / c.atr).sort((a, b) => a - b);
  const q = (p: number) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(2) : '-');
  return `preco real -> invalidacao do modelo (ATR, ${d.length} planos): p25 ${q(0.25)}, mediana ${q(0.5)}, p75 ${q(0.75)}, p90 ${q(0.9)}`;
}

async function measure(label: string, ctxs: Ctx[], analyses: number): Promise<void> {
  const decisions = await Promise.all(ctxs.map(async (c) => ({ c, d: await decide(c) })));
  const states = decisions.map((x) => x.d.state);
  const nonPlan = analyses - ctxs.length;
  const actionable = states.filter((s) => s === 'ENTER_NOW').length;
  console.log(`\n### ${label}`);
  console.log(`Estados (${analyses} analises com REAL DATA; ${nonPlan} sem plano do modelo ficam NO_TRADE): ` +
    `ENTER_NOW ${states.filter((s) => s === 'ENTER_NOW').length}, ` +
    `WATCH ${states.filter((s) => s === 'WATCH').length}, NO_TRADE ${states.filter((s) => s === 'NO_TRADE').length + nonPlan}. ` +
    `Acionaveis: ${actionable} (${pct(actionable / analyses)}).`);
  console.log(`Estado do modelo -> v11: ${count(decisions.map((x) => `${x.c.row.modelState}->${x.d.state}`))}.`);
  console.log(`Motivos do ultimo degrau: ${count(decisions.flatMap((x) => (x.d.validatorNotes.length ? [x.d.validatorNotes[x.d.validatorNotes.length - 1].reason] : [])))}.`);
  const barred = new Map<string, number>();
  for (const x of decisions) for (const reason of new Set(x.d.validatorNotes.filter((n) => n.reason !== 'market_entry_valid').map((n) => n.reason))) barred.set(reason, (barred.get(reason) ?? 0) + 1);
  console.log(`Planos barrados por regra (em qualquer degrau, % dos ${ctxs.length} planos): ${
    [...barred].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${pct(v / (ctxs.length || 1))})`).join(', ') || '-'}.`);

  const sims = decisions.map((x) => ({ ...x, t: simulate(x.c, x.d) }));
  const executed = (pick: (s: SignalState, long: boolean) => boolean) => {
    const of = sims.filter((x) => pick(x.d.state, x.c.plan.direction === 'long'));
    return { plans: of.length, trades: of.flatMap((x) => (x.t ? [x.t] : [])) };
  };
  const signal = (s: SignalState) => s === 'ENTER_NOW';
  const groups: [string, { plans: number; trades: Trade[] }][] = [
    ['ENTER_NOW', executed((s) => s === 'ENTER_NOW')],
    ['compras', executed((s, long) => signal(s) && long)],
    ['vendas', executed((s, long) => signal(s) && !long)],
  ];
  const refAll = ctxs.flatMap((c) => { const t = reference(c); return t ? [t] : []; });
  const refActionable = sims.filter((x) => signal(x.d.state)).flatMap((x) => { const t = reference(x.c); return t ? [t] : []; });
  console.log('\n| grupo | planos | executados | acerto TP1 (Wilson 95%) | R liquido medio (bootstrap 95%) | TIMEOUT |');
  console.log('|---|---|---|---|---|---|');
  for (const [name, g] of groups) console.log(line(name, g.plans, g.trades));
  console.log(line('referencia: direcao do plano a mercado, 1 ATR (todos os planos)', ctxs.length, refAll));
  console.log(line('referencia: a mesma, so nas acionaveis', actionable, refActionable));

  const both = groups[0][1].trades;
  const n = both.length;
  const r = mean(both.map((t) => t.r));
  const ref = mean(refAll.map((t) => t.r));
  const share = actionable / analyses;
  const C = CRITERION;
  const checks: [string, boolean][] = [
    [`n executados ${n} >= ${C.minTrades}`, n >= C.minTrades],
    [`R liquido medio ${signed(r)} >= ${signed(C.minMeanR)}`, Number.isFinite(r) && r >= C.minMeanR],
    [`${signed(r)} no maximo ${C.maxBelowReference}R abaixo da referencia ${signed(ref)}`, Number.isFinite(r) && r >= ref - C.maxBelowReference],
    [`acionaveis ${pct(share)} entre ${pct(C.minActionable)} e ${pct(C.maxActionable)}`, share >= C.minActionable && share <= C.maxActionable],
  ];
  for (const [text, ok] of checks) console.log(`- ${ok ? 'OK ' : 'NAO'} ${text}`);
  console.log(`Veredito pelo criterio: ${checks.every(([, ok]) => ok) ? 'APROVADO' : 'REPROVADO'}.`);
}

// ── Calibracao (--calibrate) ────────────────────────────────────────────────
/** Pares na ordem de uso em producao (ouro primeiro); cripto pela Binance, gratis. */
const CALIBRATION_PAIRS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT',
  'XAUUSD', 'EURUSD', 'USDJPY', 'GBPUSD', 'EURJPY', 'AUDJPY', 'GBPJPY', 'AUDUSD', 'USDCAD', 'XAGUSD',
];
const CALIBRATION_TFS = ['5m', '15m', '1h', '4h'];
const CALIBRATION_BARS = 5000;
const TD_INTERVAL: Record<string, string> = { '5m': '5min', '15m': '15min', '1h': '1h', '4h': '4h' };
const TRAIN_SHARE = 0.7;
const MARGIN_MIN_EVENTS = 30;
const SWING_LOOKAHEAD = 50;

interface CalibrationCache { series: Record<string, Bar[] | null> }

async function fetchCalibrationSeries(pair: string, tf: string, cache: CalibrationCache, file: string): Promise<Bar[] | null | 'budget'> {
  const key = `${pair}:${tf}`;
  if (key in cache.series) return cache.series[key];
  let bars: Bar[] | null;
  if (normalizeToBinancePerp(pair).isCrypto) {
    const now = Date.now();
    bars = (await fetchWindow(pair, tf, now - CALIBRATION_BARS * TIMEFRAME_MS[tf], now, 'sweeper')).candles;
  } else {
    const request = { consumer: 'calibration' as const, pair, interval: TD_INTERVAL[tf], outputsize: CALIBRATION_BARS, timeoutMs: 30_000 };
    await new Promise((r) => setTimeout(r, 15_000));
    let res = await twelveDataTimeSeries(request);
    if (!res.ok && res.reason === 'rate_limited') {
      await new Promise((r) => setTimeout(r, 60_000));
      res = await twelveDataTimeSeries(request);
    }
    if (!res.ok && res.reason !== 'error') {
      console.log(`\nTwelve Data recusou (${res.reason}): parando; o cache retoma daqui.`);
      return 'budget';
    }
    bars = res.ok
      ? res.series.values
        .map((v) => [twelveDataOpenMs(v.datetime), Number(v.open), Number(v.high), Number(v.low), Number(v.close), 0])
        .filter((b) => b.every((x) => Number.isFinite(x)))
        .sort((a, b) => a[0] - b[0])
      : null;
  }
  cache.series[key] = bars && bars.length > 200 ? bars : null;
  fs.writeFileSync(file, JSON.stringify(cache));
  return cache.series[key];
}

interface ReachCounts { hits: number[]; totals: number[] }
const reachCells = () => ENGINE_RULES.reachGrid.d.length * ENGINE_RULES.reachGrid.n.length * ENGINE_RULES.reachGrid.k.length;

/**
 * Para cada vela t (o "agora"): um nivel a d ATR abaixo (e, no espelho, acima)
 * e tocado em ate N velas antes de o preco andar k ATR para o outro lado? Vela
 * que toca os dois conta como nao tocado (o pior caso).
 */
function countReach(bars: Bar[], atr: number[], regimes: (VolRegime | null)[], from: number, to: number, into: (regime: VolRegime) => ReachCounts) {
  const g = ENGINE_RULES.reachGrid;
  const maxN = Math.max(...g.n);
  for (let t = from; t < Math.min(to, bars.length - maxN - 1); t++) {
    const regime = regimes[t];
    const a = atr[t];
    if (!regime || !(a > 0)) continue;
    const c = bars[t][4];
    const counts = into(regime);
    for (const below of [true, false]) {
      // Primeira vela que toca cada nivel e a primeira que anda k ATR contra.
      const touch = g.d.map((d) => { for (let j = 1; j <= maxN; j++) if (below ? bars[t + j][3] <= c - d * a : bars[t + j][2] >= c + d * a) return j; return Infinity; });
      const away = g.k.map((k) => { for (let j = 1; j <= maxN; j++) if (below ? bars[t + j][2] >= c + k * a : bars[t + j][3] <= c - k * a) return j; return Infinity; });
      g.d.forEach((_, di) => g.n.forEach((n, ni) => g.k.forEach((_, ki) => {
        const cell = (di * g.n.length + ni) * g.k.length + ki;
        counts.totals[cell]++;
        if (touch[di] <= n && touch[di] < away[ki]) counts.hits[cell]++;
      })));
    }
  }
}

/** Quanto o preco fura uma swing fractal e fecha de volta (em ATR), no regime da vela que fura. */
function swingPenetrations(bars: Bar[], atr: number[], regimes: (VolRegime | null)[], from: number, to: number): { regime: VolRegime; atr: number }[] {
  const out: { regime: VolRegime; atr: number }[] = [];
  for (const s of fractalSwings(bars)) {
    if (s.i < from || s.i >= to) continue;
    for (let j = s.i + 3; j < Math.min(bars.length, s.i + SWING_LOOKAHEAD); j++) {
      const [, , h, l, close] = bars[j];
      const pierced = s.kind === 'low' ? l < s.price : h > s.price;
      if (!pierced) continue;
      const back = s.kind === 'low' ? close > s.price : close < s.price;
      const regime = regimes[j];
      if (back && regime && atr[j] > 0) out.push({ regime, atr: (s.kind === 'low' ? s.price - l : h - s.price) / atr[j] });
      break;
    }
  }
  return out;
}

const percentile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];

async function calibrate(): Promise<void> {
  // Decisao do dono (02/11/2026): chave e medidor de producao, so com o dia abaixo de 550.
  enterTwelveDataCalibrationMode();
  const cacheFile = arg('--cache');
  const outFile = arg('--out');
  if (!cacheFile || !outFile) throw new Error('--calibrate exige --cache e --out');
  const cache: CalibrationCache = fs.existsSync(cacheFile) ? { series: JSON.parse(fs.readFileSync(cacheFile, 'utf8')).series } : { series: {} };
  const train = new Map<string, ReachCounts>();
  const valid = new Map<string, ReachCounts>();
  const marginsTrain = new Map<string, number[]>();
  const marginsValid = new Map<string, number[]>();
  const missing: string[] = [];
  const fresh = (): ReachCounts => ({ hits: Array(reachCells()).fill(0), totals: Array(reachCells()).fill(0) });
  const bucket = (map: Map<string, ReachCounts>, key: string) => { if (!map.has(key)) map.set(key, fresh()); return map.get(key)!; };
  let stopped = false;
  for (const symbol of CALIBRATION_PAIRS) {
    const pair = calibrationPair(symbol) as string;
    for (const tf of CALIBRATION_TFS) {
      const bars = stopped ? (cache.series[`${pair}:${tf}`] ?? null) : await fetchCalibrationSeries(pair, tf, cache, cacheFile);
      if (bars === 'budget') { stopped = true; missing.push(`${pair}:${tf}`); continue; }
      if (!bars) { missing.push(`${pair}:${tf}`); continue; }
      process.stdout.write('.');
      const atr = atr14Series(bars);
      const regimes = bars.map((_, i) => volatilityRegime(bars, atr, i));
      const cut = Math.floor(bars.length * TRAIN_SHARE);
      countReach(bars, atr, regimes, 0, cut, (r) => bucket(train, `${pair}:${r}`));
      countReach(bars, atr, regimes, cut, bars.length, (r) => bucket(valid, `${pair}:${r}`));
      for (const [from, to, map] of [[0, cut, marginsTrain], [cut, bars.length, marginsValid]] as const) {
        for (const p of swingPenetrations(bars, atr, regimes, from, to)) {
          const key = `${pair}:${p.regime}`;
          map.set(key, [...(map.get(key) ?? []), p.atr]);
        }
      }
    }
  }
  console.log('\n');
  const reach: Record<string, (number | null)[]> = {};
  const margin: Record<string, number> = {};
  const lines: string[][] = [];
  for (const key of [...new Set([...train.keys(), ...marginsTrain.keys()])].sort()) {
    const tr = train.get(key);
    const va = valid.get(key);
    let errSum = 0;
    let errN = 0;
    if (tr) {
      reach[key] = tr.totals.map((t, i) => (t >= ENGINE_RULES.reachMinSamples ? Number((tr.hits[i] / t).toFixed(3)) : null));
      reach[key].forEach((p, i) => {
        if (p !== null && va && va.totals[i] >= ENGINE_RULES.reachMinSamples / 2) { errSum += Math.abs(p - va.hits[i] / va.totals[i]); errN++; }
      });
    }
    const mt = marginsTrain.get(key) ?? [];
    const mv = marginsValid.get(key) ?? [];
    const p80 = mt.length >= MARGIN_MIN_EVENTS ? Number(percentile(mt, 0.8).toFixed(3)) : null;
    if (p80 !== null) margin[key] = p80;
    const covered = p80 !== null && mv.length ? mv.filter((x) => x <= p80).length / mv.length : NaN;
    lines.push([key, String(tr ? reach[key].filter((x) => x !== null).length : 0), errN ? `${(100 * errSum / errN).toFixed(1)} pp (${errN} celulas)` : '-',
      String(mt.length), p80 === null ? '-' : p80.toFixed(3), Number.isFinite(covered) ? `${pct(covered)} (n=${mv.length})` : '-']);
  }
  console.log('| par:regime | celulas com amostra | erro medio na validacao (30% recentes) | furos de swing (treino) | margem P80 (ATR) | furos da validacao dentro da P80 |');
  console.log('|---|---|---|---|---|---|');
  for (const l of lines) console.log(`| ${l.join(' | ')} |`);
  const usage = await twelveDataUsage();
  console.log(`\nTwelve Data hoje (medidor de producao): ${usage.total}/${TWELVE_DATA_BUDGET.dailyLimit}, calibracao ${usage.calibration}. Faltando: ${missing.join(', ') || 'nada'}.`);
  const header = fs.readFileSync(outFile, 'utf8').split('export const CALIBRATED_AT')[0];
  const json = (o: unknown) => JSON.stringify(o, null, 2).replace(/"([A-Z0-9]+:[a-z]+)":/g, "'$1':");
  fs.writeFileSync(outFile, `${header}export const CALIBRATED_AT: string | null = '${new Date().toISOString().slice(0, 10)}';\n\n` +
    `export const STOP_MARGIN_P80: Readonly<Record<string, number>> = ${json(margin)};\n\n` +
    `export const REACH_TABLE: Readonly<Record<string, readonly (number | null)[]>> = {\n${
      Object.entries(reach).map(([k, v]) => `  '${k}': [${v.map((x) => (x === null ? 'null' : String(x))).join(', ')}],`).join('\n')}\n};\n`);
  console.log(`Gravado em ${outFile}.`);
}

// ── Revisao mensal (--review) ───────────────────────────────────────────────
/**
 * Regras da revisao mensal, fixadas pelo dono em 02/11/2026 (reviewDecision,
 * engine-report.ts), para o ENTER_NOW da versao atual do motor e, desde
 * 09/11/2026, tambem para o WATCH que tocou o nivel e foi preenchido, em
 * series separadas:
 *   n >= 30 e R liquido >= -0,05R: mantem.
 *   n >= 30 e R liquido <= -0,15R: desligar. E decisao do dono; o script so aponta.
 *   resto: mantem e espera mais dados.
 * Ouro e forex antes da correcao do fuso do Twelve Data ficam fora sozinhos.
 */

interface TrackRecord {
  createdAt: Date;
  touched: boolean;
  filled: boolean;
  signalState: string;
  engineVersion: string | null;
  symbol: string | null;
  direction: string | null;
  outcome: string | null;
  fillPrice: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  atr: number | null;
  refOutcome: string | null;
  refFillPrice: number | null;
  snapFallback: boolean | null;
  entryWarned: boolean | null;
  lateWarned: boolean | null;
  permissiveEntry: boolean | null;
}

/** Ouro e forex antes da correcao do fuso: entrada do motor sem swings, nao servem para julgar. */
const isBeforeFxFix = (r: TrackRecord) => ['metal', 'forex'].includes(classOfSymbol(r.symbol ?? '')) && new Date(r.createdAt) < new Date(ENGINE_REPORT_SINCE);

function classOfSymbol(symbol: string): string {
  if (normalizeToBinancePerp(symbol).isCrypto) return 'cripto';
  const fx = canonicalFxPair(symbol);
  if (!fx) return 'outros';
  return fx.startsWith('XAU') || fx.startsWith('XAG') ? 'metal' : 'forex';
}

/** Trade executado do rastreador, com o spread descontado em R (a mesma regra da /accuracy); null sem fill decidido. */
function reviewTrade(r: TrackRecord): Trade | null {
  const t = trackedTradeR(r);
  return t ? { long: r.direction === 'long', outcome: t.outcome, r: t.r } : null;
}

/** Referencia de direcao (a mercado na analise, 1 ATR): +1, -1 ou 0, menos o spread em R. */
function reviewReference(r: TrackRecord): Trade | null {
  if (!r.symbol || !r.refOutcome || !r.refFillPrice || !r.atr) return null;
  const outcome = r.refOutcome as Trade['outcome'];
  const gross = outcome === 'WIN' ? 1 : outcome === 'LOSS' ? -1 : 0;
  return { long: r.direction === 'long', outcome, r: gross - spreadOf(r.symbol, r.refFillPrice) / r.atr };
}

async function review(): Promise<void> {
  const since = arg('--since');
  const prisma = new PrismaClient();
  try {
    const all = await prisma.$queryRawUnsafe<TrackRecord[]>(
      `SELECT a."createdAt", t."touched", t."filled", t."signalState", t."engineVersion", t."symbol", t."direction", t."outcome",
              t."fillPrice", t."stopLoss", t."takeProfit1", t."atr", t."refOutcome", t."refFillPrice",
              (a."result"->>'snapFallback') = 'true' AS "snapFallback", (a."result"->'entryWarnings' @> '[2]'::jsonb OR a."result"->'entryWarnings' @> '[7]'::jsonb) AS "entryWarned",
              a."result"->'entryWarnings' @> '[8]'::jsonb AS "lateWarned", (a."result"->>'permissiveEntry') = 'true' AS "permissiveEntry"
       FROM "tickrify"."AnalysisTrack" t
       JOIN "tickrify"."Analysis" a ON a."id" = t."analysisId"
       WHERE t."status" = 'tracked' AND ($1::text IS NULL OR a."createdAt" >= $1::date)`,
      since,
    );
    const rows = all.filter((r) => !isBeforeFxFix(r));
    if (rows.length < all.length) console.log(`Fora: ${all.length - rows.length} planos de ouro e forex antes da correcao do fuso (${ENGINE_REPORT_SINCE}).`);
    console.log(`Revisao mensal do motor: ${rows.length} planos medidos pelo rastreador${since ? ` desde ${since}` : ''}. Versao atual: ${ENGINE_VERSION}.`);
    const dims: [string, (r: TrackRecord) => string][] = [
      ['estado', (r) => r.signalState],
      ['classe de ativo', (r) => classOfSymbol(r.symbol ?? '')],
      ['compra/venda', (r) => (r.direction === 'long' ? 'compra' : r.direction === 'short' ? 'venda' : '-')],
      ['versao do motor', (r) => r.engineVersion ?? '-'],
    ];
    for (const [title, key] of dims) {
      console.log(`\n| ${title} | planos | executados | acerto TP1 (Wilson 95%) | R liquido medio (bootstrap 95%) | TIMEOUT |`);
      console.log('|---|---|---|---|---|---|');
      for (const value of [...new Set(rows.map(key))].sort()) {
        const of = rows.filter((r) => key(r) === value);
        console.log(line(value, of.length, of.flatMap((r) => { const t = reviewTrade(r); return t ? [t] : []; })));
        console.log(line(`${value}: referencia de direcao (1 ATR)`, of.length, of.flatMap((r) => { const t = reviewReference(r); return t ? [t] : []; })));
      }
    }
    const current = rows.filter((r) => r.engineVersion === ENGINE_VERSION);
    const verdictLine = (title: string, subject: string, off: string, of: TrackRecord[]) => {
      const trades = of.flatMap((r) => { const t = reviewTrade(r); return t ? [t] : []; });
      const meanR = mean(trades.map((t) => t.r));
      const decision = reviewDecision(trades.length, trades.length ? meanR : null);
      const verdict = decision === 'keep' ? `MANTEM ${subject}` : decision === 'disable' ? `DESLIGAR ${off}: decisao do dono` : 'MANTEM e espera mais dados';
      console.log(`\nRegra da revisao (${title} do motor ${ENGINE_VERSION}): n ${trades.length}, R liquido ${signed(meanR)}. ${verdict}. O script so reporta; nada foi mudado.`);
    };
    verdictLine('ENTER_NOW', 'o ENTER_NOW', 'o ENTER_NOW (o produto fica so no modo leitura)', current.filter((r) => r.signalState === 'ENTER_NOW'));
    const enterNow = current.filter((r) => r.signalState === 'ENTER_NOW');
    verdictLine('ENTER_NOW sem swing encaixada', 'a chave ENGINE_SNAP_FALLBACK', 'a chave ENGINE_SNAP_FALLBACK (voltar para 0)', enterNow.filter((r) => r.snapFallback === true));
    verdictLine('ENTER_NOW com C2 ou C7 em FAIL', 'a chave ENGINE_ENTER_REQUIRED_CHECKS', 'a chave ENGINE_ENTER_REQUIRED_CHECKS (voltar para 0)', enterNow.filter((r) => r.entryWarned === true));
    verdictLine('ENTER_NOW com movimento atrasado', 'a chave ENGINE_LATE_AS_WARNING', 'a chave ENGINE_LATE_AS_WARNING', enterNow.filter((r) => r.lateWarned === true));
    verdictLine('ENTER_NOW do modo permissivo', 'a chave ENGINE_PERMISSIVE', 'a chave ENGINE_PERMISSIVE (voltar para 0)', enterNow.filter((r) => r.permissiveEntry === true));
    verdictLine('WATCH tocado e preenchido', 'a entrada no nivel', 'a entrada no nivel (ENGINE_ENTER_AT_LEVEL)', current.filter(isFilledWatch));
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (process.argv.includes('--calibrate')) {
    await calibrate();
    // A conexao do medidor (Redis) seguraria o processo aberto.
    process.exit(0);
  }
  if (process.argv.includes('--review')) {
    await review();
    return;
  }
  // Script de medicao: so a chave TWELVE_DATA_API_KEY_EXPERIMENTS, nunca a de producao.
  enterTwelveDataExperimentMode();
  process.env.ENABLE_NEWS_GUARD = 'false';
  const runs = arg('--runs');
  const gabFile = arg('--gabarito');
  const afterFile = arg('--after');
  const historyFiles = arg('--history');
  if (!runs || !gabFile || !afterFile || !historyFiles) throw new Error('Passe --runs, --gabarito, --after e --history');
  const byId = new Map<string, Row>();
  for (const file of runs.split(',')) {
    for (const l of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const r: Row = JSON.parse(l);
      if (!r.error) byId.set(r.id, r);
    }
  }
  const rows = [...byId.values()];
  const gab = new Map(gabFile.split(',').flatMap((f) => fs.readFileSync(f, 'utf8').trim().split(';')).map((r) => {
    const [k, s, tf, p] = r.split(',');
    return [k, { s, tf: tf.toLowerCase(), p: Number(p) }] as const;
  }));
  const history: Record<string, number[][] | null> = Object.assign({}, ...historyFiles.split(',').map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
  const store = loadStore(afterFile);

  const withReal = rows.filter((r) => r.atr && r.realPrice && r.createdAt);
  const ctxs: Ctx[] = [];
  const skipped: string[] = [];
  for (const row of withReal) {
    if (!row.watchPlan) continue;
    const g = gab.get(row.id.slice(-8));
    const interval = row.interval ?? g?.tf ?? null;
    const raw = row.watchPlan;
    const plan = { ...raw, target2: raw.target2 ?? null, validForCandles: clampValidity(raw.validForCandles), trigger: String(raw.trigger ?? '') };
    if (!isValidWatchPlan(plan)) { skipped.push('plano_invalido'); continue; }
    if (!g || !interval || !TIMEFRAME_MS[interval]) { skipped.push('sem_tempo_grafico'); continue; }
    const key = Object.keys(history).find((k) => k.startsWith(`${row.id}:`) && k.endsWith(`:${interval}`));
    const print = createdAtMs(row.createdAt!);
    const before = key ? closedBars(history[key] ?? [], TIMEFRAME_MS[interval], print) : [];
    if (before.length < 10) { skipped.push('sem_velas_antes'); continue; }
    const w = await windowFor(row, g, interval, store);
    process.stdout.write('.');
    if (!w) { skipped.push('sem_velas_depois'); continue; }
    ctxs.push({ row, plan, atr: row.atr as number, price: row.realPrice as number, step: TIMEFRAME_MS[interval], print, w, history: before });
  }
  console.log('\n');
  console.log(`Respostas: ${rows.length}; com REAL DATA: ${withReal.length}; com plano do modelo medidas: ${ctxs.length}. ` +
    `Fora: ${count(skipped)}. Velas finas: 1m ${ctxs.filter((c) => c.w.fineStep === 60_000).length}, 5m ${ctxs.filter((c) => c.w.fineStep !== 60_000).length}.`);

  console.log(`Distancia ${distanceToInvalidation(ctxs)}.`);
  await measure('v11, configuracao de producao (ENGINE_RULES)', ctxs, withReal.length);

}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
