import { Recommendation, hasInvalidTradePlanLevels } from './analysis-normalizer';

// ============================================================================
// VALIDADOR DO PLANO DE TRADE (12/10/2026) — codigo puro, sem IA
// ----------------------------------------------------------------------------
// Roda depois da resposta do modelo e antes de qualquer coisa chegar a tela.
// Cada regra devolve um codigo; quem chama decide o destino:
//   - `direction` e `incomplete` (BROKEN_PLAN_RULES): o adapter repete a
//     chamada UMA vez; se continuar quebrado, FALHA a analise (o tick volta).
//     Virar WAIT cobraria o assinante por um erro do modelo.
//   - as outras: o `decideSignal` rebaixa para WAIT, mantendo os niveis,
//     menos as de MEASURE_ONLY_RULES, que so ficam registradas.
// O R/R minimo continua sendo o guard do `decideSignal` (decisao de 05/10).
// ============================================================================

export type TradePlanRule = 'direction' | 'incomplete' | 'stop_inside_invalidation' | 'implausible_price';

/** Plano quebrado: nao vira WAIT, falha (depois de uma nova tentativa no adapter). */
export const BROKEN_PLAN_RULES: readonly TradePlanRule[] = ['direction', 'incomplete'];

/**
 * Regras que so MEDEM (vao para `validator_flags`, nao rebaixam). Em 12/10 o
 * stop antes da invalidacao pegaria 25 de 349 trades (7%) dos 30 dias: virar
 * WAIT mudaria o que o motor entrega sem saber se esses trades perdem mais.
 * Decidir com o resultado deles (sweeper), nao antes.
 */
export const MEASURE_ONLY_RULES: readonly TradePlanRule[] = ['stop_inside_invalidation'];

/** Nivel fora de [preco/2, preco*2] do preco lido no print e numero absurdo. */
export const PLAUSIBLE_PRICE_MIN_RATIO = 0.5;
export const PLAUSIBLE_PRICE_MAX_RATIO = 2;

export interface TradePlanInput {
  side: Recommendation;
  entry: number | null | undefined;
  stopLoss: number | null | undefined;
  takeProfit1: number | null | undefined;
  takeProfit2: number | null | undefined;
  invalidationLevel: number | null | undefined;
  /** Preco atual lido no print. Sem ele (0/null) a regra de faixa nao roda. */
  currentPrice: number | null | undefined;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Regras que o plano quebra, na ordem acima. WAIT nao tem plano: lista vazia. */
export function validateTradePlan(input: TradePlanInput): TradePlanRule[] {
  if (input.side === 'WAIT') return [];
  const failures: TradePlanRule[] = [];
  const { side, entry, stopLoss, takeProfit1, takeProfit2, invalidationLevel, currentPrice } = input;

  // BUY/SELL precisa de entrada, stop e ao menos um alvo, todos numeros > 0.
  const positive = (value: number | null | undefined) => finite(value) && value > 0;
  if (!positive(entry) || !positive(stopLoss) || !(positive(takeProfit1) || positive(takeProfit2))) {
    failures.push('incomplete');
  }

  // BUY: stop abaixo da entrada e alvos acima. SELL: o inverso.
  const stopWrongSide = finite(entry) && finite(stopLoss) &&
    (side === 'BUY' ? stopLoss >= entry : stopLoss <= entry);
  if (stopWrongSide || hasInvalidTradePlanLevels(side, entry, stopLoss, takeProfit1, takeProfit2)) {
    failures.push('direction');
  }

  // O stop fica ALEM da invalidacao (ou nela): antes dela, o trade e
  // encerrado enquanto a tese ainda esta de pe.
  if (finite(stopLoss) && finite(invalidationLevel) && invalidationLevel > 0 &&
      (side === 'BUY' ? stopLoss > invalidationLevel : stopLoss < invalidationLevel)) {
    failures.push('stop_inside_invalidation');
  }

  if (finite(currentPrice) && currentPrice > 0) {
    const levels = [entry, stopLoss, takeProfit1, takeProfit2].filter(finite);
    const outside = levels.some(
      (level) => level <= 0 ||
        level < currentPrice * PLAUSIBLE_PRICE_MIN_RATIO ||
        level > currentPrice * PLAUSIBLE_PRICE_MAX_RATIO,
    );
    if (outside) failures.push('implausible_price');
  }

  return failures;
}
