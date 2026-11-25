/**
 * Motor de entrada pelas velas (23/11/2026). A direcao vem do codigo, pelas
 * velas fechadas; a IA confirma ou veta com motivo nomeado. Para a direcao, o
 * codigo testa tres entradas (agora, no recuo, no rompimento) com os mesmos
 * limites do validador e mostra a melhor que fecha. Puro: sem rede, sem banco.
 */
import { ENGINE_RULES, type WatchPlan } from './plan-engine';

export type Direction = 'long' | 'short';
export type HtfTrendView = 'uptrend' | 'downtrend' | 'range';
export type EntryKind = 'now' | 'pullback' | 'breakout';

/** O que as velas dizem, ja calculado no grounding. */
export interface CandleView {
  price: number;
  atr: number;
  /** Swings fractais das velas fechadas, da mais antiga para a mais recente. */
  swings: readonly { kind: 'high' | 'low'; price: number }[];
  htfTrend: HtfTrendView | null;
  htfVsEma50: 'above' | 'below' | null;
  /** Fechamento do tempo grafico contra a EMA50 dele. */
  vsEma50: 'above' | 'below' | null;
  rangePosPct: number | null;
  windowHigh: number | null;
  windowLow: number | null;
  late: { long: boolean; short: boolean } | null;
  /** Tempos usados (grafico, direcao, setup); so informativo. */
  timeframes?: TimeframeLadder | null;
}

export interface CandleBias {
  direction: Direction | 'neutral';
  /** Soma dos votos: estrutura e 4h valem 1, cada EMA50 vale 0,5. */
  score: number;
  structure: 'up' | 'down' | 'mixed' | null;
  htfTrend: HtfTrendView | null;
  vsEma50: 'above' | 'below' | null;
  htfVsEma50: 'above' | 'below' | null;
  /** Preco esticado na direcao: movimento atrasado ou no extremo da janela. */
  stretched: boolean;
  /** Escada de tempos (23/11/2026): o do grafico, o de direcao (htfTrend) e o de setup. */
  timeframes?: TimeframeLadder | null;
}

/**
 * Escada de tempos (Elder, fator 4 a 6). O vies usa a tendencia do tempo de
 * DIRECAO; o de setup e so informativo. Antes de 23/11/2026 era o 4h fixo.
 */
export interface TimeframeLadder {
  chart: string;
  direction: string;
  setup: string;
}

const LADDER: Record<string, { direction: string; setup: string }> = {
  '1m': { direction: '15m', setup: '5m' },
  '3m': { direction: '15m', setup: '5m' },
  '5m': { direction: '1h', setup: '15m' },
  '15m': { direction: '4h', setup: '1h' },
  '30m': { direction: '4h', setup: '1h' },
  '1h': { direction: '1d', setup: '4h' },
  '2h': { direction: '1d', setup: '4h' },
  '4h': { direction: '1w', setup: '1d' },
  '6h': { direction: '1w', setup: '1d' },
  '1d': { direction: '1w', setup: '1d' },
};

/** Tempo de direcao e de setup para o tempo grafico do print; null = sem escada (semanal ou desconhecido). */
export function timeframeLadder(chart: string | null | undefined): TimeframeLadder | null {
  const step = chart ? LADDER[chart] : undefined;
  return step && chart ? { chart, ...step } : null;
}

export const BIAS_RULES = {
  /** Pontos a partir dos quais o vies e forte (com a tendencia do tempo de direcao junto). */
  strongScore: 2,
  /** Pontos para a direcao valer (de 3). Backtest de 23/11/2026 (6.090 momentos, cripto 15m e 1h): 1 deixa 27% neutro. */
  minScore: 1,
  /** Posicao no range que conta como esticado (compra acima, venda abaixo de 100 - isto). */
  stretchedRangePct: 85,
  /** Recuo: nivel entre esta distancia minima e a maxima do preco (ATR). */
  pullbackMinAtr: 0.3,
  pullbackMaxAtr: 3,
  /** Rompimento: nivel a ate esta distancia (ATR); entrada alem dele pela folga. */
  breakoutMaxAtr: 1.5,
  breakoutBufferAtr: 0.1,
  /** Stop no primeiro swing que deixe ao menos este risco (ATR); abaixo disso o ruido do tempo grafico pega. */
  minStopAtr: 1,
  /** Largura da zona do recuo (ATR). */
  pullbackZoneAtr: 0.25,
} as const;

