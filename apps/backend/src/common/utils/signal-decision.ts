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
import { BROKEN_PLAN_RULES, MEASURE_ONLY_RULES, TradePlanRule } from './trade-plan-validator';
import { WatchPlan, isValidWatchPlan, levelsFromPlan, nearEdge, pricePosition } from './plan-engine';
import type { HtfTrend } from '../../modules/ai/analysis-data-coverage';

// ============================================================================
// VALIDADOR DE ESTADO DO v10 (26/10/2026): A DECISAO UNICA DEPOIS DO MODELO
// ----------------------------------------------------------------------------
// O modelo escolhe um de quatro estados (NO_TRADE, WATCH, ARMED, ENTER_NOW).
// Este codigo so REBAIXA, na ordem ENTER_NOW -> ARMED -> WATCH -> NO_TRADE,
// nunca promove. Adapter e worker decidem por aqui (paridade).
// Mapeamento fixo: ENTER_NOW = BUY/SELL a mercado; ARMED = BUY/SELL com
// ordem limit na borda da zona; WATCH e NO_TRADE = WAIT sem niveis principais
// (o WATCH leva o plano condicional em `watchPlan`).
// v10.3 (27/10/2026): entrada, stop e TP1 saem do plan-engine.ts, nunca do
// modelo; o estado sai da distancia D da borda proxima ao preco real; C2, C3,
// C6 e C7 do checklist sao obrigatorios para qualquer plano.
// Todo rebaixamento grava o motivo em `validatorNotes` e no log.
// ============================================================================

export type SignalState = 'NO_TRADE' | 'WATCH' | 'ARMED' | 'ENTER_NOW';
export const SIGNAL_STATES: readonly SignalState[] = ['NO_TRADE', 'WATCH', 'ARMED', 'ENTER_NOW'];

/** Limites do validador. Recalibrar AQUI, e so aqui. */
export const STATE_RULES = {
  /** R:R minimo da entrada ate o alvo final (TP2, ou TP1 sem TP2; chave ENABLE_RR_GUARD desliga). */
  minRiskRewardTp2: 1.5,
  /** D = |borda proxima - preco real| / ATR: ARMED ate isto, WATCH acima. */
  armedMaxAtr: 0.75,
  /**
   * Sem REAL DATA (ativo sem fonte ou cota do dia acabou): D_R = |borda - preco
   * lido no print| / risco do plano do modelo. Mesmo limite do v10 (f3dea7b).
   */
  armedMaxStopR: 0.5,
  /** Itens do checklist que tem de vir PASS em qualquer plano. */
  requiredChecks: [2, 3, 6, 7],
  /** PASS minimos no total; forex e contra a tendencia do 4h pedem mais. */
  minPass: 5,
  minPassStrict: 6,
  /** Preco real a mais que isto (em ATR) do preco lido no print = print desatualizado. */
  stalePrintAtr: 1,
  confidenceCap: 72,
  confidenceCapWeakTrend: 58,
  confidenceCapModerateTrend: 68,
  confidenceCapNoSignal: 49,
  /** probabilityTp1 fica a no maximo isto da confianca. */
  probabilityTp1Band: 3,
} as const;

/** Motivo de cada rebaixamento (e da nota de print velho). */
export type ValidatorNote =
  | 'state_mismatch'
  | 'implausible_price'
  | 'levels_unverified'
  | 'plan_invalidated'
  | 'zone_overrun'
  | 'stop_atr_out_of_range'
  | 'tp1_no_room'
  | 'rr_tp2_below_min'
  | 'required_check_failed'
  | 'checks_below_min'
  | 'forex_checks_below_min'
  | 'countertrend_checks_below_min'
  | 'not_at_price'
  | 'entry_far_from_price'
  | 'news_event'
  | 'watch_plan_invalid'
  | 'stale_print';

