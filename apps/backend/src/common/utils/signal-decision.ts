import { flagBool } from '../flags/feature-flags';
import {
  Recommendation,
  canonicalFxPair,
  computeLevelPercents,
  computeRiskReward,
  formatRiskReward,
  parsePassFailChecklist,
} from './analysis-normalizer';
import { EconomicCalendarService } from '../../modules/calendar/calendar.service';
import { normalizeToBinancePerp } from '../../modules/market/market.service';
import { BROKEN_PLAN_RULES, MEASURE_ONLY_RULES, TradePlanRule } from './trade-plan-validator';
import {
  ENGINE_RULES,
  type EntryLevels,
  type EntryRejection,
  type Swing,
  type WatchPlan,
  entryLevels,
  isValidWatchPlan,
  limitEntryLevels,
  nearEdge,
  pricePosition,
  snapInvalidation,
  stopMarginAtr,
} from './plan-engine';
import type { HtfTrend } from '../../modules/ai/analysis-data-coverage';

// ============================================================================
// VALIDADOR DE ESTADO DO v11 (02/11/2026): O CODIGO DECIDE O ESTADO
// ----------------------------------------------------------------------------
// O modelo le o mercado e entrega o plano; este codigo decide entre NO_TRADE,
// WATCH, ARMED e ENTER_NOW com as constantes de ENGINE_RULES (plan-engine.ts).
// O equilibrio entre entrar e aguardar mora aqui, nunca no prompt.
// So rebaixa em relacao ao estado do modelo, com uma excecao: WATCH do modelo
// com entrada a mercado valida e todas as condicoes do ENTER_NOW vira
// ENTER_NOW. Cada mudanca de estado vai para `validatorNotes` com o motivo.
// Mapeamento fixo: ENTER_NOW = BUY/SELL a mercado; ARMED = BUY/SELL com ordem
// limit na borda da zona; WATCH e NO_TRADE = WAIT sem niveis principais (o
// WATCH leva o plano condicional em `watchPlan`). Adapter e worker decidem por
// aqui (paridade).
// ============================================================================

export type SignalState = 'NO_TRADE' | 'WATCH' | 'ARMED' | 'ENTER_NOW';
export const SIGNAL_STATES: readonly SignalState[] = ['NO_TRADE', 'WATCH', 'ARMED', 'ENTER_NOW'];

/** Motivo de cada mudanca de estado. */
export type ValidatorReason =
  | 'state_mismatch'
  | 'watch_plan_invalid'
  | 'implausible_price'
  | 'invalidation_unsnapped'
  | 'plan_invalidated'
  | 'market_entry_invalid'
  | 'market_entry_valid'
  | 'limit_entry_invalid'
  | 'entry_far_from_price'
  | 'required_check_failed'
  | 'checks_below_min'
  | 'late_move'
  | 'setup_failed'
  | 'no_valid_geometry'
  | 'levels_unverified'
  | 'not_at_price'
  | 'zone_overrun'
  | 'news_event';

/** Uma mudanca de estado feita pelo codigo, gravada em `validatorNotes`. */
export interface ValidatorNote {
  from: SignalState;
  to: SignalState;
  reason: ValidatorReason;
}

/** O que o validador fez com a resposta do modelo (vai ao PostHog). */
export type ValidatorAction = 'none' | 'fixed' | 'downgraded' | 'promoted';

export interface PlanLevels {
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
}

export interface TargetProbabilitiesInput {
  probabilityTp1: number | null;
  probabilityTp2: number | null;
  probabilityStop: number | null;
}

/** REAL DATA que entrou no prompt, com o que o codigo calculou das velas fechadas. */
export interface RealDataInput {
  price: number;
  atr: number | null;
  htfTrend: HtfTrend | null;
  /** Swings fractais do tempo grafico; null em analise sem o calculo. */
  swings: readonly Pick<Swing, 'kind' | 'price'>[] | null;
  /** Movimento atrasado por direcao (moveIsLate); null sem o calculo. */
  late: { long: boolean; short: boolean } | null;
}