const sign = (d: Direction) => (d === 'long' ? 1 : -1);
const precise = (v: number) => Number(v.toPrecision(10));

function structureOf(swings: CandleView['swings']): CandleBias['structure'] {
  const highs = swings.filter((s) => s.kind === 'high').slice(-2).map((s) => s.price);
  const lows = swings.filter((s) => s.kind === 'low').slice(-2).map((s) => s.price);
  if (highs.length < 2 || lows.length < 2) return null;
  if (highs[1] > highs[0] && lows[1] > lows[0]) return 'up';
  if (highs[1] < highs[0] && lows[1] < lows[0]) return 'down';
  return 'mixed';
}

/** Vies pelas velas: estrutura de swings confirmados, 4h, EMA50 do grafico e do 4h. */
export function candleBias(view: CandleView, minScore: number = BIAS_RULES.minScore): CandleBias {
  const structure = structureOf(view.swings);
  const vote = (up: boolean, down: boolean, w: number) => (up ? w : down ? -w : 0);
  const score =
    vote(structure === 'up', structure === 'down', 1) +
    vote(view.htfTrend === 'uptrend', view.htfTrend === 'downtrend', 1) +
    vote(view.vsEma50 === 'above', view.vsEma50 === 'below', 0.5) +
    vote(view.htfVsEma50 === 'above', view.htfVsEma50 === 'below', 0.5);
  let direction: CandleBias['direction'] = 'neutral';
  if (score >= minScore && structure !== 'down') direction = 'long';
  else if (score <= -minScore && structure !== 'up') direction = 'short';
  const pos = view.rangePosPct;
  const stretched =
    direction === 'long'
      ? !!view.late?.long || (pos !== null && pos >= BIAS_RULES.stretchedRangePct)
      : direction === 'short'
        ? !!view.late?.short || (pos !== null && pos <= 100 - BIAS_RULES.stretchedRangePct)
        : false;
  return { direction, score, structure, htfTrend: view.htfTrend, vsEma50: view.vsEma50, htfVsEma50: view.htfVsEma50, stretched, timeframes: view.timeframes ?? null };
}

/**
 * Vies forte (23/11/2026): pontuacao a partir de `strongScore` E a estrutura do
 * tempo de direcao (htfTrend, topos e fundos do tempo maior) na mesma direcao.
 * So o vies forte desempata leituras divergentes ou segura um ENTER_NOW de um leitor.
 */
export function isStrongBias(bias: Pick<CandleBias, 'direction' | 'score' | 'htfTrend'>): boolean {
  if (bias.direction === 'neutral') return false;
  return Math.abs(bias.score) >= BIAS_RULES.strongScore && bias.htfTrend === (bias.direction === 'long' ? 'uptrend' : 'downtrend');
}

/**
 * Filtro de tendencia (23/11/2026): o tempo de direcao em tendencia e o preco do
 * grafico do mesmo lado da EMA50 = nada de entrada contra (nem no recuo); so
 * rompimento com fechamento ou aguardar.
 */
export function againstTrend(view: Pick<CandleView, 'htfTrend' | 'vsEma50'>, d: Direction): boolean {
  if (d === 'long') return view.htfTrend === 'downtrend' && view.vsEma50 === 'below';
  return view.htfTrend === 'uptrend' && view.vsEma50 === 'above';
}