/** O que o validador fez com a resposta do modelo (vai ao PostHog). */
export type ValidatorAction = 'none' | 'fixed' | 'downgraded';

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
  /**
   * Preco, ATR e tendencia do 4h reais (REAL DATA que entrou no prompt). null
   * sem candles: os niveis do modelo valem, com a distancia medida em R.
   */
  realData: { price: number; atr: number | null; htfTrend: HtfTrend | null } | null;
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
  /** O plano do modelo em todo estado com plano (WATCH, ARMED, ENTER_NOW). */
  watchPlan: WatchPlan | null;
  /** real_data = niveis e distancia pelos candles reais; print = estimados do print. */
  dataMode: 'real_data' | 'print';
  probabilities: TargetProbabilitiesInput;
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

/** Motivos que mudam o estado; `stale_print` so avisa. */
const DOWNGRADE_NOTES: readonly ValidatorNote[] = [
  'state_mismatch', 'implausible_price', 'levels_unverified', 'plan_invalidated', 'zone_overrun',
  'stop_atr_out_of_range', 'tp1_no_room', 'rr_tp2_below_min', 'required_check_failed', 'checks_below_min',
  'forex_checks_below_min', 'countertrend_checks_below_min', 'not_at_price', 'entry_far_from_price',
  'news_event', 'watch_plan_invalid',
];

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

