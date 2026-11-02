// ============================================================================
// MOTOR DO PLANO DO v11 (02/11/2026): GEOMETRIA, MATURIDADE E A REGUA
// ----------------------------------------------------------------------------
// O modelo entrega o plano (direcao, zona, tipo de reacao, invalidacao, alvos,
// validade). Este modulo, puro, faz as contas que decidem o estado no
// validador (signal-decision.ts): encaixe da invalidacao na swing real, stop
// operacional, as duas entradas (a mercado e no nivel do plano) e se o movimento esta
// atrasado. Tambem e a regua do replay e do rastreador de producao (trackPlan).
// TODAS as constantes do motor e do validador moram em ENGINE_RULES.
// Velas no formato [ts, o, h, l, c, ...] em ordem cronologica, todas fechadas.
// ============================================================================

/** Limites do motor e do validador. Recalibrar AQUI, e so aqui. */
export const ENGINE_RULES = {
  /**
   * Invalidacao estrutural: a swing fractal real entre o preco atual e a
   * invalidacao do modelo, a ate esta distancia (ATR) dela; sem swing nesse
   * intervalo, NO_TRADE.
   */
  invalidationSnapAtr: 0.5,
  /** Margem do stop alem da invalidacao quando o par e o regime nao tem calibracao (STOP_MARGIN_P80). */
  stopMarginAtr: 0.25,
  /** Risco da entrada: abaixo do minimo o stop e alargado ate ele; acima do maximo, entrada invalida. */
  riskMinAtr: 0.5,
  riskMaxAtr: 2.0,
  /** target1 a pelo menos isto do risco para a entrada valer; TP1 limitado ao teto. */
  tp1MinR: 1.0,
  tp1CapR: 1.5,
  /** Itens do checklist exigidos em PASS por estado. */
  enterNowChecks: [2, 3, 6, 7],
  watchChecks: [3],
  /** PASS minimos do ENTER_NOW. */
  minPass: 5,
  /** PASS a mais com qualquer agravante (forex, contra o 4h, venda com deriva de alta); nunca se somam. */
  aggravatedExtraPass: 1,
  /** Abaixo disto nem o WATCH fica (o "fewer than 4 PASS" do prompt). */
  minPassWatch: 4,
  /** Movimento atrasado: pernas completas na direcao, ou uma vela fechada com range acima disto (ATR). */
  lateCompletedLegs: 3,
  lateCandleAtr: 2.0,
  /** Validade do plano em velas do tempo grafico. */
  validDefaultCandles: 16,
  validMinCandles: 6,
  validMaxCandles: 24,
  /** Preco real a mais que isto (ATR) do preco lido no print = print desatualizado. */
  stalePrintAtr: 1,
  confidenceCap: 72,
  confidenceCapWeakTrend: 58,
  confidenceCapModerateTrend: 68,
  confidenceCapNoSignal: 49,
  /** probabilityTp1 fica a no maximo isto da confianca. */
  probabilityTp1Band: 3,
} as const;

/**
 * Margem do stop alem da invalidacao, em ATR: o P80 de quanto o preco passou
 * da swing antes de respeita-la, por par e regime (`<par>:<tendencia do 4h>`,
 * ex. `XAUUSD:uptrend`). Par ou regime sem medicao usa ENGINE_RULES.stopMarginAtr.
 * Vazio ate existir a calibracao medida.
 */
export const STOP_MARGIN_P80: Readonly<Record<string, number>> = {};

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
export type Swing = { i: number; kind: 'high' | 'low'; price: number };

export interface EntryLevels {
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

/** Por que uma entrada nao vale. `not_pullback`: a borda nao esta entre o preco e a invalidacao. */
export type EntryRejection = 'wrong_side' | 'stop_out_of_range' | 'no_room' | 'not_pullback';

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
  if (!Number.isFinite(n) || n <= 0) return ENGINE_RULES.validDefaultCandles;
  return Math.min(ENGINE_RULES.validMaxCandles, Math.max(ENGINE_RULES.validMinCandles, n));
}

/** Borda que o preco alcanca primeiro: o nivel do plano (compra = zoneHigh, venda = zoneLow). */
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