export interface EntryPlan {
  kind: EntryKind;
  direction: Direction;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  /** Nivel de referencia: o suporte do recuo ou o nivel do rompimento; o preco no "agora". */
  level: number;
  /** Swing que segura o stop. */
  invalidation: number;
  riskAtr: number;
  tp1R: number;
  stopWidened: boolean;
  /** TP1 no proximo nivel porque o primeiro ficava abaixo do minimo de R. */
  targetMoved: boolean;
}

export type EntryRejection = 'stretched' | 'no_swing' | 'stop_out_of_range' | 'no_room' | 'no_level';

export interface EntryOptions {
  marginAtr?: number;
  tp1MinR?: number;
  /** Stop no primeiro swing atras da entrada que deixe pelo menos este risco (ATR). */
  minStopAtr?: number;
}

/** Niveis conhecidos da janela: swings e extremos, sem repetir. */
function knownLevels(view: CandleView): number[] {
  const all = [...view.swings.map((s) => s.price), view.windowHigh, view.windowLow].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
  );
  return [...new Set(all)];
}

/** Swing estrutural mais proximo atras de `basis` (inclusive o proprio nivel) e o stop cru alem dele. */
function stopFor(view: CandleView, d: Direction, basis: number, marginAtr: number, entry: number, minStopAtr: number) {
  const s = sign(d);
  const behind = view.swings
    .filter((w) => w.kind === (d === 'long' ? 'low' : 'high') && s * (basis - w.price) >= 0)
    .map((w) => w.price)
    .sort((a, b) => s * (b - a));
  if (!behind.length) return null;
  const raw = (v: number) => v - s * marginAtr * view.atr;
  // O primeiro swing que deixa o stop fora do ruido do tempo grafico; passou do teto, a conta nao fecha.
  const invalidation = behind.find((v) => Math.abs(entry - raw(v)) >= minStopAtr * view.atr) ?? behind[0];
  return { invalidation, raw: raw(invalidation) };
}

function levelsFor(
  view: CandleView, d: Direction, entry: number, opts: EntryOptions, stopFrom: number = entry,
): Omit<EntryPlan, 'kind' | 'level'> | EntryRejection {
  const s = sign(d);
  const margin = opts.marginAtr ?? ENGINE_RULES.stopMarginAtr;
  const minR = opts.tp1MinR ?? ENGINE_RULES.tp1MinR;
  const stop = stopFor(view, d, stopFrom, margin, entry, opts.minStopAtr ?? BIAS_RULES.minStopAtr);
  if (!stop) return 'no_swing';
  const widened = Math.abs(entry - stop.raw) < ENGINE_RULES.riskMinAtr * view.atr;
  const stopLoss = widened ? entry - s * ENGINE_RULES.riskMinAtr * view.atr : stop.raw;
  const risk = Math.abs(entry - stopLoss);
  const riskAtr = risk / view.atr;
  if (riskAtr > ENGINE_RULES.riskMaxAtr) return 'stop_out_of_range';
  const ahead = knownLevels(view)
    .filter((v) => s * (v - entry) > 0)
    .sort((a, b) => s * (a - b));
  let tp1R: number;
  let targetMoved = false;
  let nextIndex: number;
  if (!ahead.length) {
    // Preco no extremo conhecido: sem nivel a frente, o alvo e o teto.
    tp1R = ENGINE_RULES.tp1CapR;
    nextIndex = 0;
  } else {
    const first = ahead.findIndex((v) => (s * (v - entry)) / risk >= minR);
    if (first < 0) return 'no_room';
    targetMoved = first > 0;
    tp1R = Math.min((s * (ahead[first] - entry)) / risk, ENGINE_RULES.tp1CapR);
    nextIndex = first + 1;
  }
  const takeProfit1 = precise(entry + s * tp1R * risk);
  const beyond = ahead.slice(nextIndex).find((v) => s * (v - takeProfit1) > 0);
  return {
    direction: d,
    entry: precise(entry),
    stopLoss: precise(stopLoss),
    takeProfit1,
    takeProfit2: beyond === undefined ? null : precise(beyond),
    invalidation: stop.invalidation,
    riskAtr,
    tp1R,
    stopWidened: widened,
    targetMoved,
  };
}

