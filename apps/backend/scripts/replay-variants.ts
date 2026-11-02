#!/usr/bin/env ts-node
/**
 * Medicao offline do validador do v11 SEM chamar a IA (02/11/2026). Le as
 * respostas gravadas pelo prompt-replay.ts (estado, checklist e watchPlan do
 * modelo; ATR, preco e 4h do REAL DATA), refaz as velas fechadas antes do print
 * (--history: swings fractais e maturidade) e decide o estado pelo MESMO
 * decideSignal da producao. Depois mede com a regua do rastreador (trackPlan):
 * ENTER_NOW a mercado na primeira vela fina depois do print, ARMED como ordem
 * limit na validade do plano, TP1 x stop em 48h depois da execucao
 * (stop_only), spread tipico do ativo descontado em R.
 *
 * Referencia: a direcao do plano a mercado no print, stop e alvo de 1 ATR,
 * com o mesmo spread.
 *
 * --alt "riskMaxAtr=3; enterNowChecks=[2,3,7]; tp1FloorWithRoom=true" (ate 3
 * vezes) repete a medicao com constantes do ENGINE_RULES trocadas, so neste
 * processo. Pares separados por ponto e virgula; cada valor e JSON.
 *
 * --runs, --gabarito, --after e --history aceitam varios arquivos separados
 * por virgula; a mesma analise num arquivo seguinte substitui a anterior. Velas
 * que faltarem vao para o ULTIMO --after (cripto gratis; forex/metal so com a
 * chave TWELVE_DATA_API_KEY_EXPERIMENTS).
 *
 * Uso (em apps/backend):
 *   pnpm exec ts-node scripts/replay-variants.ts --runs <A.jsonl>,<B.jsonl> --gabarito <A.txt>,<B.txt> --after <velas.json> --history <historico.json>
 */
import 'dotenv/config';
import * as fs from 'fs';
import { canonicalFxPair } from '../src/common/utils/analysis-normalizer';
import { normalizeToBinancePerp } from '../src/modules/market/market.service';
import { enterTwelveDataExperimentMode, experimentRefusesFx } from '../src/modules/market/twelve-data';
import { TIMEFRAME_MS, fetchWindow } from '../src/modules/market/candle-store';
import { decideSignal, type SignalDecisionResult, type SignalState } from '../src/common/utils/signal-decision';
import {
  ENGINE_RULES,
  clampValidity,
  closedBars,
  fractalSwings,
  isValidWatchPlan,
  moveIsLate,
  resolveTp1,
  trackPlan,
  type Bar,
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

function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] ? [process.argv[i + 1]] : []));
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

/**
 * Spread tipico de conta de varejo, em preco: ouro 0,30; prata 0,03; forex
 * 1,2 pip nos majors e 2 pips nos cruzados; BTC e ETH 0,02% do preco; outras
 * cripto 0,05%.
 */
function spreadOf(symbol: string, price: number): number {
  const fx = canonicalFxPair(symbol);
  if (fx === 'XAUUSD') return 0.3;
  if (fx === 'XAGUSD') return 0.03;
  if (fx) {
    const major = ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY'].includes(fx);
    return (fx.endsWith('JPY') ? 0.01 : 0.0001) * (major ? 1.2 : 2);
  }
  const base = normalizeToBinancePerp(symbol).base;
  return price * (base === 'BTC' || base === 'ETH' ? 0.0002 : 0.0005);
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
    },
  });
}

/** ENTER_NOW a mercado e ARMED como limit, pela regua do rastreador; null = nao executou. */
function simulate(c: Ctx, d: SignalDecisionResult): Trade | null {
  if (d.state !== 'ENTER_NOW' && d.state !== 'ARMED') return null;
  const plan = d.watchPlan as WatchPlan;
  const t = trackPlan({
    plan, enterNow: d.state === 'ENTER_NOW', atr: c.atr,
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

type Rules = Record<string, unknown>;

/** Troca constantes do ENGINE_RULES so durante `fn` (o objeto e literal em tempo de execucao). */
async function withRules<T>(patch: Rules, fn: () => Promise<T>): Promise<T> {
  const target = ENGINE_RULES as unknown as Rules;
  const saved = Object.fromEntries(Object.keys(patch).map((k) => [k, target[k]]));
  for (const k of Object.keys(patch)) {
    if (!(k in target)) throw new Error(`ENGINE_RULES nao tem ${k}`);
    target[k] = patch[k];
  }
  try {
    return await fn();
  } finally {
    Object.assign(target, saved);
  }
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
  const actionable = states.filter((s) => s === 'ENTER_NOW' || s === 'ARMED').length;
  console.log(`\n### ${label}`);
  console.log(`Estados (${analyses} analises com REAL DATA; ${nonPlan} sem plano do modelo ficam NO_TRADE): ` +
    `ENTER_NOW ${states.filter((s) => s === 'ENTER_NOW').length}, ARMED ${states.filter((s) => s === 'ARMED').length}, ` +
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
  const signal = (s: SignalState) => s === 'ENTER_NOW' || s === 'ARMED';
  const groups: [string, { plans: number; trades: Trade[] }][] = [
    ['ENTER_NOW', executed((s) => s === 'ENTER_NOW')],
    ['ARMED', executed((s) => s === 'ARMED')],
    ['ENTER_NOW + ARMED', executed(signal)],
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

  const both = groups[2][1].trades;
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

async function main() {
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
  await measure('v11, constantes do ENGINE_RULES', ctxs, withReal.length);
  for (const alt of args('--alt').slice(0, 3)) {
    const patch = Object.fromEntries(alt.split(';').filter((kv) => kv.trim()).map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), JSON.parse(kv.slice(i + 1).trim())];
    }));
    await withRules(patch, () => measure(`alternativa ${alt}`, ctxs, withReal.length));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