/** Swings por fractal de 2 velas (o extremo das 2 de cada lado), em ordem cronologica. */
export function fractalSwings(bars: readonly Bar[]): Swing[] {
  const out: Swing[] = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const near = bars.slice(i - 2, i + 3);
    if (bars[i][2] === Math.max(...near.map((b) => b[2]))) out.push({ i, kind: 'high', price: bars[i][2] });
    if (bars[i][3] === Math.min(...near.map((b) => b[3]))) out.push({ i, kind: 'low', price: bars[i][3] });
  }
  return out;
}

/**
 * Invalidacao estrutural: a swing real do mesmo lado (fundo na compra, topo
 * na venda) ENTRE o preco atual e a invalidacao do modelo, a ate 0,5 ATR dela;
 * havendo mais de uma, a mais proxima da invalidacao do modelo. null sem swing
 * nesse intervalo. A zona e recortada para nao atravessar a invalidacao nova
 * (com a swing acima da zona, numa compra, a zona encolhe ate ela e o nivel
 * deixa de valer; a entrada a mercado continua avaliada).
 */
export function snapInvalidation(
  plan: WatchPlan,
  swings: readonly Pick<Swing, 'kind' | 'price'>[],
  atr: number,
  price: number,
): WatchPlan | null {
  const long = plan.direction === 'long';
  const kind = long ? 'low' : 'high';
  const reach = ENGINE_RULES.invalidationSnapAtr * atr;
  let best: number | null = null;
  for (const s of swings) {
    const between = long ? s.price >= plan.invalidation && s.price <= price : s.price <= plan.invalidation && s.price >= price;
    const d = Math.abs(s.price - plan.invalidation);
    if (s.kind === kind && between && d <= reach && (best === null || d < Math.abs(best - plan.invalidation))) best = s.price;
  }
  if (best === null) return null;
  const zoneLow = long ? Math.max(plan.zoneLow, best) : Math.min(plan.zoneLow, Math.min(plan.zoneHigh, best));
  const zoneHigh = long ? Math.max(plan.zoneHigh, zoneLow) : Math.min(plan.zoneHigh, best);
  return { ...plan, invalidation: best, zoneLow, zoneHigh };
}

/** Margem do stop em ATR: o P80 calibrado do par e do regime, ou o padrao. */
export function stopMarginAtr(pair: string | null, regime: string | null): number {
  return (pair && regime ? STOP_MARGIN_P80[`${pair}:${regime}`] : undefined) ?? ENGINE_RULES.stopMarginAtr;
}

/**
 * Niveis de uma entrada: stop operacional = invalidacao estrutural alem da
 * margem, alargado ate 0,5 ATR da entrada; risco acima de 2,0 ATR ou target1
 * abaixo de 1,0R invalidam. TP1 = target1 limitado a 1,5R a partir da entrada.
 */
export function entryLevels(plan: WatchPlan, atr: number, entry: number, marginAtr: number = ENGINE_RULES.stopMarginAtr): EntryLevels | EntryRejection {
  const R = ENGINE_RULES;
  const long = plan.direction === 'long';
  if (long ? entry <= plan.invalidation : entry >= plan.invalidation) return 'wrong_side';
  const fromInvalidation = long ? plan.invalidation - marginAtr * atr : plan.invalidation + marginAtr * atr;
  const stopWidened = Math.abs(entry - fromInvalidation) < R.riskMinAtr * atr;
  const stopLoss = stopWidened ? (long ? entry - R.riskMinAtr * atr : entry + R.riskMinAtr * atr) : fromInvalidation;
  const risk = Math.abs(entry - stopLoss);
  const riskAtr = risk / atr;
  if (riskAtr > R.riskMaxAtr) return 'stop_out_of_range';
  const room = (long ? plan.target1 - entry : entry - plan.target1) / risk;
  if (room < R.tp1MinR) return 'no_room';
  const tp1R = Math.min(room, R.tp1CapR);
  const takeProfit1 = room <= R.tp1CapR ? plan.target1 : precise(long ? entry + tp1R * risk : entry - tp1R * risk);
  const t2 = plan.target2;
  const takeProfit2 = t2 !== null && (long ? t2 > takeProfit1 : t2 < takeProfit1) ? t2 : null;
  return { entry: precise(entry), stopLoss: precise(stopLoss), takeProfit1, takeProfit2, riskAtr, tp1R, stopWidened };
}

