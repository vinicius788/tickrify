#!/usr/bin/env ts-node
/**
 * Motor do plano do v10.3 SEM chamar a IA (27/10/2026). Le as respostas
 * gravadas pelo prompt-replay.ts (estado, checklist e watchPlan do modelo,
 * ATR e 4h do REAL DATA) e simula, com o MESMO plan-engine.ts da producao:
 *   O1  ordem limit na borda proxima da zona a partir do print (ENTER_NOW: a
 *       mercado no print, stop e TP1 refeitos do preco), stop pela invalidacao,
 *       TP1 x stop em ate 48h depois da execucao (1m, ou 5m quando a janela
 *       passa de 5000 min); tambem com o gate do checklist do validador
 *   O2  O1 so com C2 e C7 em PASS
 *   O3  referencias a mercado no print, stop e alvo de 1 ATR: direcao do plano
 *       e direcao do 4h calculada pelo codigo (alta = swings em alta e fechamento
 *       acima da EMA50; baixa = o espelho; o resto fica de fora)
 * Mais: pre-condicoes da rodada, metrica principal com o criterio fixado,
 * diagnosticos R1, R5, R6 e acerto por lado.
 *
 * --measure (28/10/2026): no lugar do relatorio acima, as medicoes offline do
 * que o produto ja entrega, sem chamar a IA:
 *   M1  sinais do v7.6 (--v76: export de producao .txt e/ou prompt-replay .jsonl)
 *       por distancia entrada-preco em ATR (ate 0,75 e acima): fill em 48h,
 *       TP1 x stop em 48h depois do fill (1m, stop_only)
 *   M2  zona do modelo x 20 zonas sorteadas (mesma largura e direcao, deslocadas
 *       0,5 a 1,5 ATR, metade para cada lado): toque na validade e reacao de
 *       1 ATR antes de fechar alem da invalidacao; diferenca pareada e p-valor
 *       por permutacao
 *   M3  leitura: preco lido x preco real e precos citados no checklist x swing
 *       real mais proxima (--history), em ATR
 *   M4  trades executados do motor limit: MFE em R e TP1 fixo em 0,75R/1R/1,5R
 * --gabarito, --after e --history aceitam varios arquivos separados por
 * virgula; velas novas vao para o ULTIMO --after.
 *
 * --runs aceita varios arquivos separados por virgula; a mesma analise num
 * arquivo seguinte substitui a anterior.
 *
 * Uso (em apps/backend):
 *   pnpm exec ts-node scripts/replay-variants.ts --runs ../../_local/engine-v10/replay-v10.3-real.jsonl --gabarito <gabarito> --after ../../_local/engine-v10/after-candles.json
 * Busca as velas depois do print (gratis, retomavel no --after) e imprime o relatorio.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { parsePassFailChecklist } from '../src/common/utils/analysis-normalizer';
import { fractalSwings } from '../src/modules/ai/ai.adapter';
import { enterTwelveDataExperimentMode, experimentRefusesFx } from '../src/modules/market/twelve-data';
import { TIMEFRAME_MS, fetchWindow } from '../src/modules/market/candle-store';
import { checklistGate } from '../src/common/utils/signal-decision';
import {
  PLAN_RULES,
  clampValidity,
  closedBars,
  closesBeyondInvalidation,
  nearEdge,
  isValidWatchPlan,
  firstTouch,
  resolveTp1,
  trackPlan,
  type Bar,
  type Fill,
  type Resolution,
  type WatchPlan,
} from '../src/common/utils/plan-engine';

const H = 3_600_000;
const RESOLVE_MS = 48 * H;
const FINE_MAX_MINUTES = 5000;

interface Row {
  id: string;
  symbol: string;
  cls: 'crypto' | 'metal' | 'forex';
  state: string;
  recommendation?: string;
  currentPrice?: number | null;
  notes?: string[];
  plan?: { side: 'BUY' | 'SELL'; entry: number; stopLoss: number; takeProfit1: number } | null;
  modelState?: string | null;
  watchPlan?: any;
  checklist?: string;
  createdAt?: string;
  interval?: string | null;
  atr?: number | null;
  realPrice?: number | null;
  htfTrend?: 'uptrend' | 'downtrend' | 'range' | null;
  htfVsEma50?: 'above' | 'below' | null;
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

/** Velas do tempo grafico depois do print e velas finas ate 48h depois da ultima execucao possivel. */
async function windowFor(row: Row, gab: Gab, interval: string, store: CandleStore): Promise<Window> {
  if (row.id in store.all) return store.all[row.id];
  const step = TIMEFRAME_MS[interval];
  const print = createdAtMs(row.createdAt!);
  const span = (PLAN_RULES.validMaxCandles + 2) * step + RESOLVE_MS;
  // Fim de semana do forex: folga de 3 dias nas velas do tempo grafico.
  const tfEnd = print + span + (row.cls === 'crypto' ? 0 : 72 * H);
  const fineInterval = span / 60_000 <= FINE_MAX_MINUTES || row.cls === 'crypto' ? '1m' : '5m';
  const tf = await bars(row, gab, interval, print - step, tfEnd);
  const fine = tf ? await bars(row, gab, fineInterval, print - step, tfEnd) : null;
  return remember(store, row.id, tf && fine ? { tf, fine, fineStep: TIMEFRAME_MS[fineInterval] } : null);
}

