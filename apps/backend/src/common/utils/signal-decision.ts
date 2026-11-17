import { flagBool, flagNumber } from '../flags/feature-flags';
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
  reachProbability,
  snapInvalidation,
  stopMarginAtr,
  type VolRegime,
} from './plan-engine';
import type { HtfTrend } from '../../modules/ai/analysis-data-coverage';

// ============================================================================
// VALIDADOR DE ESTADO DO v11 (02/11/2026): O CODIGO DECIDE O ESTADO
// ----------------------------------------------------------------------------
// O modelo le o mercado e entrega o plano; este codigo decide entre NO_TRADE,
// WATCH e ENTER_NOW com as constantes de ENGINE_RULES (plan-engine.ts). O
// equilibrio entre entrar e aguardar mora aqui e na interface (modo leitura),
// nunca no prompt.
// So rebaixa em relacao ao estado do modelo, com uma excecao: WATCH do modelo
// com entrada a mercado valida e todas as condicoes do ENTER_NOW vira
// ENTER_NOW. Cada mudanca de estado vai para `validatorNotes` com o motivo.
// A ordem limit (ARMED) saiu em 02/11/2026: perdeu em todas as rodadas
// medidas. O que seria ARMED vira WATCH com o plano e o nivel que destrava a
// entrada; o ARMED segue no tipo so para exibir analises antigas.
// Mapeamento fixo: ENTER_NOW = BUY/SELL a mercado; WATCH e NO_TRADE = WAIT sem
// niveis principais (o WATCH leva o plano em `watchPlan`). Adapter e worker
// decidem por aqui (paridade).
// ============================================================================

export const ENTER_AT_LEVEL_FLAG = 'ENGINE_ENTER_AT_LEVEL';
/** WATCH mostra tambem o plano a mercado quando a geometria dele vale (11/11/2026). */
export const MARKET_PLAN_FLAG = 'ENGINE_MARKET_PLAN_ON_WATCH';
/**
 * Sem swing encaixada na invalidacao (16/11/2026): 0 = NO_TRADE, o motor de
 * sempre; 1 = o plano segue com a invalidacao do modelo, no maximo ate WATCH;
 * 2 = segue tambem ate ENTER_NOW. Risco, alvo, checklist e atrasado nao mudam.
 */
export const SNAP_FALLBACK_FLAG = 'ENGINE_SNAP_FALLBACK';
/**
 * Itens obrigatorios do ENTER_NOW (16/11/2026): 0 = C2, C3, C6, C7, o motor de
 * sempre; 1 = C2, C3, C6 (C7 em FAIL vira aviso); 2 = C3, C6 (C2 e C7 viram
 * aviso). O minimo de PASS nao muda. So com velas reais.
 */
export const ENTER_CHECKS_FLAG = 'ENGINE_ENTER_REQUIRED_CHECKS';
/** Movimento atrasado deixa de barrar o ENTER_NOW e vira aviso (item 8 de `entryWarnings`). 16/11/2026. */
export const LATE_WARNING_FLAG = 'ENGINE_LATE_AS_WARNING';
/** Item de `entryWarnings` do movimento atrasado (2 e 7 sao os do checklist). */
export const LATE_WARNING_ITEM = 8;
/**
 * Alvo no proximo nivel (17/11/2026): com a chave ligada, quando o primeiro
 * nivel (target1) fica a menos de 1R da entrada e o seguinte (target2) da 1R ou
 * mais, o TP1 vai para o seguinte (teto de 1,5R de sempre). Aviso 11 em
 * `entryWarnings` e `result.targetMoved`. Desligada = motor de sempre.
 */
export const NEXT_TARGET_FLAG = 'ENGINE_NEXT_TARGET';
export const NEXT_TARGET_WARNING_ITEM = 11;