/** Entrada a mercado no preco atual. Preco esticado nao entra agora. */
export function nowEntry(view: CandleView, d: Direction, stretched: boolean, opts: EntryOptions = {}): EntryPlan | EntryRejection {
  if (stretched) return 'stretched';
  const r = levelsFor(view, d, view.price, opts);
  return typeof r === 'string' ? r : { ...r, kind: 'now', level: view.price };
}

/** Recuo ao suporte (compra) ou resistencia (venda) mais proximo que fecha a conta. */
export function pullbackEntry(view: CandleView, d: Direction, opts: EntryOptions = {}): EntryPlan | EntryRejection {
  const s = sign(d);
  const candidates = knownLevels(view)
    .filter((v) => {
      const dist = (s * (view.price - v)) / view.atr;
      return dist >= BIAS_RULES.pullbackMinAtr && dist <= BIAS_RULES.pullbackMaxAtr;
    })
    .sort((a, b) => s * (b - a));
  if (!candidates.length) return 'no_level';
  let last: EntryRejection = 'no_level';
  for (const level of candidates) {
    const r = levelsFor(view, d, level, opts);
    if (typeof r !== 'string') return { ...r, kind: 'pullback', level };
    last = r;
  }
  return last;
}

/** Rompimento: nivel logo a frente; entrada depois de um FECHAMENTO alem dele. */
export function breakoutEntry(view: CandleView, d: Direction, opts: EntryOptions = {}): EntryPlan | EntryRejection {
  const s = sign(d);
  const level = knownLevels(view)
    .filter((v) => {
      const dist = (s * (v - view.price)) / view.atr;
      return dist > 0 && dist <= BIAS_RULES.breakoutMaxAtr;
    })
    .sort((a, b) => s * (a - b))[0];
  if (level === undefined) return 'no_level';
  const entry = level + s * BIAS_RULES.breakoutBufferAtr * view.atr;
  // O stop fica atras da estrutura que existe HOJE (abaixo do preco na compra).
  const r = levelsFor(view, d, entry, opts, view.price);
  return typeof r === 'string' ? r : { ...r, kind: 'breakout', level };
}

export interface EntryChoice {
  best: EntryPlan | null;
  now: EntryPlan | EntryRejection;
  pullback: EntryPlan | EntryRejection;
  breakout: EntryPlan | EntryRejection;
}

/** Agora (se nao esticado), senao recuo, senao rompimento: a primeira que fecha. */
export function chooseEntry(view: CandleView, d: Direction, stretched: boolean, opts: EntryOptions = {}): EntryChoice {
  const now = nowEntry(view, d, stretched, opts);
  const pullback = pullbackEntry(view, d, opts);
  const breakout = breakoutEntry(view, d, opts);
  const best = [now, pullback, breakout].find((e): e is EntryPlan => typeof e !== 'string') ?? null;
  return { best, now, pullback, breakout };
}

/** Plano do WATCH (recuo ou rompimento) no formato que o rastreador e as telas leem. */
export function watchPlanOf(plan: EntryPlan, atr: number, validForCandles: number = ENGINE_RULES.validDefaultCandles): WatchPlan {
  const s = sign(plan.direction);
  const long = plan.direction === 'long';
  if (plan.kind === 'breakout') {
    const [zoneLow, zoneHigh] = long ? [plan.level, plan.entry] : [plan.entry, plan.level];
    return {
      direction: plan.direction, triggerType: 'breakout_close', zoneLow, zoneHigh,
      invalidation: plan.stopLoss, target1: plan.takeProfit1, target2: plan.takeProfit2, validForCandles,
      trigger: `${long ? 'Close above' : 'Close below'} ${plan.level}`,
    };
  }
  const far = precise(plan.entry - s * BIAS_RULES.pullbackZoneAtr * atr);
  const edgeFar = long ? Math.max(far, plan.stopLoss) : Math.min(far, plan.stopLoss);
  const [zoneLow, zoneHigh] = long ? [edgeFar, plan.entry] : [plan.entry, edgeFar];
  return {
    direction: plan.direction, triggerType: 'zone_reaction', zoneLow, zoneHigh,
    invalidation: plan.stopLoss, target1: plan.takeProfit1, target2: plan.takeProfit2, validForCandles,
    trigger: `${long ? 'Pullback to' : 'Rally to'} ${plan.entry}`,
  };
}