/** M1: velas de 1m do print ate 96h depois (48h para o fill + 48h de resolucao). */
async function signalWindow(row: Row, gab: Gab, store: CandleStore): Promise<Window> {
  const key = `${row.id}:m1`;
  if (key in store.all) return store.all[key];
  const print = createdAtMs(row.createdAt!);
  const end = print + 2 * RESOLVE_MS + (row.cls === 'crypto' ? 0 : 72 * H);
  const fine = await bars(row, gab, '1m', print - 60_000, end);
  return remember(store, key, fine ? { tf: [], fine, fineStep: TIMEFRAME_MS['1m'] } : null);
}

// ── Simulacao ───────────────────────────────────────────────────────────────
interface Trade {
  id: string;
  long: boolean;
  fill: number;
  stop: number;
  tp1: number;
  outcome: 'WIN' | 'LOSS' | 'TIMEOUT';
  /** WIN = R do TP1 a partir do preco executado, LOSS = -1, TIMEOUT = 0. */
  r: number;
  fillIndex: number;
  sameCandle: boolean;
  mfeR: number;
  checklist: string;
}
type Status = 'stop_out_of_range' | 'no_room' | 'invalidated' | 'target_before_fill' | 'expired' | 'no_candles' | 'traded';
interface Sim { status: Status; trade?: Trade; stopWidened?: boolean }

const fineIndexAt = (fine: Bar[], ms: number) => {
  const i = fine.findIndex((b) => b[0] >= ms);
  return i < 0 ? fine.length : i;
};

function resolveTrade(c: Ctx, long: boolean, fill: Fill, stop: number, tp1: number): Trade {
  return tradeOf(c, long, fill, stop, tp1, resolveTp1(c.w.fine, long, fill, stop, tp1, c.w.fine[fill.index][0] + RESOLVE_MS));
}

function tradeOf(c: Ctx, long: boolean, fill: Fill, stop: number, tp1: number, res: Resolution): Trade {
  const risk = Math.abs(fill.price - stop);
  return {
    id: c.row.id, long, fill: fill.price, stop, tp1, outcome: res.outcome, fillIndex: fill.index,
    r: res.outcome === 'WIN' ? Math.abs(tp1 - fill.price) / risk : res.outcome === 'LOSS' ? -1 : 0,
    sameCandle: res.sameCandle, mfeR: res.mfeR, checklist: c.row.checklist ?? '',
  };
}

interface Ctx { row: Row; plan: WatchPlan; atr: number; step: number; print: number; w: NonNullable<Window> }

/** O1: o motor do plano pela regua compartilhada com o rastreador (trackPlan). */
function simulatePlan(c: Ctx): Sim {
  const t = trackPlan({
    plan: c.plan, enterNow: c.row.state === 'ENTER_NOW', atr: c.atr,
    tf: c.w.tf, tfStepMs: c.step, fine: c.w.fine, startMs: c.print, resolveMs: RESOLVE_MS,
  });
  const stopWidened = t.levels?.stopWidened;
  if (t.outcome === 'NO_CANDLES') return { status: 'no_candles' };
  if (t.outcome === 'NO_LEVELS') return { status: t.rejection ?? 'no_room' };
  if (!t.fill || !t.levels || !t.resolution) return { status: t.order as Status, stopWidened };
  return {
    status: 'traded', stopWidened,
    trade: tradeOf(c, c.plan.direction === 'long', t.fill, t.levels.stopLoss, t.levels.takeProfit1, t.resolution),
  };
}