/** Entrada com o alvo do plano; sem espaco e com a chave ligada, tenta o proximo nivel. */
function levelsWithNextTarget(plan: WatchPlan, compute: (p: WatchPlan) => EntryLevels | EntryRejection): { levels: EntryLevels | EntryRejection; moved: boolean } {
  const first = compute(plan);
  if (first !== 'no_room' || plan.target2 === null || !flagBool(NEXT_TARGET_FLAG)) return { levels: first, moved: false };
  const next = compute({ ...plan, target1: plan.target2, target2: null });
  return typeof next === 'string' ? { levels: first, moved: false } : { levels: next, moved: true };
}
/** WATCH do modelo sem geometria valida a mercado nem no nivel segue WATCH (sem niveis), em vez de NO_TRADE. 16/11/2026. */
export const GEOMETRY_WATCH_FLAG = 'ENGINE_WATCH_ON_REJECTED_GEOMETRY';

/**
 * Modo permissivo (16/11/2026, decisao do dono): 1 = ENTER_NOW com direcao, C3 e
 * C6 em PASS, geometria valida e 4 de 7 PASS. C2, C7, atrasado, contra o 4h e
 * forex deixam de barrar e viram avisos (`entryWarnings` 2, 7, 8, 9, 10); sem
 * swing encaixada vale a invalidacao do modelo. Seguem barrando: plano
 * invalidado, risco fora de 0,5 a 2 ATR, alvo abaixo de 1R, noticias, print
 * sem preco na zona. 0 = motor de sempre.
 */
export const PERMISSIVE_FLAG = 'ENGINE_PERMISSIVE';
/** So apresentacao (16/11/2026): 1 = WATCH com geometria valida no nivel e mostrado como entrada pendente ("BUY/SELL on pullback"). O estado nao muda. */
export const PENDING_ENTRY_FLAG = 'ENGINE_PENDING_ENTRY_LABEL';
export const HTF_WARNING_ITEM = 9;
export const FOREX_WARNING_ITEM = 10;
const permissive = (): boolean => flagNumber(PERMISSIVE_FLAG) === 1;

function snapFallbackMode(): 0 | 1 | 2 {
  if (permissive()) return 2;
  const value = flagNumber(SNAP_FALLBACK_FLAG);
  return value === 1 || value === 2 ? value : 0;
}

function enterNowChecks(): readonly number[] {
  if (permissive()) return [3, 6];
  const value = flagNumber(ENTER_CHECKS_FLAG);
  if (value === 1) return [2, 3, 6];
  if (value === 2) return [3, 6];
  return ENGINE_RULES.enterNowChecks;
}

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
  | 'limit_order_retired'
  | 'required_check_failed'
  | 'checks_below_min'
  | 'late_move'
  | 'setup_failed'
  | 'no_valid_geometry'
  | 'levels_unverified'
  | 'not_at_price'
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
  /** Regime de volatilidade do tempo grafico (volatilityRegime); null sem o calculo. */
  volRegime: VolRegime | null;
  /** Posicao do preco no range visivel (0 = minima, 100 = maxima); null sem o calculo. */
  rangePosPct: number | null;
}

/** Um nivel e a distancia dele ao preco real, em ATR. */
export interface LevelDistance {
  price: number;
  atr: number;
}

/** Onde o preco esta (modo leitura), calculado pelo codigo a partir do REAL DATA. */
export interface PriceLocation {
  price: number;
  atr: number;
  rangePosPct: number | null;
  htfTrend: HtfTrend | null;
  /** Invalidacao estrutural do plano. */
  invalidation: LevelDistance | null;
  /** Swing real mais proxima abaixo e acima do preco. */
  support: LevelDistance | null;
  resistance: LevelDistance | null;
  /** Nivel do plano (borda proxima da area). */
  planLevel: LevelDistance | null;
}

/** Chance calibrada de o preco chegar ao nivel do WATCH dentro da validade. */
export interface WatchReach {
  /** 0 a 1. */
  probability: number;
  candles: number;
}