export interface SignalDecisionInput {
  /** Estado que o modelo escolheu (ou o derivado da recomendacao, se ele nao mandou). */
  state: SignalState;
  /** Recomendacao canonica do modelo (BUY | SELL | WAIT). */
  recommendation: Recommendation;
  /** Confianca do modelo, 0-100. */
  confidence: number;
  trendStrength: unknown;
  /** Checklist C1..C7 do modelo (PASS/FAIL), lido item a item. */
  structureValidation: unknown;
  symbol: string;
  /** Preco lido no print. */
  currentPrice: number | null;
  watchPlan: WatchPlan | null;
  /** Niveis principais que o modelo escreveu: so valem sem REAL DATA (fallback em R). */
  estimatedLevels: PlanLevels | null;
  probabilities: TargetProbabilitiesInput;
  /** null sem candles: os niveis do modelo valem, com a distancia medida em R. */
  realData: RealDataInput | null;
  /** Regras do `validateTradePlan`; as quebradas nunca chegam aqui. */
  planFailures?: TradePlanRule[];
  /** true quando `correctPriceMagnitude` reescreveu os niveis. */
  priceFixed?: boolean;
}

export interface SignalDecisionResult {
  state: SignalState;
  recommendation: Recommendation;
  confidence: number;
  entryType: string | null;
  /** Niveis principais (do motor do plano): so ARMED e ENTER_NOW os tem. */
  levels: PlanLevels;
  /** O plano (com a invalidacao encaixada) em todo estado com plano. */
  watchPlan: WatchPlan | null;
  /** real_data = niveis e distancia pelos candles reais; print = estimados do print. */
  dataMode: 'real_data' | 'print';
  probabilities: TargetProbabilitiesInput;
  /** Cada mudanca de estado, na ordem, com o motivo. */
  validatorNotes: ValidatorNote[];
  /** Regras que so medem (MEASURE_ONLY_RULES): o estado nao muda. */
  validatorFlags: TradePlanRule[];
  validatorAction: ValidatorAction;
  /** Descricao do evento que rebaixou (para log), quando houver. */
  newsEvent: string | null;
  /** O que o news guard conseguiu checar (so memoria e log, nunca gravado). */
  newsGuardStatus: NewsGuardStatus;
  /** Preco real longe do print: o adapter acrescenta o aviso em riskFactors. */
  stalePrint: boolean;
}

/**
 * Resultado do news guard (19/10/2026). So `event`/`degraded_event` rebaixam;
 * `timeout`, `error` e `degraded_no_event` seguem sem rebaixar (falha aberta).
 *   disabled          ENABLE_NEWS_GUARD desligado
 *   skipped           ja nao havia sinal antes do guard (nada a checar)
 *   no_event          calendario respondeu, sem evento High na janela
 *   event             evento High na janela: rebaixou
 *   degraded_no_event fonte fora do ar; resposta (cache velho ou vazia) sem evento
 *   degraded_event    fonte fora do ar; o cache velho tinha o evento: rebaixou
 *   timeout           o calendario nao respondeu em 6 s
 *   error             o calendario lancou erro
 */
export type NewsGuardStatus =
  | 'disabled'
  | 'skipped'
  | 'no_event'
  | 'event'
  | 'degraded_no_event'
  | 'degraded_event'
  | 'timeout'
  | 'error';

class CalendarTimeoutError extends Error {}

