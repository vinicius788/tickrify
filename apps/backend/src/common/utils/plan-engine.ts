// ============================================================================
// MOTOR DO PLANO DO v10.3 (27/10/2026): ORDEM LIMIT NA BORDA DA ZONA
// ----------------------------------------------------------------------------
// O modelo entrega o plano (direcao, zona, tipo de reacao esperada,
// invalidacao, alvos, validade). Este modulo calcula entrada, stop e TP1 por
// regra fixa e simula a vida da ordem. O validador de producao
// (signal-decision.ts) e o replay (scripts/) usam este mesmo modulo.
// O `triggerType` so rotula a reacao esperada; nao muda a execucao.
// Velas no formato [ts, o, h, l, c, ...] em ordem cronologica, todas fechadas.
// ============================================================================

/** Limites do motor. Recalibrar AQUI, e so aqui. */
export const PLAN_RULES = {
  /** Stop: alem da invalidacao do modelo. */
  stopBufferAtr: 0.25,
  /** Stop mais perto que isto da entrada e alargado ate aqui. */
  stopMinAtr: 0.5,
  /** Stop mais longe que isto: sem trade. */
  stopMaxAtr: 2.0,
  tp1MinR: 1.0,
  tp1CapR: 1.5,
  validDefaultCandles: 16,
  validMinCandles: 6,
  validMaxCandles: 24,
} as const;

export type TriggerType = 'zone_reaction' | 'sweep_reclaim' | 'breakout_close';
export const TRIGGER_TYPES: readonly TriggerType[] = ['zone_reaction', 'sweep_reclaim', 'breakout_close'];

export interface WatchPlan {
  direction: 'long' | 'short';
  triggerType: TriggerType;
  zoneLow: number;
  zoneHigh: number;
  invalidation: number;
  target1: number;
  target2: number | null;
  validForCandles: number;
  trigger: string;
}

export type Bar = readonly number[];

export interface PlanLevels {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  /** Distancia do stop em ATR e R do TP1. */
  riskAtr: number;
  tp1R: number;
  /** O stop pela invalidacao ficava a menos de 0,5 ATR e foi alargado. */
  stopWidened: boolean;
}

export type LevelsRejection = 'stop_out_of_range' | 'no_room';

/** Tira o ruido de ponto flutuante (104.99999999999999 -> 105). */
const precise = (v: number) => Number(v.toPrecision(10));

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Plano coerente: zona ordenada, invalidacao alem da zona e alvo do lado do trade. */
export function isValidWatchPlan(plan: WatchPlan | null | undefined): plan is WatchPlan {
  if (!plan || (plan.direction !== 'long' && plan.direction !== 'short')) return false;
  if (!TRIGGER_TYPES.includes(plan.triggerType)) return false;
  const { zoneLow, zoneHigh, invalidation, target1, target2 } = plan;
  if (![zoneLow, zoneHigh, invalidation, target1].every(positive) || zoneLow > zoneHigh) return false;
  if (target2 !== null && !positive(target2)) return false;
  if (!Number.isInteger(plan.validForCandles) || plan.validForCandles <= 0) return false;
  return plan.direction === 'long'
    ? invalidation <= zoneLow && target1 > zoneHigh && (target2 === null || target2 > target1)
    : invalidation >= zoneHigh && target1 < zoneLow && (target2 === null || target2 < target1);
}

/** Validade em velas dentro de [6, 24]; fora disso (ou ausente), o padrao. */
export function clampValidity(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return PLAN_RULES.validDefaultCandles;
  return Math.min(PLAN_RULES.validMaxCandles, Math.max(PLAN_RULES.validMinCandles, n));
}

/** Borda que o preco alcanca primeiro: a da ordem limit (compra = zoneHigh, venda = zoneLow). */
export function nearEdge(plan: WatchPlan): number {
  return plan.direction === 'long' ? plan.zoneHigh : plan.zoneLow;
}

export type PricePosition = 'before_zone' | 'inside_zone' | 'beyond_zone' | 'invalidated';

/** Onde o preco esta em relacao ao plano, no sentido do trade. */
export function pricePosition(plan: WatchPlan, price: number): PricePosition {
  const long = plan.direction === 'long';
  if (long ? price < plan.invalidation : price > plan.invalidation) return 'invalidated';
  if (price >= plan.zoneLow && price <= plan.zoneHigh) return 'inside_zone';
  return (long ? price > plan.zoneHigh : price < plan.zoneLow) ? 'before_zone' : 'beyond_zone';
}

export function closesBeyondInvalidation(plan: WatchPlan, bar: Bar): boolean {
  return plan.direction === 'long' ? bar[4] < plan.invalidation : bar[4] > plan.invalidation;
}

/**
 * Entrada, stop e alvos. Sem `entry`, a ordem limit na borda proxima; o
 * ENTER_NOW passa o preco atual. Stop = invalidacao alem de 0,25 ATR, alargado
 * ate 0,5 ATR da entrada; acima de 2,0 ATR ou TP1 abaixo de 1,0R, sem trade.
 */