// ---------------------------------------------------------------------------
// Voto dos leitores
// ---------------------------------------------------------------------------

/** Motivos que a IA pode dar para vetar. Stop e alvo nunca: isso e conta do codigo. */
export const VETO_REASONS = ['news', 'structure_broken', 'stale_print', 'not_a_chart', 'unclear_chart', 'conflicting_signals'] as const;
export type VetoReason = (typeof VETO_REASONS)[number];

export interface ReaderOutcome {
  state: string;
  direction: Direction | 'neutral';
}

const key = (o: ReaderOutcome) => `${o.state}|${o.direction}`;

/** Maioria de estado e direcao; null sem maioria. */
export function majorityOf(outcomes: readonly ReaderOutcome[]): { outcome: ReaderOutcome; count: number } | null {
  const counts = new Map<string, { outcome: ReaderOutcome; count: number }>();
  for (const o of outcomes) {
    const k = key(o);
    const cur = counts.get(k);
    counts.set(k, { outcome: o, count: (cur?.count ?? 0) + 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  if (!best) return null;
  return best.count * 2 > outcomes.length ? best : null;
}

export function sameOutcome(a: ReaderOutcome, b: ReaderOutcome): boolean {
  return key(a) === key(b);
}

/** O que cada leitor pediu (antes do codigo) e o que o codigo decidiu com a leitura dele. */
export interface ReaderVote {
  raw: { state: string; direction: Direction | null };
  outcome: ReaderOutcome;
}

export type VoteDecidedBy = 'majority' | 'candle_bias' | 'single' | 'no_majority';

export interface VoteResolution {
  decidedBy: VoteDecidedBy;
  /** Indice do leitor cuja resposta vira a analise. */
  chosen: number;
  /** Leitura sintetica do desempate (direcao do vies forte); undefined = a do leitor escolhido. */
  tieRead?: { direction: Direction; veto: null };
  /** undefined = a decisao do leitor escolhido vale como esta (maioria). */
  allowNow?: boolean;
  noMajority?: boolean;
  /** Algum leitor usado disse NO_TRADE: o estado final vai no maximo a WATCH (25/11/2026). */
  capWatch?: boolean;
}

/**
 * Voto dos leitores (23/11/2026, filter-2026-11-23; 25/11/2026, filter-2026-11-25:
 * leitor usado com NO_TRADE limita o estado final a WATCH, mesmo com vies forte). Maioria (estado e direcao) =
 * a decisao dela. Sem maioria: so o vies FORTE desempata (`isStrongBias`), e o
 * agora so com 1 leitor que pediu ENTER_NOW nessa direcao; sem vies forte,
 * aguardar com "leituras divergentes". Um leitor so: a leitura dele, agora so
 * com o vies forte na mesma direcao. Nunca promove WATCH/NO_TRADE a ENTER_NOW.
 */
export function resolveVote(votes: readonly ReaderVote[], bias: CandleBias | null): VoteResolution {
  const vote = resolveVoteUncapped(votes, bias);
  return votes.some((v) => v.raw.state === 'NO_TRADE') ? { ...vote, allowNow: false, capWatch: true } : vote;
}

function resolveVoteUncapped(votes: readonly ReaderVote[], bias: CandleBias | null): VoteResolution {
  const strongDir = bias && isStrongBias(bias) && bias.direction !== 'neutral' ? bias.direction : null;
  if (votes.length >= 2) {
    const majority = majorityOf(votes.map((v) => v.outcome));
    if (majority) return { decidedBy: 'majority', chosen: votes.findIndex((v) => sameOutcome(v.outcome, majority.outcome)) };
    if (!bias) return { decidedBy: 'single', chosen: 0 };
    if (strongDir) {
      const inDir = votes.findIndex((v) => v.raw.direction === strongDir);
      return {
        decidedBy: 'candle_bias',
        chosen: inDir >= 0 ? inDir : 0,
        tieRead: { direction: strongDir, veto: null },
        allowNow: votes.some((v) => v.raw.state === 'ENTER_NOW' && v.raw.direction === strongDir),
      };
    }
    return { decidedBy: 'no_majority', chosen: 0, noMajority: true };
  }
  const only = votes[0];
  if (!bias || !only) return { decidedBy: 'single', chosen: 0 };
  return { decidedBy: 'single', chosen: 0, allowNow: only.raw.state === 'ENTER_NOW' && !!strongDir && only.raw.direction === strongDir };
}

/**
 * Leitor cuja prosa e checklist vao para a tela (25/11/2026): o que pediu o
 * mesmo estado da decisao final (na mesma direcao, se ela tiver direcao); se
 * nenhum, o da mesma direcao; empate, o primeiro. null = nenhum bate e a tela
 * mostra so o resumo do codigo.
 */
export function pickDisplayReader(
  readers: readonly { label: string; raw: { state: string; direction: Direction | null } }[],
  final: { state: string; direction: Direction | 'neutral' },
): string | null {
  const directional = final.direction !== 'neutral';
  const sameState = readers.find((r) => r.raw.state === final.state && (!directional || r.raw.direction === final.direction));
  if (sameState) return sameState.label;
  const sameDirection = directional ? readers.find((r) => r.raw.direction === final.direction) : undefined;
  return sameDirection?.label ?? null;
}

// ---------------------------------------------------------------------------
// Resumo pelo codigo: a tela monta a frase a partir disto, nos 6 idiomas.
// ---------------------------------------------------------------------------

export type SummaryAction =
  | 'buy_now' | 'sell_now' | 'buy_pullback' | 'sell_pullback' | 'buy_breakout' | 'sell_breakout' | 'wait';

/** Por que aguardar. Nenhum motivo fala de stop ou alvo do modelo. */
export type WaitReason =
  | 'neutral_direction' | 'conflicting_direction' | 'no_geometry' | 'no_majority' | 'news_event'
  | 'stale_print' | 'no_data' | 'against_trend' | `veto_${VetoReason}`;

export interface CodeSummary {
  action: SummaryAction;
  waitReason: WaitReason | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  /** Nivel de referencia: recuo ou rompimento. */
  level: number | null;
  /** No aguardar: o que faria virar operacao (fechamento alem destes niveis). */
  turnsBuyAbove: number | null;
  turnsSellBelow: number | null;
  /** A direcao virou por invalidacao fechada do plano anterior do setup. */
  flippedFromPrior: boolean;
  /** O plano anterior do setup nao prende esta leitura: nasceu de desempate fraco ou o vies virou forte contra. */
  priorUnderPressure?: boolean;
}

export function actionOf(plan: Pick<EntryPlan, 'kind' | 'direction'> | null): SummaryAction {
  if (!plan) return 'wait';
  const side = plan.direction === 'long' ? 'buy' : 'sell';
  return `${side}_${plan.kind}` as SummaryAction;
}

/** Niveis mais proximos acima e abaixo do preco: o que destrava uma operacao no aguardar. */
export function nearestLevels(view: CandleView): { above: number | null; below: number | null } {
  const levels = knownLevels(view);
  const above = levels.filter((v) => v > view.price).sort((a, b) => a - b)[0] ?? null;
  const below = levels.filter((v) => v < view.price).sort((a, b) => b - a)[0] ?? null;
  return { above, below };
}

export function buildCodeSummary(input: {
  plan: EntryPlan | null;
  waitReason: WaitReason | null;
  view: CandleView | null;
  flippedFromPrior?: boolean;
  priorUnderPressure?: boolean;
}): CodeSummary {
  const { plan } = input;
  const near = !plan && input.view ? nearestLevels(input.view) : { above: null, below: null };
  return {
    action: input.waitReason ? 'wait' : actionOf(plan),
    waitReason: plan && !input.waitReason ? null : input.waitReason ?? 'no_data',
    entry: plan && !input.waitReason ? plan.entry : null,
    stopLoss: plan && !input.waitReason ? plan.stopLoss : null,
    takeProfit1: plan && !input.waitReason ? plan.takeProfit1 : null,
    takeProfit2: plan && !input.waitReason ? plan.takeProfit2 : null,
    level: plan && !input.waitReason && plan.kind !== 'now' ? plan.level : null,
    turnsBuyAbove: input.waitReason ? (plan?.direction === 'long' ? plan.level : near.above) : null,
    turnsSellBelow: input.waitReason ? (plan?.direction === 'short' ? plan.level : near.below) : null,
    flippedFromPrior: !!input.flippedFromPrior,
    ...(input.priorUnderPressure ? { priorUnderPressure: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Leitores em paralelo com maioria antecipada
// ---------------------------------------------------------------------------

export type ReaderDone<T> =
  | { label: string; ok: true; value: T; outcome: ReaderOutcome; ms: number }
  | { label: string; ok: false; error: unknown; ms: number };

export interface Collected<T> {
  done: ReaderDone<T>[];
  /** Os 2 primeiros concordaram e a analise saiu sem esperar o terceiro. */
  early: boolean;
  /** Leitores que nao terminaram a tempo (ignorados). */
  ignored: string[];
}

/** Espera do terceiro leitor depois de os 2 primeiros discordarem (ms). */
export const TIE_WAIT_MS = 6_000;

/**
 * Roda os leitores juntos. Os 2 primeiros que terminarem concordando em estado
 * e direcao decidem na hora; discordando, o terceiro tem `tieWaitMs` depois do
 * segundo. Falha de leitor nao derruba: os outros seguem.
 */
export function collectReaders<T>(
  tasks: readonly { label: string; run: () => Promise<T> }[],
  outcomeOf: (value: T) => Promise<ReaderOutcome>,
  tieWaitMs: number = TIE_WAIT_MS,
): Promise<Collected<T>> {
  return new Promise((resolve) => {
    const started = Date.now();
    const done: ReaderDone<T>[] = [];
    let finished = false;
    let tieTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (early: boolean) => {
      if (finished) return;
      finished = true;
      if (tieTimer) clearTimeout(tieTimer);
      const seen = new Set(done.map((d) => d.label));
      resolve({ done: [...done], early, ignored: tasks.map((t) => t.label).filter((l) => !seen.has(l)) });
    };
    const settle = (entry: ReaderDone<T>) => {
      if (finished) return;
      done.push(entry);
      const oks = done.filter((d): d is Extract<ReaderDone<T>, { ok: true }> => d.ok);
      if (oks.length === 2 && done.length < tasks.length) {
        if (sameOutcome(oks[0].outcome, oks[1].outcome)) return finish(true);
        tieTimer = setTimeout(() => finish(false), tieWaitMs);
        tieTimer.unref?.();
      }
      if (done.length === tasks.length) finish(false);
    };
    for (const task of tasks) {
      task
        .run()
        .then(async (value) => settle({ label: task.label, ok: true, value, outcome: await outcomeOf(value), ms: Date.now() - started }))
        .catch((error) => settle({ label: task.label, ok: false, error, ms: Date.now() - started }));
    }
    if (!tasks.length) finish(false);
  });
}