/** O WATCH anterior do setup, na reanalise (setup-continuation.ts). */
export interface PriorWatchInput {
  plan: WatchPlan;
  /** A IA leu o plano anterior como CONFIRMED: preco na zona e gatilho presente. */
  confirmed: boolean;
}

/** O plano que o modelo entregou e o codigo rebaixou para NO_TRADE. So medicao: nada na tela le. */
export interface RejectedPlan {
  modelState: SignalState;
  reason: ValidatorReason;
  plan: WatchPlan;
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
  /** So na reanalise de um setup com WATCH valendo. */
  priorWatch?: PriorWatchInput | null;
}

export interface SignalDecisionResult {
  state: SignalState;
  recommendation: Recommendation;
  confidence: number;
  entryType: string | null;
  /** Niveis principais (do motor do plano): so o ENTER_NOW os tem. */
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
  /** WATCH com o nivel entre o preco e a invalidacao e calibracao do par e regime; senao null. */
  watchReach: WatchReach | null;
  /** Onde o preco esta; null sem REAL DATA (a tela avisa que os niveis sao estimados). */
  location: PriceLocation | null;
  /**
   * WATCH com REAL DATA: os niveis que o motor usaria se destravasse no nivel do
   * plano (entryLevels com a margem calibrada, TP1 com o teto de 1,5R), os
   * mesmos do rastreador. null sem REAL DATA ou sem geometria valida no nivel.
   */
  watchLevels: EntryLevels | null;
  /**
   * WATCH com REAL DATA e a chave ENGINE_MARKET_PLAN_ON_WATCH ligada: os niveis
   * da entrada A MERCADO quando a geometria dela vale (risco ate 2 ATR, alvo a
   * 1R ou mais) e o que segurou o ENTER_NOW foi o checklist ou o atrasado. O
   * estado continua WATCH; a tela mostra os dois planos e a pessoa escolhe.
   */
  marketLevels: EntryLevels | null;
  /** Modelo pediu WATCH ou ENTER_NOW e o codigo rebaixou para NO_TRADE; null fora disso. */
  rejectedPlan: RejectedPlan | null;
  /** ENTER_NOW liberado pela regra da chave ENGINE_ENTER_AT_LEVEL. */
  enterAtLevel: boolean;
  /** WATCH ou ENTER_NOW que seguiu com a invalidacao do modelo, sem swing encaixada (chave ENGINE_SNAP_FALLBACK). */
  snapFallback: boolean;
  /** ENTER_NOW com C2 ou C7 em FAIL (chave ENGINE_ENTER_REQUIRED_CHECKS) ou com movimento atrasado (8, chave ENGINE_LATE_AS_WARNING). */
  entryWarnings: number[];
  /** ENTER_NOW que so existe pelo modo permissivo (chave ENGINE_PERMISSIVE): serie propria na medicao. */
  permissiveEntry: boolean;
  /** WATCH com niveis validos no recuo, mostrado como entrada pendente (chave ENGINE_PENDING_ENTRY_LABEL). So apresentacao e medicao. */
  pendingEntry: boolean;
  /** O TP1 mostrado esta no proximo nivel (chave ENGINE_NEXT_TARGET): ENTER_NOW a mercado ou niveis do WATCH. */
  targetMoved: boolean;
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
/** Degrau de baixo: ENTER_NOW -> WATCH -> NO_TRADE (o ARMED nao e mais emitido). */
const lower = (s: SignalState): SignalState => (s === 'ENTER_NOW' || s === 'ARMED' ? 'WATCH' : 'NO_TRADE');

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
export function calibrationPair(symbol: string): string | null {
  return canonicalFxPair(symbol) ?? normalizeToBinancePerp(symbol).binanceSymbol ?? (String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null);
}

/**
 * PASS exigidos para o ENTER_NOW: o minimo, e 1 a mais se houver
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
  /** O plano com a invalidacao encaixada na swing real (ou a do modelo, com `unsnapped`). */
  plan: WatchPlan;
  /** Sem swing encaixada: a invalidacao e a do modelo (chave ENGINE_SNAP_FALLBACK). */
  unsnapped: boolean;
  /** A entrada a mercado usa o proximo nivel como TP1 (chave ENGINE_NEXT_TARGET). */
  marketTargetMoved: boolean;
  market: EntryLevels | EntryRejection;
  /** Entrada no nivel do plano (o recuo que destrava o WATCH). */
  limit: EntryLevels | EntryRejection;
  late: boolean;
  checks: ReadonlyMap<number, boolean> | null;
  passes: number;
  requiredPasses: number;
}