export function levelsFromPlan(plan: WatchPlan, atr: number, entry: number = nearEdge(plan)): PlanLevels | LevelsRejection {
  const R = PLAN_RULES;
  const long = plan.direction === 'long';
  const fromInvalidation = long ? plan.invalidation - R.stopBufferAtr * atr : plan.invalidation + R.stopBufferAtr * atr;
  const stopWidened = Math.abs(entry - fromInvalidation) < R.stopMinAtr * atr;
  const stopLoss = stopWidened ? (long ? entry - R.stopMinAtr * atr : entry + R.stopMinAtr * atr) : fromInvalidation;
  const risk = Math.abs(entry - stopLoss);
  const riskAtr = risk / atr;
  if (riskAtr > R.stopMaxAtr) return 'stop_out_of_range';
  const room = (long ? plan.target1 - entry : entry - plan.target1) / risk;
  if (room < R.tp1MinR) return 'no_room';
  const tp1R = Math.min(room, R.tp1CapR);
  const takeProfit1 = room <= R.tp1CapR ? plan.target1 : precise(long ? entry + tp1R * risk : entry - tp1R * risk);
  const t2 = plan.target2;
  const takeProfit2 = t2 !== null && (long ? t2 > takeProfit1 : t2 < takeProfit1) ? t2 : null;
  return { entry: precise(entry), stopLoss: precise(stopLoss), takeProfit1, takeProfit2, riskAtr, tp1R, stopWidened };
}

/** Velas fechadas ate `nowMs`: a que ainda esta se formando sai. */
export function closedBars(bars: readonly Bar[], intervalMs: number, nowMs: number): Bar[] {
  return bars.filter((b) => b[0] + intervalMs <= nowMs);
}

export type Fill = { index: number; price: number };

export type OrderResult =
  | { kind: 'filled'; fill: Fill }
  | { kind: 'invalidated' }
  | { kind: 'target_before_fill' }
  | { kind: 'expired' };

/**
 * Vida da ordem limit a partir de `startMs`, em velas finas (`fine`, 1m ou
 * 5m). Vale `validForCandles` velas do tempo grafico (`tf`, passo `tfStepMs`);
 * cancela no fechamento de vela do tempo grafico alem da invalidacao e quando
 * o preco toca o target1 antes do fill. Vela que toca a entrada e o target1
 * conta como fill (o pior caso: na vela do fill so o stop conta). Gap alem da
 * entrada executa na abertura.
 */
export function runLimitOrder(
  plan: WatchPlan,
  entry: number,
  tf: readonly Bar[],
  tfStepMs: number,
  fine: readonly Bar[],
  startMs: number,
): OrderResult {
  const long = plan.direction === 'long';
  const expiresMs = startMs + plan.validForCandles * tfStepMs;
  const dead = tf.find((b) => b[0] + tfStepMs > startMs && b[0] + tfStepMs <= expiresMs && closesBeyondInvalidation(plan, b));
  const endMs = dead ? dead[0] + tfStepMs : expiresMs;
  for (let i = 0; i < fine.length; i++) {
    const [t, o, h, l] = fine[i];
    if (t < startMs) continue;
    if (t >= endMs) break;
    if (long ? l <= entry : h >= entry) {
      const gap = long ? o < entry : o > entry;
      return { kind: 'filled', fill: { index: i, price: gap ? o : entry } };
    }
    if (long ? h >= plan.target1 : l <= plan.target1) return { kind: 'target_before_fill' };
  }
  return dead ? { kind: 'invalidated' } : { kind: 'expired' };
}

/** Primeira vela fina que toca a zona entre `startMs` e `untilMs` (exclusivo); null = nao tocou. */
export function firstTouch(plan: WatchPlan, fine: readonly Bar[], startMs: number, untilMs: number): number | null {
  for (let i = 0; i < fine.length; i++) {
    const [t, , h, l] = fine[i];
    if (t < startMs) continue;
    if (t >= untilMs) break;
    if (l <= plan.zoneHigh && h >= plan.zoneLow) return i;
  }
  return null;
}

export type TrackOutcome = 'WIN' | 'LOSS' | 'TIMEOUT' | 'MISSED' | 'INVALIDATED' | 'EXPIRED' | 'NO_LEVELS' | 'NO_CANDLES';

export interface PlanTrack {
  outcome: TrackOutcome;
  /** Vela fina do primeiro toque na zona dentro da validade; null = nao tocou. */
  touchIndex: number | null;
  /** market = ENTER_NOW; o resto e a vida da ordem limit. */
  order: 'market' | OrderResult['kind'] | null;
  fill: Fill | null;
  levels: { entry: number; stopLoss: number; takeProfit1: number; stopWidened: boolean } | null;
  /** Por que nao houve niveis (stop acima de 2 ATR ou TP1 abaixo de 1R). */
  rejection: LevelsRejection | null;
  resolution: Resolution | null;
}