// Instância única: reaproveita o cache de 1h do calendário entre análises.
const calendar = new EconomicCalendarService();

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // O timer e cancelado quando o calendario responde antes; sem isso cada
  // analise deixava um timer vivo ate estourar o prazo.
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new CalendarTimeoutError('calendar timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Estado lido da resposta; sem `signalState` (prompt antigo), a regra de leitura do historico. */
export function deriveSignalState(
  recommendation: unknown,
  entryType: unknown,
  alternativeScenario: unknown,
): SignalState {
  const rec = String(recommendation ?? '').trim().toUpperCase();
  if (rec === 'BUY' || rec === 'SELL' || rec === 'COMPRA' || rec === 'VENDA') {
    return String(entryType ?? '').trim().toLowerCase() === 'market' ? 'ENTER_NOW' : 'ARMED';
  }
  return String(alternativeScenario ?? '').trim() ? 'WATCH' : 'NO_TRADE';
}

export function parseSignalState(value: unknown): SignalState | null {
  return SIGNAL_STATES.find((s) => s === value) ?? null;
}

/** Estado de um resultado salvo: o gravado (v10 em diante) ou, sem ele, a regra de leitura do historico. */
export function storedSignalState(result: unknown, recommendation: unknown): SignalState {
  const root = result && typeof result === 'object' ? (result as Record<string, any>) : {};
  const analysis = root.analysis && typeof root.analysis === 'object' ? root.analysis : {};
  return parseSignalState(root.signalState) ?? deriveSignalState(recommendation, analysis.entryType, analysis.alternativeScenario);
}

/** Motivos das mudancas, sem repetir (o `validator_reasons` do contrato e o log). */
export function validatorReasons(notes: readonly ValidatorNote[]): ValidatorReason[] {
  return [...new Set(notes.map((n) => n.reason))];
}

const rank = (s: SignalState) => SIGNAL_STATES.indexOf(s);
const lower = (s: SignalState): SignalState => SIGNAL_STATES[Math.max(0, rank(s) - 1)];

/** Par de moedas (sem metal). */
function isForexPair(symbol: string): boolean {
  const pair = canonicalFxPair(symbol);
  return pair !== null && !pair.startsWith('XAU') && !pair.startsWith('XAG');
}

/** Indice de acoes, large cap, ouro ou BTC: deriva estrutural de alta. */
const DRIFT_SYMBOL = /^(NAS100|NDX|US100|USTEC|US30|DJ30|DJI|WS30|US500|SPX500|SPX|SP500|GER40|DE40|DAX|UK100|JP225|IBOV|WIN|IND|AAPL|MSFT|NVDA|AMZN|GOOGL|GOOG|META|TSLA|BRKB)/;
function hasUpwardDrift(symbol: string): boolean {
  const clean = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (canonicalFxPair(symbol)?.startsWith('XAU')) return true;
  if (normalizeToBinancePerp(symbol).base === 'BTC') return true;
  return DRIFT_SYMBOL.test(clean);
}

/** Chave do par na calibracao da margem do stop. */
function calibrationPair(symbol: string): string | null {
  return canonicalFxPair(symbol) ?? normalizeToBinancePerp(symbol).binanceSymbol ?? (String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null);
}

/**
 * PASS exigidos para ENTER_NOW e ARMED: o minimo, e 1 a mais se houver
 * qualquer agravante (forex, contra a tendencia do 4h calculada pelo codigo,
 * venda de ativo com deriva de alta com o 4h em alta). Os agravantes nao se
 * somam: no maximo 1 a mais, qualquer que seja a combinacao.
 */
export function requiredPasses(symbol: string, direction: WatchPlan['direction'], htfTrend: HtfTrend | null): number {
  const aggravated =
    isForexPair(symbol) ||
    htfTrend === (direction === 'long' ? 'downtrend' : 'uptrend') ||
    (direction === 'short' && htfTrend === 'uptrend' && hasUpwardDrift(symbol));
  return ENGINE_RULES.minPass + (aggravated ? ENGINE_RULES.aggravatedExtraPass : 0);
}

/** Tudo o que o codigo mediu do plano com as velas reais. */
export interface PlanEvaluation {
  /** O plano com a invalidacao encaixada na swing real. */
  plan: WatchPlan;
  market: EntryLevels | EntryRejection;
  limit: EntryLevels | EntryRejection;
  /** Distancia da borda da limit ao preco real, em ATR. */
  limitDistanceAtr: number;
  late: boolean;
  checks: ReadonlyMap<number, boolean> | null;
  passes: number;
  requiredPasses: number;
}

/**
 * Mede o plano contra as velas reais: confere que o preco nao passou da
 * invalidacao do modelo (`plan_invalidated`), encaixa a invalidacao
 * estrutural (sem swing entre o preco e ela, a ate 0,5 ATR:
 * `invalidation_unsnapped`) e calcula as duas entradas.
 */
export function evaluatePlan(input: {
  plan: WatchPlan;
  symbol: string;
  structureValidation: unknown;
  price: number;
  atr: number;
  htfTrend: HtfTrend | null;
  swings: readonly Pick<Swing, 'kind' | 'price'>[];
  late: boolean;
}): PlanEvaluation | ValidatorReason {
  if (pricePosition(input.plan, input.price) === 'invalidated') return 'plan_invalidated';
  const plan = snapInvalidation(input.plan, input.swings, input.atr, input.price);
  if (!plan) return 'invalidation_unsnapped';
  const margin = stopMarginAtr(calibrationPair(input.symbol), input.htfTrend);
  const checks = parsePassFailChecklist(input.structureValidation);
  return {
    plan,
    market: entryLevels(plan, input.atr, input.price, margin),
    limit: limitEntryLevels(plan, input.atr, input.price, margin),
    limitDistanceAtr: Math.abs(nearEdge(plan) - input.price) / input.atr,
    late: input.late,
    checks,
    passes: checks ? [...checks.values()].filter(Boolean).length : 0,
    requiredPasses: requiredPasses(input.symbol, plan.direction, input.htfTrend),
  };
}

const allPass = (checks: ReadonlyMap<number, boolean> | null, items: readonly number[]) =>
  !!checks && items.every((n) => checks.get(n) === true);

/** Por que o estado nao vale (null = vale). `fromTop`: o ENTER_NOW estava ao alcance. */
function whyNot(state: SignalState, ev: PlanEvaluation, fromTop: boolean): ValidatorReason | null {
  const R = ENGINE_RULES;
  const marketValid = typeof ev.market !== 'string';
  if (state === 'ENTER_NOW') {
    if (!marketValid) return 'market_entry_invalid';
    if (!allPass(ev.checks, R.enterNowChecks)) return 'required_check_failed';
    if (ev.passes < ev.requiredPasses) return 'checks_below_min';
    return ev.late ? 'late_move' : null;
  }
  if (state === 'ARMED') {
    // Com o ENTER_NOW ao alcance, ARMED so quando a entrada a mercado nao vale.
    if (fromTop && marketValid) return whyNot('ENTER_NOW', ev, true);
    if (typeof ev.limit === 'string') return 'limit_entry_invalid';
    if (ev.limitDistanceAtr > R.armedMaxAtr) return 'entry_far_from_price';
    if (!allPass(ev.checks, R.armedChecks)) return 'required_check_failed';
    return ev.passes < ev.requiredPasses ? 'checks_below_min' : null;
  }
  if (state === 'WATCH') {
    if (!allPass(ev.checks, R.watchChecks)) return 'setup_failed';
    if (!marketValid && typeof ev.limit === 'string') return 'no_valid_geometry';
    return ev.passes < R.minPassWatch ? 'checks_below_min' : null;
  }
  return null;
}

/**
 * Estado final a partir do estado do modelo: desce ENTER_NOW -> ARMED ->
 * WATCH -> NO_TRADE ate a primeira condicao que vale, anotando cada degrau.
 * WATCH do modelo sobe para ENTER_NOW quando todas as condicoes dele valem.
 */
export function chooseState(model: SignalState, ev: PlanEvaluation, allowPromotion = true): { state: SignalState; notes: ValidatorNote[]; levels: PlanLevels } {
  const notes: ValidatorNote[] = [];
  let state = model;
  if (allowPromotion && model === 'WATCH' && whyNot('ENTER_NOW', ev, true) === null) {
    notes.push({ from: 'WATCH', to: 'ENTER_NOW', reason: 'market_entry_valid' });
    state = 'ENTER_NOW';
  }
  const fromTop = state === 'ENTER_NOW';
  for (let reason = whyNot(state, ev, fromTop); state !== 'NO_TRADE' && reason; reason = whyNot(state, ev, fromTop)) {
    notes.push({ from: state, to: lower(state), reason });
    state = lower(state);
  }
  const chosen = state === 'ENTER_NOW' ? ev.market : state === 'ARMED' ? ev.limit : null;
  const levels = chosen && typeof chosen !== 'string'
    ? { entry: chosen.entry, stopLoss: chosen.stopLoss, takeProfit1: chosen.takeProfit1, takeProfit2: chosen.takeProfit2 }
    : NULL_LEVELS;
  return { state, notes, levels };
}

/**
 * Sem REAL DATA (ativo sem fonte ou cota do dia acabou): os niveis do modelo,
 * a posicao pelo preco lido no print e a distancia em R do proprio plano. Nao
 * promove. A tela avisa que os niveis sao estimados.
 */
function choosePrintState(input: SignalDecisionInput, plan: WatchPlan): { state: SignalState; notes: ValidatorNote[]; levels: PlanLevels } {
  const R = ENGINE_RULES;
  const checks = parsePassFailChecklist(input.structureValidation);
  const passes = checks ? [...checks.values()].filter(Boolean).length : 0;
  const required = requiredPasses(input.symbol, plan.direction, null);
  const est = input.estimatedLevels;
  const price = input.currentPrice;
  const levelsOk = !!est && positive(est.entry) && positive(est.stopLoss) && positive(est.takeProfit1) && positive(price);
  const position = positive(price) ? pricePosition(plan, price) : null;
  const notes: ValidatorNote[] = [];
  if (position === 'invalidated' && input.state !== 'NO_TRADE') {
    return { state: 'NO_TRADE', notes: [{ from: input.state, to: 'NO_TRADE', reason: 'plan_invalidated' }], levels: NULL_LEVELS };
  }
  const why = (state: SignalState): ValidatorReason | null => {
    if (state === 'ENTER_NOW' || state === 'ARMED') {
      if (!levelsOk) return 'levels_unverified';
      if (state === 'ENTER_NOW' && position !== 'inside_zone') return 'not_at_price';
      if (position === 'beyond_zone') return 'zone_overrun';
      const dR = Math.abs(nearEdge(plan) - (price as number)) / Math.abs((est!.entry as number) - (est!.stopLoss as number));
      if (state === 'ARMED' && position === 'before_zone' && dR > R.armedMaxStopR) return 'entry_far_from_price';
      if (!allPass(checks, state === 'ENTER_NOW' ? R.enterNowChecks : R.armedChecks)) return 'required_check_failed';
      return passes < required ? 'checks_below_min' : null;
    }
    if (state === 'WATCH') {
      if (!allPass(checks, R.watchChecks)) return 'setup_failed';
      return passes < R.minPassWatch ? 'checks_below_min' : null;
    }
    return null;
  };
  let state = input.state;
  for (let reason = why(state); state !== 'NO_TRADE' && reason; reason = why(state)) {
    notes.push({ from: state, to: lower(state), reason });
    state = lower(state);
  }
  const levels = state === 'ENTER_NOW' || state === 'ARMED'
    ? { entry: est!.entry, stopLoss: est!.stopLoss, takeProfit1: est!.takeProfit1, takeProfit2: positive(est!.takeProfit2) ? est!.takeProfit2 : null }
    : NULL_LEVELS;
  return { state, notes, levels };
}

const positive = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function confidenceCap(trendStrength: unknown): number {
  const strength = String(trendStrength || '').trim().toLowerCase();
  if (strength === 'weak') return ENGINE_RULES.confidenceCapWeakTrend;
  if (strength === 'moderate') return ENGINE_RULES.confidenceCapModerateTrend;
  return ENGINE_RULES.confidenceCap;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const NULL_LEVELS: PlanLevels = { entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null };
const NULL_PROBABILITIES: TargetProbabilitiesInput = { probabilityTp1: null, probabilityTp2: null, probabilityStop: null };

export async function decideSignal(input: SignalDecisionInput): Promise<SignalDecisionResult> {
  const side = input.recommendation === 'BUY' || input.recommendation === 'SELL' ? input.recommendation : null;
  const failures = (input.planFailures ?? []).filter((rule) => !BROKEN_PLAN_RULES.includes(rule));
  const validatorFlags = side ? failures.filter((rule) => MEASURE_ONLY_RULES.includes(rule)) : [];
  const modelPlan = isValidWatchPlan(input.watchPlan) ? input.watchPlan : null;
  const real = input.realData && positive(input.realData.atr) && positive(input.realData.price) && input.realData.swings
    ? input.realData
    : null;
  const model = input.state;
  const stop = (reason: ValidatorReason) => ({ state: 'NO_TRADE' as SignalState, notes: [{ from: model, to: 'NO_TRADE' as SignalState, reason }], levels: NULL_LEVELS });

  let plan = modelPlan;
  // Estado de sinal com HOLD e incoerente: segue como WATCH com o plano do modelo.
  const signalWithoutSide = (model === 'ARMED' || model === 'ENTER_NOW') && !side;
  const start: SignalState = signalWithoutSide ? 'WATCH' : model;
  const mismatch: ValidatorNote[] = signalWithoutSide ? [{ from: model, to: 'WATCH', reason: 'state_mismatch' }] : [];
  let chosen: { state: SignalState; notes: ValidatorNote[]; levels: PlanLevels };
  if (model === 'NO_TRADE') chosen = { state: 'NO_TRADE', notes: [], levels: NULL_LEVELS };
  else if (side && failures.includes('implausible_price')) chosen = stop('implausible_price');
  else if (!modelPlan) chosen = stop('watch_plan_invalid');
  else if (side && (modelPlan.direction === 'long') !== (side === 'BUY')) chosen = stop('state_mismatch');
  else if (real) {
    const ev = evaluatePlan({
      plan: modelPlan, symbol: input.symbol, structureValidation: input.structureValidation,
      price: real.price, atr: real.atr as number, htfTrend: real.htfTrend, swings: real.swings ?? [],
      late: real.late ? real.late[modelPlan.direction] : false,
    });
    if (typeof ev === 'string') chosen = { state: 'NO_TRADE', notes: [...mismatch, { from: start, to: 'NO_TRADE', reason: ev }], levels: NULL_LEVELS };
    else {
      plan = ev.plan;
      const picked = chooseState(start, ev, !signalWithoutSide);
      chosen = { ...picked, notes: [...mismatch, ...picked.notes] };
    }
  } else {
    const picked = choosePrintState({ ...input, state: start }, modelPlan);
    chosen = { ...picked, notes: [...mismatch, ...picked.notes] };
  }

  let { state, levels } = chosen;
  const notes = [...chosen.notes];
  const stalePrint = !!real && positive(input.currentPrice) && Math.abs(real.price - input.currentPrice) > ENGINE_RULES.stalePrintAtr * (real.atr as number);

  // News guard: com evento High na janela, o plano vira condicional (WATCH).
  let newsEvent: string | null = null;
  let newsGuardStatus: NewsGuardStatus = 'disabled';
  if (flagBool('ENABLE_NEWS_GUARD')) {
    if (state !== 'ARMED' && state !== 'ENTER_NOW') {
      newsGuardStatus = 'skipped';
    } else {
      try {
        const { events, degraded } = await raceTimeout(
          calendar.getEventsForSymbol(String(input.symbol || ''), new Date(), 2),
          6_000,
        );
        const imminent = (events || []).find(
          (e) => e.impact === 'High' && typeof e.minutesUntil === 'number' && e.minutesUntil >= -15 && e.minutesUntil <= 45,
        );
        if (imminent) {
          notes.push({ from: state, to: 'WATCH', reason: 'news_event' });
          state = 'WATCH';
          levels = NULL_LEVELS;
          newsEvent = `${imminent.country} ${imminent.title} (${imminent.minutesUntil}min)`;
        }
        newsGuardStatus = imminent ? (degraded ? 'degraded_event' : 'event') : (degraded ? 'degraded_no_event' : 'no_event');
      } catch (error) {
        newsGuardStatus = error instanceof CalendarTimeoutError ? 'timeout' : 'error';
      }
    }
  }

  const isSignal = state === 'ARMED' || state === 'ENTER_NOW';
  let confidence = Number.isFinite(input.confidence) ? input.confidence : 0;
  let probabilities = NULL_PROBABILITIES;
  if (isSignal) {
    confidence = Math.min(confidence, confidenceCap(input.trendStrength));
    const p = input.probabilities;
    if (p.probabilityTp1 !== null) {
      const tp1 = clamp(p.probabilityTp1, confidence - ENGINE_RULES.probabilityTp1Band, confidence + ENGINE_RULES.probabilityTp1Band);
      probabilities = {
        probabilityTp1: tp1,
        probabilityTp2: p.probabilityTp2 === null ? null : Math.min(p.probabilityTp2, tp1),
        // O stop fica perto de 100 - TP1 (e a soma nunca passa de 100).
        probabilityStop: p.probabilityStop === null ? null : Math.min(p.probabilityStop, 100 - tp1),
      };
    }
  } else {
    confidence = Math.min(confidence, ENGINE_RULES.confidenceCapNoSignal);
  }

  const action: ValidatorAction = rank(state) < rank(model)
    ? 'downgraded'
    : rank(state) > rank(model) ? 'promoted' : input.priceFixed ? 'fixed' : 'none';
  return {
    state,
    recommendation: isSignal && side ? side : isSignal && plan ? (plan.direction === 'long' ? 'BUY' : 'SELL') : 'WAIT',
    confidence,
    entryType: isSignal ? (state === 'ENTER_NOW' ? 'market' : 'limit') : null,
    levels: isSignal ? levels : NULL_LEVELS,
    watchPlan: state === 'NO_TRADE' ? null : plan,
    dataMode: real ? 'real_data' : 'print',
    probabilities,
    validatorNotes: notes,
    validatorFlags,
    validatorAction: action,
    newsEvent,
    newsGuardStatus,
    stalePrint,
  };
}

/**
 * Aplica a decisao aos campos da analise: niveis, R:R, percentuais e
 * probabilidades seguem o estado final. WATCH e NO_TRADE ficam sem niveis
 * principais nem plano de saida; NO_TRADE tambem sem cenario alternativo.
 * `staleNote` (print desatualizado) entra no fim de riskFactors.
 */
export function applyDecisionToAnalysis<T extends Record<string, any>>(
  analysis: T,
  decision: SignalDecisionResult,
  staleNote: string | null = null,
): T {
  const isSignal = decision.state === 'ARMED' || decision.state === 'ENTER_NOW';
  const { entry, stopLoss, takeProfit1, takeProfit2 } = decision.levels;
  const rrTp1 = computeRiskReward(entry, stopLoss, takeProfit1, decision.recommendation);
  const rrTp2 = computeRiskReward(entry, stopLoss, takeProfit2, decision.recommendation);
  const keep = <K extends string>(key: K) => (isSignal ? analysis[key] ?? null : null);
  const riskFactors = String(analysis.riskFactors ?? '');
  return {
    ...analysis,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    ...computeLevelPercents(entry, stopLoss, takeProfit1, takeProfit2),
    riskRewardRatio: isSignal ? formatRiskReward(rrTp2 ?? rrTp1) : null,
    riskRewardTp1: isSignal ? rrTp1 : null,
    riskRewardTp2: isSignal ? rrTp2 : null,
    entryType: decision.entryType,
    entryY: keep('entryY'),
    stopY: keep('stopY'),
    tp1Y: keep('tp1Y'),
    tp2Y: keep('tp2Y'),
    invalidationLevel: keep('invalidationLevel'),
    entryCondition: keep('entryCondition'),
    partialExitStrategy: keep('partialExitStrategy'),
    tp1ClosePercent: keep('tp1ClosePercent'),
    tp2ClosePercent: keep('tp2ClosePercent'),
    breakevenTrigger: keep('breakevenTrigger'),
    ...decision.probabilities,
    alternativeScenario: decision.state === 'NO_TRADE' ? null : analysis.alternativeScenario ?? null,
    riskFactors: staleNote ? [riskFactors, staleNote].filter(Boolean).join('\n') : riskFactors,
  };
}