/**
 * Mede o plano contra as velas reais: confere que o preco nao passou da
 * invalidacao do modelo (`plan_invalidated`), encaixa a invalidacao
 * estrutural (sem swing entre o preco e ela, a ate 0,5 ATR:
 * `invalidation_unsnapped`) e calcula as duas entradas (a mercado e no nivel
 * do plano).
 */
export function evaluatePlan(input: {
  plan: WatchPlan;
  symbol: string;
  structureValidation: unknown;
  price: number;
  atr: number;
  htfTrend: HtfTrend | null;
  volRegime: VolRegime | null;
  swings: readonly Pick<Swing, 'kind' | 'price'>[];
  late: boolean;
}): PlanEvaluation | ValidatorReason {
  if (pricePosition(input.plan, input.price) === 'invalidated') return 'plan_invalidated';
  const snapped = snapInvalidation(input.plan, input.swings, input.atr, input.price);
  if (!snapped && snapFallbackMode() === 0) return 'invalidation_unsnapped';
  const plan = snapped ?? input.plan;
  const margin = stopMarginAtr(calibrationPair(input.symbol), input.volRegime);
  const checks = parsePassFailChecklist(input.structureValidation);
  const market = levelsWithNextTarget(plan, (p) => entryLevels(p, input.atr, input.price, margin));
  return {
    plan,
    unsnapped: !snapped,
    marketTargetMoved: market.moved,
    market: market.levels,
    limit: levelsWithNextTarget(plan, (p) => limitEntryLevels(p, input.atr, input.price, margin)).levels,
    late: input.late,
    checks,
    passes: checks ? [...checks.values()].filter(Boolean).length : 0,
    requiredPasses: permissive() ? ENGINE_RULES.minPassWatch : requiredPasses(input.symbol, plan.direction, input.htfTrend),
  };
}

const allPass = (checks: ReadonlyMap<number, boolean> | null, items: readonly number[]) =>
  !!checks && items.every((n) => checks.get(n) === true);

/** Por que o estado nao vale (null = vale). */
function whyNot(state: SignalState, ev: PlanEvaluation): ValidatorReason | null {
  const R = ENGINE_RULES;
  const marketValid = typeof ev.market !== 'string';
  if (state === 'ENTER_NOW') {
    if (ev.unsnapped && snapFallbackMode() !== 2) return 'invalidation_unsnapped';
    if (!marketValid) return 'market_entry_invalid';
    if (!allPass(ev.checks, enterNowChecks())) return 'required_check_failed';
    if (ev.passes < ev.requiredPasses) return 'checks_below_min';
    return ev.late ? 'late_move' : null;
  }
  if (state === 'WATCH') {
    if (!allPass(ev.checks, R.watchChecks)) return 'setup_failed';
    if (!marketValid && typeof ev.limit === 'string' && !flagBool(GEOMETRY_WATCH_FLAG)) return 'no_valid_geometry';
    return ev.passes < R.minPassWatch ? 'checks_below_min' : null;
  }
  return null;
}

/** ARMED do modelo (ordem limit) vira WATCH com o mesmo plano, anotado. */
function retireArmed(model: SignalState): { start: SignalState; notes: ValidatorNote[] } {
  return model === 'ARMED'
    ? { start: 'WATCH', notes: [{ from: 'ARMED', to: 'WATCH', reason: 'limit_order_retired' }] }
    : { start: model, notes: [] };
}