/**
 * A regua do replay e do rastreador de producao (28/10/2026), num lugar so:
 * toque na zona dentro da validade, a ordem (a mercado no ENTER_NOW, limit na
 * borda nos outros), o fill, TP1 x stop em `resolveMs` depois do fill
 * (stop_only), MFE e MAE em R, e o "missed" (o alvo veio antes do fill).
 * `levels` = niveis ja decididos (o sinal gravado); sem eles, saem do plano
 * com o ATR (o WATCH, que nao tem niveis).
 */
export function trackPlan(input: {
  plan: WatchPlan;
  enterNow: boolean;
  atr: number | null;
  levels?: { entry: number; stopLoss: number; takeProfit1: number } | null;
  tf: readonly Bar[];
  tfStepMs: number;
  fine: readonly Bar[];
  startMs: number;
  resolveMs: number;
}): PlanTrack {
  const { plan, tf, tfStepMs, fine, startMs } = input;
  const long = plan.direction === 'long';
  const empty = { touchIndex: null, order: null, fill: null, levels: null, rejection: null, resolution: null };
  const i0 = fine.findIndex((b) => b[0] >= startMs);
  if (i0 < 0) return { ...empty, outcome: 'NO_CANDLES' };
  const touchIndex = firstTouch(plan, fine, startMs, startMs + plan.validForCandles * tfStepMs);
  const open = fine[i0][1];

  let levels: PlanTrack['levels'] = input.levels ? { ...input.levels, stopWidened: false } : null;
  let rejection: LevelsRejection | null = null;
  let enterNow = input.enterNow;
  if (!levels && input.atr && input.atr > 0) {
    // ENTER_NOW sem 1R a partir do preco: o validador rebaixa para ARMED, segue como limit.
    const market = enterNow ? levelsFromPlan(plan, input.atr, open) : null;
    if (market && typeof market !== 'string') levels = market;
    else {
      enterNow = false;
      const limit = levelsFromPlan(plan, input.atr);
      if (typeof limit === 'string') rejection = limit;
      else levels = limit;
    }
  }
  if (!levels) return { ...empty, touchIndex, rejection, outcome: 'NO_LEVELS' };

  let fill: Fill | null = null;
  let order: PlanTrack['order'];
  if (enterNow) {
    fill = { index: i0, price: open };
    order = 'market';
  } else {
    const result = runLimitOrder(plan, levels.entry, tf, tfStepMs, fine, startMs);
    order = result.kind;
    if (result.kind === 'filled') fill = result.fill;
  }
  if (!fill) {
    const outcome: TrackOutcome = order === 'target_before_fill' ? 'MISSED' : order === 'invalidated' ? 'INVALIDATED' : 'EXPIRED';
    return { outcome, touchIndex, order, fill: null, levels, rejection: null, resolution: null };
  }
  const resolution = resolveTp1(fine, long, fill, levels.stopLoss, levels.takeProfit1, fine[fill.index][0] + input.resolveMs);
  return { outcome: resolution.outcome, touchIndex, order, fill, levels, rejection: null, resolution };
}

export interface Resolution {
  outcome: 'WIN' | 'LOSS' | 'TIMEOUT';
  /** Vela da resolucao (ou a ultima olhada no TIMEOUT). */
  index: number;
  /** TP1 e stop na mesma vela: conta como stop. */
  sameCandle: boolean;
  /** Excursao maxima a favor e contra, em R, ate a resolucao. */
  mfeR: number;
  maeR: number;
}

/**
 * TP1 contra stop a partir da vela da execucao. Na propria vela da execucao
 * so o stop conta (a ordem do intrabar e desconhecida); TP1 e stop na mesma
 * vela depois dela tambem contam como stop.
 */
export function resolveTp1(
  bars: readonly Bar[],
  long: boolean,
  fill: Fill,
  stopLoss: number,
  takeProfit1: number,
  untilMs: number,
): Resolution {
  const risk = Math.abs(fill.price - stopLoss);
  let mfe = 0;
  let mae = 0;
  let last = fill.index;
  for (let i = fill.index; i < bars.length && bars[i][0] < untilMs; i++) {
    const [, , h, l] = bars[i];
    last = i;
    mfe = Math.max(mfe, (long ? h - fill.price : fill.price - l) / risk);
    mae = Math.max(mae, (long ? fill.price - l : h - fill.price) / risk);
    const hitStop = long ? l <= stopLoss : h >= stopLoss;
    const hitTp = long ? h >= takeProfit1 : l <= takeProfit1;
    if (hitStop) return { outcome: 'LOSS', index: i, sameCandle: hitTp, mfeR: mfe, maeR: mae };
    if (hitTp && i > fill.index) return { outcome: 'WIN', index: i, sameCandle: false, mfeR: mfe, maeR: mae };
  }
  return { outcome: 'TIMEOUT', index: last, sameCandle: false, mfeR: mfe, maeR: mae };
}