/** O3: mercado no print, stop e alvo de 1 ATR. */
function simulateDirection(c: Ctx, long: boolean): Trade | null {
  const i = fineIndexAt(c.w.fine, c.print);
  if (i >= c.w.fine.length) return null;
  const price = c.w.fine[i][1];
  return resolveTrade(c, long, { index: i, price }, long ? price - c.atr : price + c.atr, long ? price + c.atr : price - c.atr);
}

/** Direcao do 4h pelo codigo: swings e EMA50 concordando; senao, nenhuma. */
function htfDirection(row: Row): boolean | null {
  if (row.htfTrend === 'uptrend' && row.htfVsEma50 === 'above') return true;
  if (row.htfTrend === 'downtrend' && row.htfVsEma50 === 'below') return false;
  return null;
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
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}R`;

function count(xs: string[]): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([k, v]) => `${k} ${v}`).join(', ') || '-';
}

/** Linha da tabela: planos, executados, acerto do TP1, R medio (TIMEOUT = 0R), mortos e TIMEOUT. */
function line(name: string, plans: number, trades: Trade[], dead?: string): string {
  const decided = trades.filter((t) => t.outcome !== 'TIMEOUT');
  const wins = decided.filter((t) => t.outcome === 'WIN').length;
  const [lo, hi] = wilson(wins, decided.length);
  const rs = trades.map((t) => t.r);
  const [blo, bhi] = bootstrapMean(rs);
  return `| ${name} | ${plans} | ${trades.length} | ${decided.length ? `${pct(wins / decided.length)} (${pct(lo)} a ${pct(hi)}), n=${decided.length}` : '-'} | ${
    rs.length ? `${signed(mean(rs))} (${blo.toFixed(2)} a ${bhi.toFixed(2)})` : '-'
  } | ${dead ?? '-'} | ${trades.length - decided.length} |`;
}

const passes = (checklist: string | undefined, ...items: number[]) => {
  const parsed = parsePassFailChecklist(checklist);
  return !!parsed && items.every((n) => parsed.get(n) === true);
};

// ── Medicoes offline (--measure) ────────────────────────────────────────────
interface Signal { id: string; source: string; long: boolean; entry: number; stop: number; tp1: number; market: boolean }

/** Sinais do v7.6: export de producao (.txt, promptVer 13) ou prompt-replay (.jsonl). */
function loadSignals(files: string): Signal[] {
  const out: Signal[] = [];
  for (const file of files.split(',')) {
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.txt')) {
      for (const l of text.split('\n').filter(Boolean)) {
        const [id, ver, rec, type, entry, stop, tp1] = l.split('|');
        if (ver !== '13' || (rec !== 'BUY' && rec !== 'SELL')) continue;
        out.push({ id, source: 'producao', long: rec === 'BUY', entry: Number(entry), stop: Number(stop), tp1: Number(tp1), market: type === 'market' });
      }
    } else {
      for (const l of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(l);
        if (!r.plan) continue;
        out.push({ id: r.id, source: 'replay', long: r.plan.side === 'BUY', entry: r.plan.entry, stop: r.plan.stopLoss, tp1: r.plan.takeProfit1, market: false });
      }
    }
  }
  return out.filter((x) => (x.long ? x.stop < x.entry && x.entry < x.tp1 : x.stop > x.entry && x.entry > x.tp1));
}

/** Ordem pelo toque: limit do lado a favor do preco, stop do outro; gap executa na abertura. */
function touchFill(fine: Bar[], long: boolean, entry: number, price0: number, from: number, untilMs: number): Fill | null {
  const limit = long ? entry <= price0 : entry >= price0;
  for (let i = from; i < fine.length && fine[i][0] < untilMs; i++) {
    const [, o, h, l] = fine[i];
    const hit = limit ? (long ? l <= entry : h >= entry) : (long ? h >= entry : l <= entry);
    if (!hit) continue;
    const gap = limit ? (long ? o < entry : o > entry) : (long ? o > entry : o < entry);
    return { index: i, price: gap ? o : entry };
  }
  return null;
}

function table(title: string, head: string[], lines: string[][]) {
  console.log(`\n${title}\n| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`);
  for (const l of lines) console.log(`| ${l.join(' | ')} |`);
}

const ci = (xs: number[]) => { const [lo, hi] = bootstrapMean(xs); return `${signed(mean(xs))} (${lo.toFixed(2)} a ${hi.toFixed(2)})`; };
const rate = (k: number, n: number) => { const [lo, hi] = wilson(k, n); return n ? `${pct(k / n)} (${pct(lo)} a ${pct(hi)}), n=${n}` : '-'; };
const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : NaN);

async function measureSignals(signals: Signal[], byId: Map<string, Row>, gab: Map<string, Gab>, store: CandleStore) {
  type Out = { s: Signal; d: number; filled: boolean; outcome?: Trade['outcome']; r?: number };
  const done: Out[] = [];
  const skipped: string[] = [];
  for (const s of signals) {
    const row = byId.get(s.id);
    const g = gab.get(s.id.slice(-8));
    if (!row?.atr || !row.createdAt || !g) { skipped.push('sem_atr_real'); continue; }
    const w = await signalWindow(row, g, store);
    process.stdout.write('.');
    if (!w || !w.fine.length) { skipped.push('sem_velas'); continue; }
    const print = createdAtMs(row.createdAt);
    const i = fineIndexAt(w.fine, print);
    if (i >= w.fine.length) { skipped.push('sem_velas'); continue; }
    const price0 = row.realPrice ?? w.fine[i][1];
    const d = Math.abs(s.entry - price0) / row.atr;
    const fill = s.market ? { index: i, price: w.fine[i][1] } : touchFill(w.fine, s.long, s.entry, price0, i, print + RESOLVE_MS);
    if (!fill) { done.push({ s, d, filled: false }); continue; }
    const res = resolveTp1(w.fine, s.long, fill, s.stop, s.tp1, w.fine[fill.index][0] + RESOLVE_MS);
    const risk = Math.abs(fill.price - s.stop);
    const r = res.outcome === 'WIN' ? Math.abs(s.tp1 - fill.price) / risk : res.outcome === 'LOSS' ? -1 : 0;
    done.push({ s, d, filled: true, outcome: res.outcome, r });
  }
  console.log('');
  const lines: string[][] = [];
  for (const source of ['producao', 'replay', 'todos']) {
    const of = done.filter((x) => source === 'todos' || x.s.source === source);
    for (const [label, group] of [['ate 0,75 ATR', of.filter((x) => x.d <= 0.75)], ['acima de 0,75 ATR', of.filter((x) => x.d > 0.75)]] as const) {
      const filled = group.filter((x) => x.filled);
      const decided = filled.filter((x) => x.outcome !== 'TIMEOUT');
      lines.push([source, label, `${group.length} (${pct(group.length / (of.length || 1))})`, rate(filled.length, group.length),
        rate(decided.filter((x) => x.outcome === 'WIN').length, decided.length), filled.length ? ci(filled.map((x) => x.r as number)) : '-',
        String(filled.length - decided.length)]);
    }
  }
  table('M1. v7.6: distancia entrada-preco no momento da analise (1m, fill em 48h, TP1 x stop em 48h, stop_only; R por executado, TIMEOUT = 0R)',
    ['fonte', 'distancia', 'sinais (% da fonte)', 'taxa de fill (Wilson)', 'acerto TP1 (Wilson)', 'R medio (bootstrap)', 'TIMEOUT'], lines);
  const far = done.filter((x) => x.d > 0.75);
  console.log(`Portao de 0,75 ATR: rebaixaria ${far.length} de ${done.length} sinais medidos (producao ${far.filter((x) => x.s.source === 'producao').length}, replay ${far.filter((x) => x.s.source === 'replay').length}). Fora da medicao: ${count(skipped)}. Distancia mediana ${quantile(done.map((x) => x.d), 0.5).toFixed(2)} ATR, p90 ${quantile(done.map((x) => x.d), 0.9).toFixed(2)}.`);
}

interface ZoneResult { touched: boolean; reacted: boolean }

/** M2: toque na validade (velas finas) e reacao de 1 ATR a partir da borda antes de fechar alem da invalidacao (48h). */
function zoneOutcome(c: Ctx, plan: WatchPlan): ZoneResult {
  const { w, step, print, atr } = c;
  const long = plan.direction === 'long';
  const t = firstTouch(plan, w.fine, print, print + plan.validForCandles * step);
  if (t === null) return { touched: false, reacted: false };
  const touchMs = w.fine[t][0];
  const dead = w.tf.find((b) => b[0] + step > touchMs && closesBeyondInvalidation(plan, b));
  const endMs = Math.min(touchMs + RESOLVE_MS, dead ? dead[0] + step : Infinity);
  const goal = long ? nearEdge(plan) + atr : nearEdge(plan) - atr;
  for (let i = t; i < w.fine.length && w.fine[i][0] < endMs; i++) {
    if (long ? w.fine[i][2] >= goal : w.fine[i][3] <= goal) return { touched: true, reacted: true };
  }
  return { touched: true, reacted: false };
}

/** Diferenca pareada (modelo - media das sorteadas) e p-valor bilateral por permutacao do rotulo "modelo". */
function pairedTest(groups: number[][], perms = 10000): { diff: number; ci: [number, number]; p: number } {
  const stat = (pick: (g: number[]) => number) => mean(groups.map((g) => {
    const k = pick(g);
    const others = g.filter((_, j) => j !== k);
    return g[k] - mean(others);
  }));
  const diff = stat(() => 0);
  let extreme = 0;
  for (let t = 0; t < perms; t++) if (Math.abs(stat((g) => Math.floor(rand() * g.length))) >= Math.abs(diff) - 1e-12) extreme++;
  return { diff, ci: bootstrapMean(groups.map((g) => g[0] - mean(g.slice(1)))), p: (extreme + 1) / (perms + 1) };
}

function measureZones(ctxs: Ctx[]) {
  const touch: number[][] = [];
  const react: number[][] = [];
  let modelTouched = 0;
  let modelReacted = 0;
  const randTouch: number[] = [];
  const randReact: number[] = [];
  for (const c of ctxs) {
    const width = c.plan.zoneHigh - c.plan.zoneLow;
    const zones = [c.plan];
    for (let k = 0; k < 20; k++) {
      const shift = (k < 10 ? 1 : -1) * (0.5 + rand()) * c.atr;
      zones.push({ ...c.plan, zoneLow: c.plan.zoneLow + shift, zoneHigh: c.plan.zoneLow + shift + width, invalidation: c.plan.invalidation + shift });
    }
    const res = zones.map((z) => zoneOutcome(c, z));
    touch.push(res.map((x) => (x.touched ? 1 : 0)));
    if (res[0].touched) modelTouched++;
    if (res[0].reacted) modelReacted++;
    res.slice(1).forEach((x) => { randTouch.push(x.touched ? 1 : 0); if (x.touched) randReact.push(x.reacted ? 1 : 0); });
    // Reacao so entre as zonas tocadas; o plano entra se o modelo e ao menos uma sorteada tocaram.
    if (res[0].touched && res.slice(1).some((x) => x.touched)) react.push([res[0], ...res.slice(1).filter((x) => x.touched)].map((x) => (x.reacted ? 1 : 0)));
  }
  const t = pairedTest(touch);
  const r = pairedTest(react);
  table(`M2. Zona do modelo x 20 zonas sorteadas por plano (${ctxs.length} planos das rodadas A e B)`,
    ['medida', 'zona do modelo', 'zonas sorteadas', 'diferenca pareada (bootstrap)', 'p (permutacao, bilateral)', 'planos no teste'], [
      ['toque na validade', rate(modelTouched, ctxs.length), `${pct(mean(randTouch))} (n=${randTouch.length})`, `${(100 * t.diff).toFixed(1)} pp (${(100 * t.ci[0]).toFixed(1)} a ${(100 * t.ci[1]).toFixed(1)})`, t.p.toFixed(3), String(touch.length)],
      ['reacao de 1 ATR (das tocadas)', rate(modelReacted, modelTouched), `${pct(mean(randReact))} (n=${randReact.length})`, `${(100 * r.diff).toFixed(1)} pp (${(100 * r.ci[0]).toFixed(1)} a ${(100 * r.ci[1]).toFixed(1)})`, r.p.toFixed(3), String(react.length)],
    ]);
}

function measureReading(rows: Row[], history: Record<string, number[][] | null>, gab: Map<string, Gab>) {
  const priceErr = rows.filter((r) => r.currentPrice && r.realPrice && r.atr).map((r) => Math.abs((r.currentPrice as number) - (r.realPrice as number)) / (r.atr as number));
  // Preco que a producao leu do print na epoca (gabarito), quando o grounding nao chegava ao modelo.
  const imageErr = rows.filter((r) => gab.get(r.id.slice(-8))?.p && r.realPrice && r.atr)
    .map((r) => Math.abs((gab.get(r.id.slice(-8)) as Gab).p - (r.realPrice as number)) / (r.atr as number));
  const swingErr: number[] = [];
  let analyses = 0;
  for (const r of rows) {
    if (!r.realPrice || !r.atr || !r.interval || !r.createdAt || !TIMEFRAME_MS[r.interval]) continue;
    const key = Object.keys(history).find((k) => k.startsWith(`${r.id}:`) && k.endsWith(`:${r.interval}`));
    const bars = key ? closedBars(history[key] ?? [], TIMEFRAME_MS[r.interval], createdAtMs(r.createdAt)) : [];
    const swings = fractalSwings(bars).map((x) => x.price);
    if (!swings.length) continue;
    const cited = (String(r.checklist ?? '').match(/\d[\d,]*\.?\d*/g) ?? [])
      .map((x) => Number(x.replace(/,/g, '')))
      .filter((x) => x > 0.9 * (r.realPrice as number) && x < 1.1 * (r.realPrice as number));
    if (!cited.length) continue;
    analyses++;
    for (const x of cited) swingErr.push(Math.min(...swings.map((y) => Math.abs(x - y))) / (r.atr as number));
  }
  table('M3. Leitura (rodadas A e B, prints com REAL DATA)', ['medida', 'n', 'mediana (ATR)', 'p90 (ATR)'], [
    ['|preco lido (v10.3, com REAL DATA no prompt) - preco real|', String(priceErr.length), quantile(priceErr, 0.5).toFixed(2), quantile(priceErr, 0.9).toFixed(2)],
    [`|preco lido do print pela producao (sem REAL DATA) - preco real| (acima de 0,5 ATR: ${imageErr.filter((x) => x > 0.5).length})`, String(imageErr.length), quantile(imageErr, 0.5).toFixed(2), quantile(imageErr, 0.9).toFixed(2)],
    [`preco citado no checklist x swing real mais proxima (${analyses} analises)`, String(swingErr.length), quantile(swingErr, 0.5).toFixed(2), quantile(swingErr, 0.9).toFixed(2)],
  ]);
  console.log('O reasoning nao foi gravado pelo prompt-replay: os precos citados vem do structureValidation (C1..C7), a +-10% do preco real. Swings reais = fractal de 2 velas nas 120 velas fechadas do tempo grafico antes do print.');
}

function measureExits(ctxs: Ctx[]) {
  const trades = ctxs.filter((c) => ['WATCH', 'ARMED', 'ENTER_NOW'].includes(c.row.state))
    .flatMap((c) => { const s = simulatePlan(c); return s.trade ? [{ c, t: s.trade }] : []; });
  const mfe = trades.map(({ c, t }) => resolveTp1(c.w.fine, t.long, { index: t.fillIndex, price: t.fill }, t.stop, t.long ? Infinity : -Infinity, c.w.fine[t.fillIndex][0] + RESOLVE_MS).mfeR);
  const bucket = (lo: number, hi: number) => String(mfe.filter((x) => x >= lo && x < hi).length);
  table(`M4. Saida (exploratorio): ${trades.length} trades executados do motor limit nas rodadas A e B`,
    ['MFE ate o stop ou 48h', 'p25', 'mediana', 'p75', 'p90', '<0,5R', '0,5-1R', '1-1,5R', '>=1,5R'],
    [['R', quantile(mfe, 0.25).toFixed(2), quantile(mfe, 0.5).toFixed(2), quantile(mfe, 0.75).toFixed(2), quantile(mfe, 0.9).toFixed(2), bucket(-Infinity, 0.5), bucket(0.5, 1), bucket(1, 1.5), bucket(1.5, Infinity)]]);
  const lines = [0.75, 1, 1.5].map((x) => {
    const res = trades.map(({ c, t }) => {
      const risk = Math.abs(t.fill - t.stop);
      return resolveTp1(c.w.fine, t.long, { index: t.fillIndex, price: t.fill }, t.stop, t.long ? t.fill + x * risk : t.fill - x * risk, c.w.fine[t.fillIndex][0] + RESOLVE_MS).outcome;
    });
    const wins = res.filter((o) => o === 'WIN').length;
    const decided = res.filter((o) => o !== 'TIMEOUT').length;
    return [`TP1 fixo em ${String(x).replace('.', ',')}R`, String(wins), rate(wins, decided), signed((wins * x - res.filter((o) => o === 'LOSS').length) / (res.length || 1)), String(res.length - decided)];
  });
  table('', ['alvo', 'bateram', 'acerto (Wilson)', 'R medio (TIMEOUT = 0R)', 'TIMEOUT'], lines);
}

async function main() {
  // Script de medicao: so a chave TWELVE_DATA_API_KEY_EXPERIMENTS, nunca a de producao.
  enterTwelveDataExperimentMode();
  const runs = arg('--runs');
  const gabFile = arg('--gabarito');
  const afterFile = arg('--after');
  if (!runs || !gabFile || !afterFile) throw new Error('Passe --runs, --gabarito e --after');
  const measure = process.argv.includes('--measure');
  const all: Row[] = [];
  const byId = new Map<string, Row>();
  for (const file of runs.split(',')) {
    for (const l of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const r: Row = JSON.parse(l);
      all.push(r);
      if (!r.error) byId.set(r.id, r);
    }
  }
  const rows = [...byId.values()];
  const gab = new Map(gabFile.split(',').flatMap((f) => fs.readFileSync(f, 'utf8').trim().split(';')).map((r) => {
    const [k, s, tf, p] = r.split(',');
    return [k, { s, tf: tf.toLowerCase(), p: Number(p) }] as const;
  }));
  const store = loadStore(afterFile);

  const ctxs: Ctx[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    // Com --measure entram todos os planos com watchPlan (M2), qualquer que seja o estado final.
    if (measure ? !row.watchPlan : !['WATCH', 'ARMED', 'ENTER_NOW'].includes(row.state)) continue;
    const g = gab.get(row.id.slice(-8));
    const interval = row.interval ?? g?.tf ?? null;
    const raw = row.watchPlan;
    const plan = raw && typeof raw === 'object'
      ? { ...raw, target2: raw.target2 ?? null, validForCandles: clampValidity(raw.validForCandles), trigger: String(raw.trigger ?? '') }
      : null;
    if (!plan || !isValidWatchPlan(plan)) { skipped.push('plano_invalido'); continue; }
    if (!g || !interval || !TIMEFRAME_MS[interval] || !row.atr || !row.createdAt) { skipped.push('sem_real_data'); continue; }
    const w = await windowFor(row, g, interval, store);
    process.stdout.write('.');
    if (!w) { skipped.push('sem_velas_depois'); continue; }
    ctxs.push({ row, plan, atr: row.atr, step: TIMEFRAME_MS[interval], print: createdAtMs(row.createdAt), w });
  }
  console.log('\n');

  if (measure) {
    const v76 = arg('--v76');
    const historyFiles = arg('--history');
    if (!v76 || !historyFiles) throw new Error('--measure exige --v76 e --history');
    const history: Record<string, number[][] | null> = Object.assign({}, ...historyFiles.split(',').map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
    await measureSignals(loadSignals(v76), byId, gab, store);
    measureZones(ctxs);
    measureReading(rows, history, gab);
    measureExits(ctxs);
    return;
  }

  // ── Pre-condicoes ──
  const errors = all.filter((r) => r.error && !byId.has(r.id)).length;
  const planStates = rows.filter((r) => ['WATCH', 'ARMED', 'ENTER_NOW'].includes(r.modelState ?? ''));
  const withoutPlan = planStates.filter((r) => !r.watchPlan).length;
  const signals = rows.filter((r) => (r.state === 'ARMED' || r.state === 'ENTER_NOW') && r.plan && r.watchPlan && r.atr);
  const stopFromInvalidation = signals.filter((r) => {
    const p = r.watchPlan;
    const atr = r.atr as number;
    const fromInvalidation = p.direction === 'long' ? p.invalidation - PLAN_RULES.stopBufferAtr * atr : p.invalidation + PLAN_RULES.stopBufferAtr * atr;
    const widened = p.direction === 'long' ? r.plan!.entry - PLAN_RULES.stopMinAtr * atr : r.plan!.entry + PLAN_RULES.stopMinAtr * atr;
    const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
    return near(r.plan!.stopLoss, fromInvalidation) || near(r.plan!.stopLoss, widened);
  }).length;
  const sims = ctxs.map((c) => ({ c, s: simulatePlan(c) }));
  console.log(`Respostas: ${rows.length} (erros de schema ou de chamada sem resposta valida: ${errors}).`);
  console.log(`Estado final: ${count(rows.map((r) => r.state))}. Estado do modelo: ${count(rows.map((r) => r.modelState ?? '-'))}.`);
  console.log(`Motivos do validador: ${count(rows.flatMap((r) => r.notes ?? []))}.`);
  console.log(`Pre-condicoes: estados do modelo com plano ${planStates.length - withoutPlan} de ${planStates.length}; ` +
    `sinais com stop derivado da invalidation ${stopFromInvalidation} de ${signals.length}; ` +
    `planos mortos por stop menor que 0,5 ATR 0 (o motor alarga; alargados: ${sims.filter((x) => x.s.stopWidened).length}).`);
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const legible = rows.map((r) => parsePassFailChecklist(r.checklist)).filter((m): m is ReadonlyMap<number, boolean> => !!m);
    process.stdout.write(`${n === 1 ? 'PASS por item: ' : ', '}C${n} ${pct(legible.filter((m) => m.get(n)).length / (legible.length || 1))}`);
  }
  console.log(`. Planos simulados: ${ctxs.length}. Fora: ${count(skipped)}.\n`);

  // ── O1, O2, O3 ──
  const tradesOf = (xs: { s: Sim }[]) => xs.flatMap((x) => (x.s.trade ? [x.s.trade] : []));
  const deadOf = (xs: { s: Sim }[]) => count(xs.filter((x) => x.s.status !== 'traded').map((x) => x.s.status));
  const gated = sims.filter(({ c }) => !checklistGate(c.row.checklist, c.row.symbol, c.plan.direction, c.row.htfTrend ?? null));
  const o2 = sims.filter(({ c }) => passes(c.row.checklist, 2, 7));
  const dirPlan = ctxs.flatMap((c) => { const t = simulateDirection(c, c.plan.direction === 'long'); return t ? [t] : []; });
  const htf = ctxs.flatMap((c) => { const long = htfDirection(c.row); const t = long === null ? null : simulateDirection(c, long); return t ? [t] : []; });
  console.log('| teste | planos | executados | acerto TP1 (Wilson 95%) | R medio por executado (bootstrap 95%) | mortos e motivo | TIMEOUT |');
  console.log('|---|---|---|---|---|---|---|');
  console.log(line('O1 motor limit', sims.length, tradesOf(sims), deadOf(sims)));
  console.log(line('O1 com o gate do checklist', gated.length, tradesOf(gated), deadOf(gated)));
  console.log(line('O2 C2 e C7 em PASS', o2.length, tradesOf(o2), deadOf(o2)));
  console.log(line('O3 direcao do plano (1 ATR)', ctxs.length, dirPlan));
  console.log(line('O3 direcao do 4h (1 ATR)', htf.length, htf, `sem direcao no 4h ${ctxs.length - htf.length}`));
  for (const state of ['WATCH', 'ARMED', 'ENTER_NOW']) {
    const by = sims.filter(({ c }) => c.row.state === state);
    if (by.length) console.log(line(`O1 so ${state}`, by.length, tradesOf(by), deadOf(by)));
  }

  // ── Metrica principal (criterio fixado antes da rodada) ──
  const executed = tradesOf(sims);
  const n = executed.length;
  const r = mean(executed.map((t) => t.r));
  const ref = mean(dirPlan.map((t) => t.r));
  const verdict = n >= 15 && (r <= -0.2 || r < ref - 0.25)
    ? 'REPROVA'
    : n >= 15 && r >= 0 && r >= ref ? 'SEGUE PARA A RODADA B' : 'INCONCLUSIVO';
  const decided = executed.filter((t) => t.outcome !== 'TIMEOUT');
  console.log(`\nMetrica principal: n executados ${n}, R medio ${signed(r)} (so decididos: ${signed(mean(decided.map((t) => t.r)))}, n=${decided.length}); ` +
    `referencia direcao do plano ${signed(ref)} (n=${dirPlan.length}). Veredito pelo criterio: ${verdict}.`);

  // ── Diagnosticos ──
  console.log(`\nR1: TP1 e stop na mesma vela (contados como stop): ${decided.filter((t) => t.sameCandle).length} de ${decided.length} decididos.`);
  const stops = decided.filter((t) => t.outcome === 'LOSS');
  console.log(`R5: ${stops.length} stops; MFE mediana ${median(stops.map((t) => t.mfeR)).toFixed(2)}R (${stops.filter((t) => t.mfeR >= 0.5).length} passaram de +0,5R, ${stops.filter((t) => t.mfeR >= 1).length} de +1R).`);
  const fmt = (xs: Trade[]) => (xs.length ? `${pct(xs.filter((t) => t.outcome === 'WIN').length / xs.length)} (n=${xs.length})` : '- (n=0)');
  console.log('R6 (O1): acerto por item do checklist');
  for (const code of [1, 2, 3, 4, 5, 6, 7]) {
    const by = (v: boolean) => decided.filter((t) => parsePassFailChecklist(t.checklist)?.get(code) === v);
    console.log(`  C${code}: PASS ${fmt(by(true))} | FAIL ${fmt(by(false))}`);
  }
  console.log(`Lado (O1): compra ${fmt(decided.filter((t) => t.long))} | venda ${fmt(decided.filter((t) => !t.long))}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