/**
 * Estado final a partir do estado do modelo: desce ENTER_NOW -> WATCH ->
 * NO_TRADE ate a primeira condicao que vale, anotando cada degrau. WATCH do
 * modelo sobe para ENTER_NOW quando todas as condicoes dele valem; o ARMED do
 * modelo vira WATCH e nao sobe.
 */
export function chooseState(model: SignalState, ev: PlanEvaluation, allowPromotion = true): { state: SignalState; notes: ValidatorNote[]; levels: PlanLevels } {
  const { start, notes } = retireArmed(model);
  let state = start;
  if (allowPromotion && model === 'WATCH' && whyNot('ENTER_NOW', ev) === null) {
    notes.push({ from: 'WATCH', to: 'ENTER_NOW', reason: 'market_entry_valid' });
    state = 'ENTER_NOW';
  }
  for (let reason = whyNot(state, ev); state !== 'NO_TRADE' && reason; reason = whyNot(state, ev)) {
    notes.push({ from: state, to: lower(state), reason });
    state = lower(state);
  }
  const levels = state === 'ENTER_NOW' && typeof ev.market !== 'string'
    ? { entry: ev.market.entry, stopLoss: ev.market.stopLoss, takeProfit1: ev.market.takeProfit1, takeProfit2: ev.market.takeProfit2 }
    : NULL_LEVELS;
  return { state, notes, levels };
}

/**
 * Sem REAL DATA (ativo sem fonte ou cota do dia acabou): os niveis do modelo e
 * a posicao pelo preco lido no print; ENTER_NOW so com o preco dentro da
 * zona. Nao promove. A tela avisa que os niveis sao estimados.
 */
function choosePrintState(input: SignalDecisionInput, plan: WatchPlan): { state: SignalState; notes: ValidatorNote[]; levels: PlanLevels } {
  const R = ENGINE_RULES;
  const checks = parsePassFailChecklist(input.structureValidation);
  const passes = checks ? [...checks.values()].filter(Boolean).length : 0;
  const required = permissive() ? R.minPassWatch : requiredPasses(input.symbol, plan.direction, null);
  const est = input.estimatedLevels;
  const price = input.currentPrice;
  const levelsOk = !!est && positive(est.entry) && positive(est.stopLoss) && positive(est.takeProfit1) && positive(price);
  const position = positive(price) ? pricePosition(plan, price) : null;
  if (position === 'invalidated' && input.state !== 'NO_TRADE') {
    return { state: 'NO_TRADE', notes: [{ from: input.state, to: 'NO_TRADE', reason: 'plan_invalidated' }], levels: NULL_LEVELS };
  }
  const why = (state: SignalState): ValidatorReason | null => {
    if (state === 'ENTER_NOW') {
      if (!levelsOk) return 'levels_unverified';
      if (position !== 'inside_zone') return 'not_at_price';
      if (!allPass(checks, permissive() ? [3, 6] : R.enterNowChecks)) return 'required_check_failed';
      return passes < required ? 'checks_below_min' : null;
    }
    if (state === 'WATCH') {
      if (!allPass(checks, R.watchChecks)) return 'setup_failed';
      return passes < R.minPassWatch ? 'checks_below_min' : null;
    }
    return null;
  };
  const { start, notes } = retireArmed(input.state);
  let state = start;
  for (let reason = why(state); state !== 'NO_TRADE' && reason; reason = why(state)) {
    notes.push({ from: state, to: lower(state), reason });
    state = lower(state);
  }
  const levels = state === 'ENTER_NOW'
    ? { entry: est!.entry, stopLoss: est!.stopLoss, takeProfit1: est!.takeProfit1, takeProfit2: positive(est!.takeProfit2) ? est!.takeProfit2 : null }
    : NULL_LEVELS;
  return { state, notes, levels };
}