/**
 * Entrada no nivel do plano (borda proxima da zona), so quando ele fica entre
 * o preco e a invalidacao (recuo): e o nivel que destrava o WATCH. Preco
 * dentro ou alem da zona nao tem esse nivel.
 */
export function limitEntryLevels(plan: WatchPlan, atr: number, price: number, marginAtr?: number): EntryLevels | EntryRejection {
  const edge = nearEdge(plan);
  if (plan.direction === 'long' ? edge >= price : edge <= price) return 'not_pullback';
  return entryLevels(plan, atr, edge, marginAtr);
}

/**
 * Movimento atrasado na direcao, pelas velas fechadas do tempo grafico: tres
 * ou mais pernas completas (topos e fundos subindo, na compra), a perna atual
 * tao longa quanto a maior anterior, ou uma das 3 ultimas velas com range
 * acima de 2 ATR fechando a favor (parabolica).
 */
export function moveIsLate(bars: readonly Bar[], atr: number, direction: WatchPlan['direction']): boolean {
  if (bars.length < 5 || !(atr > 0)) return false;
  const long = direction === 'long';
  const last = bars[bars.length - 1];
  const parabolic = bars.slice(-3).some((b) => b[2] - b[3] >= ENGINE_RULES.lateCandleAtr * atr && (long ? b[4] > b[1] : b[4] < b[1]));
  if (parabolic) return true;
  // Swings alternados (dois iguais seguidos: fica o mais extremo).
  const alt: Swing[] = [];
  for (const s of fractalSwings(bars)) {
    const prev = alt[alt.length - 1];
    if (prev && prev.kind === s.kind) {
      if (s.kind === 'high' ? s.price > prev.price : s.price < prev.price) alt[alt.length - 1] = s;
    } else alt.push(s);
  }
  // Pernas a favor (fundo -> topo na compra) enquanto a estrutura segue na direcao.
  const start = long ? 'low' : 'high';
  const legs: number[] = [];
  for (let k = alt.length - 1; k >= 1; k--) {
    const [a, b] = [alt[k - 1], alt[k]];
    if (a.kind !== start) continue;
    const prevSame = alt.slice(0, k - 1).reverse().find((s) => s.kind === start);
    legs.unshift(Math.abs(b.price - a.price));
    // A perna anterior so conta se a estrutura continuou (fundo mais alto na compra).
    if (!prevSame || (long ? a.price <= prevSame.price : a.price >= prevSame.price)) break;
  }
  if (legs.length >= ENGINE_RULES.lateCompletedLegs) return true;
  // Perna atual: do ultimo extremo contrario ao preco de agora.
  const origin = [...alt].reverse().find((s) => s.kind === start);
  const current = origin ? (long ? last[4] - origin.price : origin.price - last[4]) : 0;
  const lastAlt = alt[alt.length - 1];
  const priorLegs = lastAlt && lastAlt.kind === start ? legs : legs.slice(0, -1);
  return priorLegs.length > 0 && current >= Math.max(...priorLegs);
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
  /** Por que nao houve niveis (entrada invalida pela geometria). */
  rejection: EntryRejection | null;
  resolution: Resolution | null;
}

/**
 * A regua do replay e do rastreador de producao, num lugar so: toque na zona
 * dentro da validade, a ordem (a mercado no ENTER_NOW, limit na borda nos
 * outros), o fill, TP1 x stop em `resolveMs` depois do fill (stop_only), MFE
 * e MAE em R, e o "missed" (o alvo veio antes do fill). `levels` = niveis ja
 * decididos (o sinal gravado); sem eles, saem do plano com o ATR (o WATCH,
 * que nao tem niveis): a mercado no ENTER_NOW, limit na borda no resto.
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
  let rejection: EntryRejection | null = null;
  if (!levels && input.atr && input.atr > 0) {
    const computed = input.enterNow ? entryLevels(plan, input.atr, open) : entryLevels(plan, input.atr, nearEdge(plan));
    if (typeof computed === 'string') rejection = computed;
    else levels = computed;
  }
  if (!levels) return { ...empty, touchIndex, rejection, outcome: 'NO_LEVELS' };

  let fill: Fill | null = null;
  let order: PlanTrack['order'];
  if (input.enterNow) {
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