/** Par de moedas (sem metal): exige mais itens do checklist. */
function isForexPair(symbol: string): boolean {
  const pair = canonicalFxPair(symbol);
  return pair !== null && !pair.startsWith('XAU') && !pair.startsWith('XAG');
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

export type ChecklistGateFailure =
  | 'required_check_failed'
  | 'checks_below_min'
  | 'forex_checks_below_min'
  | 'countertrend_checks_below_min';

/**
 * Gate do checklist (v10.3), igual para WATCH, ARMED e ENTER_NOW: C2, C3, C6
 * e C7 em PASS e pelo menos 5 PASS (6 em forex e contra a tendencia do 4h
 * calculada pelo codigo). Checklist ilegivel nao passa.
 */
export function checklistGate(
  structureValidation: unknown,
  symbol: string,
  direction: WatchPlan['direction'],
  htfTrend: HtfTrend | null,
): ChecklistGateFailure | null {
  const items = parsePassFailChecklist(structureValidation);
  if (!items || STATE_RULES.requiredChecks.some((n) => items.get(n) !== true)) return 'required_check_failed';
  const passes = [...items.values()].filter(Boolean).length;
  if (passes < STATE_RULES.minPass) return 'checks_below_min';
  if (passes < STATE_RULES.minPassStrict && isForexPair(symbol)) return 'forex_checks_below_min';
  const counterTrend = htfTrend === (direction === 'long' ? 'downtrend' : 'uptrend');
  if (passes < STATE_RULES.minPassStrict && counterTrend) return 'countertrend_checks_below_min';
  return null;
}

export function parseSignalState(value: unknown): SignalState | null {
  return SIGNAL_STATES.find((s) => s === value) ?? null;
}

/** Estado de um resultado salvo: o gravado (v10) ou, sem ele, a regra de leitura do historico. */
export function storedSignalState(result: unknown, recommendation: unknown): SignalState {
  const root = result && typeof result === 'object' ? (result as Record<string, any>) : {};
  const analysis = root.analysis && typeof root.analysis === 'object' ? root.analysis : {};
  return parseSignalState(root.signalState) ?? deriveSignalState(recommendation, analysis.entryType, analysis.alternativeScenario);
}

const positive = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function confidenceCap(trendStrength: unknown): number {
  const strength = String(trendStrength || '').trim().toLowerCase();
  if (strength === 'weak') return STATE_RULES.confidenceCapWeakTrend;
  if (strength === 'moderate') return STATE_RULES.confidenceCapModerateTrend;
  return STATE_RULES.confidenceCap;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const NULL_LEVELS: PlanLevels = { entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null };
const NULL_PROBABILITIES: TargetProbabilitiesInput = { probabilityTp1: null, probabilityTp2: null, probabilityStop: null };

export async function decideSignal(input: SignalDecisionInput): Promise<SignalDecisionResult> {
  const notes: ValidatorNote[] = [];
  const side = input.recommendation === 'BUY' || input.recommendation === 'SELL' ? input.recommendation : null;
  let state = input.state;
  let levels: PlanLevels = NULL_LEVELS;
  let stalePrint = false;
  const failures = (input.planFailures ?? []).filter((rule) => !BROKEN_PLAN_RULES.includes(rule));
  const validatorFlags = side ? failures.filter((rule) => MEASURE_ONLY_RULES.includes(rule)) : [];
  const plan = isValidWatchPlan(input.watchPlan) ? input.watchPlan : null;

  const downgrade = (to: SignalState, note: ValidatorNote) => {
    if (SIGNAL_STATES.indexOf(to) < SIGNAL_STATES.indexOf(state)) state = to;
    if (!notes.includes(note)) notes.push(note);
  };
  // Leitura do estado depois de cada rebaixamento (o TS nao ve a mudanca feita no closure).
  const now = (): SignalState => state;

  // Estado de sinal sem direcao (ou o contrario) e resposta incoerente.
  if ((state === 'ARMED' || state === 'ENTER_NOW') && !side) downgrade('WATCH', 'state_mismatch');

  // Gate do checklist: vale para qualquer plano (o WATCH tambem).
  if (state !== 'NO_TRADE' && plan) {
    const gate = checklistGate(input.structureValidation, input.symbol, plan.direction, input.realData?.htfTrend ?? null);
    if (gate) downgrade('NO_TRADE', gate);
  }

  const real = input.realData && positive(input.realData.atr) ? { price: input.realData.price, atr: input.realData.atr } : null;
  // R:R ate o alvo final (TP2, ou TP1 sem TP2), nos niveis decididos.
  const guardRiskReward = () => {
    const risk = Math.abs((levels.entry as number) - (levels.stopLoss as number));
    const rrFinal = Math.abs(((levels.takeProfit2 ?? levels.takeProfit1) as number) - (levels.entry as number)) / risk;
    if (flagBool('ENABLE_RR_GUARD') && rrFinal < STATE_RULES.minRiskRewardTp2) downgrade('NO_TRADE', 'rr_tp2_below_min');
  };

  if ((now() === 'ARMED' || now() === 'ENTER_NOW') && side) {
    if (failures.includes('implausible_price')) downgrade('NO_TRADE', 'implausible_price');
    // v10.2: o sinal vem com o plano; sem ele, nao ha o que conferir.
    if (now() !== 'NO_TRADE' && (!plan || (plan.direction === 'long') !== (side === 'BUY'))) downgrade('NO_TRADE', 'watch_plan_invalid');
    if ((now() === 'ARMED' || now() === 'ENTER_NOW') && real) {
      const p = plan as WatchPlan;
      const { price, atr: a } = real;
      const limit = levelsFromPlan(p, a);
      const position = pricePosition(p, price);
      if (typeof limit === 'string') {
        downgrade('NO_TRADE', limit === 'no_room' ? 'tp1_no_room' : 'stop_atr_out_of_range');
      } else if (position === 'invalidated') {
        downgrade('NO_TRADE', 'plan_invalidated');
      } else {
        levels = { entry: limit.entry, stopLoss: limit.stopLoss, takeProfit1: limit.takeProfit1, takeProfit2: limit.takeProfit2 };
        if (positive(input.currentPrice) && Math.abs(price - input.currentPrice) > STATE_RULES.stalePrintAtr * a) {
          stalePrint = true;
          notes.push('stale_print');
        }
        // D: distancia da borda proxima ao preco real, em ATR.
        const d = Math.abs(nearEdge(p) - price) / a;
        if (position === 'beyond_zone') downgrade('WATCH', 'zone_overrun');
        else if (position === 'before_zone' && d > STATE_RULES.armedMaxAtr) downgrade('WATCH', 'entry_far_from_price');
        if (now() === 'ENTER_NOW') {
          // Dentro da zona: entra a mercado, com stop e TP1 refeitos a partir do preco.
          const market = position === 'inside_zone' ? levelsFromPlan(p, a, price) : null;
          if (market && typeof market !== 'string') {
            levels = { entry: market.entry, stopLoss: market.stopLoss, takeProfit1: market.takeProfit1, takeProfit2: market.takeProfit2 };
          } else downgrade('ARMED', market === 'no_room' ? 'tp1_no_room' : 'not_at_price');
        }
        guardRiskReward();
      }
    } else if (now() === 'ARMED' || now() === 'ENTER_NOW') {
      // Sem REAL DATA: os niveis do modelo, a posicao pelo preco lido no print e
      // a distancia em R do proprio plano (D_R). A tela avisa que sao estimados.
      const p = plan as WatchPlan;
      const est = input.estimatedLevels;
      const price = input.currentPrice;
      if (!est || !positive(est.entry) || !positive(est.stopLoss) || !positive(est.takeProfit1) || !positive(price)) {
        downgrade('WATCH', 'levels_unverified');
      } else {
        const position = pricePosition(p, price);
        if (position === 'invalidated') {
          downgrade('NO_TRADE', 'plan_invalidated');
        } else {
          levels = { entry: est.entry, stopLoss: est.stopLoss, takeProfit1: est.takeProfit1, takeProfit2: positive(est.takeProfit2) ? est.takeProfit2 : null };
          const dR = Math.abs(nearEdge(p) - price) / Math.abs(est.entry - est.stopLoss);
          if (position === 'beyond_zone') downgrade('WATCH', 'zone_overrun');
          else if (position === 'before_zone' && dR > STATE_RULES.armedMaxStopR) downgrade('WATCH', 'entry_far_from_price');
          if (now() === 'ENTER_NOW' && position !== 'inside_zone') downgrade('ARMED', 'not_at_price');
          guardRiskReward();
        }
      }
    }
  }

  // News guard: com evento High na janela, o plano vira condicional (WATCH).
  let newsEvent: string | null = null;
  let newsGuardStatus: NewsGuardStatus = 'disabled';
  if (flagBool('ENABLE_NEWS_GUARD')) {
    if (now() !== 'ARMED' && now() !== 'ENTER_NOW') {
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
          downgrade('WATCH', 'news_event');
          newsEvent = `${imminent.country} ${imminent.title} (${imminent.minutesUntil}min)`;
        }
        newsGuardStatus = imminent ? (degraded ? 'degraded_event' : 'event') : (degraded ? 'degraded_no_event' : 'no_event');
      } catch (error) {
        newsGuardStatus = error instanceof CalendarTimeoutError ? 'timeout' : 'error';
      }
    }
  }

  // WATCH: o plano do modelo (num rebaixamento, o mesmo plano do sinal).
  if (now() === 'WATCH' && !plan) downgrade('NO_TRADE', 'watch_plan_invalid');

  const final = now();
  const isSignal = final === 'ARMED' || final === 'ENTER_NOW';
  let confidence = Number.isFinite(input.confidence) ? input.confidence : 0;
  let probabilities = NULL_PROBABILITIES;
  if (isSignal) {
    confidence = Math.min(confidence, confidenceCap(input.trendStrength));
    const p = input.probabilities;
    if (p.probabilityTp1 !== null) {
      const tp1 = clamp(p.probabilityTp1, confidence - STATE_RULES.probabilityTp1Band, confidence + STATE_RULES.probabilityTp1Band);
      probabilities = {
        probabilityTp1: tp1,
        probabilityTp2: p.probabilityTp2 === null ? null : Math.min(p.probabilityTp2, tp1),
        // v10: o stop fica perto de 100 - TP1 (e a soma nunca passa de 100).
        probabilityStop: p.probabilityStop === null ? null : Math.min(p.probabilityStop, 100 - tp1),
      };
    }
  } else {
    confidence = Math.min(confidence, STATE_RULES.confidenceCapNoSignal);
  }

  const downgraded = notes.some((n) => DOWNGRADE_NOTES.includes(n));
  return {
    state: final,
    recommendation: isSignal && side ? side : 'WAIT',
    confidence,
    entryType: isSignal ? (final === 'ENTER_NOW' ? 'market' : 'limit') : null,
    levels: isSignal ? levels : NULL_LEVELS,
    watchPlan: final === 'NO_TRADE' ? null : plan,
    dataMode: real ? 'real_data' : 'print',
    probabilities,
    validatorNotes: notes,
    validatorFlags,
    validatorAction: downgraded ? 'downgraded' : input.priceFixed ? 'fixed' : 'none',
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