/**
 * Chave ENGINE_ENTER_AT_LEVEL: o preco voltou a zona do WATCH anterior, na mesma
 * direcao, e a IA confirmou. O "atrasado" mede a tendencia inteira e nao sai
 * com o recuo (3 pernas continuam 3 pernas): sem isto, o WATCH nascido de um
 * movimento atrasado nunca destrava no nivel que ele mesmo pediu.
 */
function isAtPriorLevel(prior: PriorWatchInput | null | undefined, plan: WatchPlan | null, price: number): boolean {
  return !!prior && !!plan && prior.confirmed && prior.plan.direction === plan.direction
    && pricePosition(prior.plan, price) === 'inside_zone' && flagBool(ENTER_AT_LEVEL_FLAG);
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
  const atLevel = !!real && isAtPriorLevel(input.priorWatch, modelPlan, real.price);
  const lateNow = !!real && !!modelPlan && !atLevel && !!real.late?.[modelPlan.direction];
  const lateAsWarning = lateNow && (flagBool(LATE_WARNING_FLAG) || permissive());
  let chosen: { state: SignalState; notes: ValidatorNote[]; levels: PlanLevels };
  let evaluation: PlanEvaluation | null = null;
  if (model === 'NO_TRADE') chosen = { state: 'NO_TRADE', notes: [], levels: NULL_LEVELS };
  else if (side && failures.includes('implausible_price')) chosen = stop('implausible_price');
  else if (!modelPlan) chosen = stop('watch_plan_invalid');
  else if (side && (modelPlan.direction === 'long') !== (side === 'BUY')) chosen = stop('state_mismatch');
  else if (real) {
    const ev = evaluatePlan({
      plan: modelPlan, symbol: input.symbol, structureValidation: input.structureValidation,
      price: real.price, atr: real.atr as number, htfTrend: real.htfTrend, volRegime: real.volRegime, swings: real.swings ?? [],
      late: lateNow && !lateAsWarning,
    });
    if (typeof ev === 'string') chosen = { state: 'NO_TRADE', notes: [...mismatch, { from: start, to: 'NO_TRADE', reason: ev }], levels: NULL_LEVELS };
    else {
      plan = ev.plan;
      evaluation = ev;
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
    if (state !== 'ENTER_NOW') {
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

  const isSignal = state === 'ENTER_NOW';
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

  // Avisos do ENTER_NOW: itens obrigatorios do motor de sempre em FAIL, atrasado e, no modo permissivo, contra o 4h e forex.
  const entryChecks = evaluation?.checks ?? (permissive() ? parsePassFailChecklist(input.structureValidation) : null);
  const entryWarnings: number[] = [];
  if (isSignal && entryChecks) {
    entryWarnings.push(...ENGINE_RULES.enterNowChecks.filter((n) => entryChecks.get(n) !== true));
    if (lateAsWarning) entryWarnings.push(LATE_WARNING_ITEM);
    if (evaluation?.marketTargetMoved) entryWarnings.push(NEXT_TARGET_WARNING_ITEM);
    if (permissive() && plan) {
      if (real?.htfTrend === (plan.direction === 'long' ? 'downtrend' : 'uptrend')) entryWarnings.push(HTF_WARNING_ITEM);
      if (isForexPair(input.symbol)) entryWarnings.push(FOREX_WARNING_ITEM);
    }
  }
  const entryPasses = entryChecks ? [...entryChecks.values()].filter(Boolean).length : 0;
  const permissiveEntry = isSignal && permissive() && !!plan
    && (entryWarnings.length > 0 || !!evaluation?.unsnapped || entryPasses < requiredPasses(input.symbol, plan.direction, real?.htfTrend ?? null));

  const noTradeNote = notes.find((n) => n.to === 'NO_TRADE');
  const rejectedPlan: RejectedPlan | null = state === 'NO_TRADE' && model !== 'NO_TRADE' && input.watchPlan && noTradeNote
    ? { modelState: model, reason: noTradeNote.reason, plan: input.watchPlan }
    : null;

  const watchMove = state === 'WATCH' && real && plan ? watchLevelsWithMove(plan, input.symbol, real) : { levels: null, moved: false };
  const watchLevels = watchMove.levels;

  const action: ValidatorAction = rank(state) < rank(model)
    ? 'downgraded'
    : rank(state) > rank(model) ? 'promoted' : input.priceFixed ? 'fixed' : 'none';
  return {
    state,
    recommendation: isSignal && side ? side : isSignal && plan ? (plan.direction === 'long' ? 'BUY' : 'SELL') : 'WAIT',
    confidence,
    entryType: isSignal ? 'market' : null,
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
    watchReach: state === 'WATCH' && real && plan ? watchReachOf(plan, input.symbol, real) : null,
    location: real ? locationOf(real, state === 'NO_TRADE' ? null : plan) : null,
    watchLevels,
    pendingEntry: watchLevels !== null && flagNumber(PENDING_ENTRY_FLAG) === 1,
    targetMoved: (isSignal && !!evaluation?.marketTargetMoved) || watchMove.moved,
    marketLevels: state === 'WATCH' && evaluation && typeof evaluation.market !== 'string' && flagBool(MARKET_PLAN_FLAG) ? evaluation.market : null,
    rejectedPlan,
    enterAtLevel: atLevel && state === 'ENTER_NOW',
    snapFallback: !!evaluation?.unsnapped && state !== 'NO_TRADE',
    entryWarnings,
    permissiveEntry,
  };
}

/** Niveis do WATCH se destravar no nivel do plano (borda proxima), como o rastreador mede. */
export function watchLevelsOf(plan: WatchPlan, symbol: string, real: RealDataInput): EntryLevels | null {
  return watchLevelsWithMove(plan, symbol, real).levels;
}

function watchLevelsWithMove(plan: WatchPlan, symbol: string, real: RealDataInput): { levels: EntryLevels | null; moved: boolean } {
  const margin = stopMarginAtr(calibrationPair(symbol), real.volRegime);
  const { levels, moved } = levelsWithNextTarget(plan, (p) => entryLevels(p, real.atr as number, nearEdge(p), margin));
  return typeof levels === 'string' ? { levels: null, moved: false } : { levels, moved };
}

/** Preco, posicao no range, tendencia do 4h e a distancia em ATR ate os niveis que importam. */
export function locationOf(real: RealDataInput, plan: WatchPlan | null): PriceLocation {
  const atr = real.atr as number;
  const at = (price: number): LevelDistance => ({ price, atr: Math.abs(real.price - price) / atr });
  const swings = real.swings ?? [];
  const below = swings.filter((s) => s.kind === 'low' && s.price < real.price).map((s) => s.price);
  const above = swings.filter((s) => s.kind === 'high' && s.price > real.price).map((s) => s.price);
  return {
    price: real.price,
    atr,
    rangePosPct: real.rangePosPct,
    htfTrend: real.htfTrend,
    invalidation: plan ? at(plan.invalidation) : null,
    support: below.length ? at(Math.max(...below)) : null,
    resistance: above.length ? at(Math.min(...above)) : null,
    planLevel: plan ? at(nearEdge(plan)) : null,
  };
}

/** Chance de chegar ao nivel do plano (borda proxima) antes de o preco andar ate o alvo. */
function watchReachOf(plan: WatchPlan, symbol: string, real: RealDataInput): WatchReach | null {
  const atr = real.atr as number;
  const edge = nearEdge(plan);
  const pullback = plan.direction === 'long' ? edge < real.price && edge > plan.invalidation : edge > real.price && edge < plan.invalidation;
  if (!pullback) return null;
  const probability = reachProbability(
    calibrationPair(symbol), real.volRegime,
    Math.abs(real.price - edge) / atr, plan.validForCandles, Math.abs(plan.target1 - real.price) / atr,
  );
  return probability === null ? null : { probability, candles: plan.validForCandles };
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
  const isSignal = decision.state === 'ENTER_NOW';
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
