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

export type TradePlanRule =
  | 'direction'
  | 'incomplete'
  | 'stop_inside_invalidation'
  | 'implausible_price'
  | 'limit_needs_confirmation';

/** Plano quebrado: nao vira WAIT, falha (depois de uma nova tentativa no adapter). */
export const BROKEN_PLAN_RULES: readonly TradePlanRule[] = ['direction', 'incomplete'];

/**
 * Regras que so MEDEM (vao para `validator_flags`, nao rebaixam). Em 12/10 o
 * stop antes da invalidacao pegaria 25 de 349 trades (7%) dos 30 dias: virar
 * WAIT mudaria o que o motor entrega sem saber se esses trades perdem mais.
 * Decidir com o resultado deles (sweeper), nao antes.
 * 19/10/2026: `limit_needs_confirmation` (ordem limitada cujo texto exige uma
 * confirmacao antes de entrar) so mede: em 92 respostas guardadas do luna, 32
 * de 83 planos limit tinham a frase. O sweeper conta o toque no preco como
 * entrada; o texto pede esperar a rejeicao. Corrigir e trabalho do prompt.
 */
export const MEASURE_ONLY_RULES: readonly TradePlanRule[] = ['stop_inside_invalidation', 'limit_needs_confirmation'];

// "only after a sweep and rejection", "após rejeição", "aguardar ... e rejeição".
// A frase termina em ";" ou em ponto seguido de espaco (o ponto de "1.0785" nao corta).
// Parte opcional ("rejection preferred", "idealmente com rejeição") nao conta.
const CONFIRMATION_REQUIRED = [
  /\b(?:only after|after|once|upon|wait(?:ing)? for|requires?|needs?)\b(?:(?![.;](?:\s|$)).){0,60}?\b(?:rejections?|rejects?|rejected|sweeps?|swept|confirmations?|confirms?|confirmed|closes? (?:back )?(?:above|below)|reclaims?|reaction|engulf\w*)/i,
  /(?:somente após|apenas após|após|depois d[aeo]|somente com|apenas com)(?:(?![.;](?:\s|$)).){0,60}?(?:rejei|varr|confirma|fechamento|retomada|reação)/i,
  /\baguardar\b(?:(?![.;](?:\s|$)).){0,80}?\be (?:candle de )?(?:rejei|reação)/i,
];
const OPTIONAL_CONFIRMATION = /prefer|ideal|favorece/i;
// Regra de cancelamento nao e condicao de entrada ("cancel after a close above
// 3448", Experimento D, 19/10/2026): de "cancel"/"invalid" ate o fim da frase sai.
const CLAUSE_SPLIT = /[;]|[.](?=\s|$)/;
const CANCEL_RULE = /\b(?:cancel\w*|invalid\w*|cancelar\w*|invalida\w*)/i;

/** Ordem limitada cujo texto so entra depois de uma confirmacao (rejeicao, sweep, fechamento). */
export function limitNeedsConfirmation(entryType: unknown, entryCondition: unknown): boolean {
  if (String(entryType ?? '').trim().toLowerCase() !== 'limit') return false;
  const text = String(entryCondition ?? '')
    .split(CLAUSE_SPLIT)
    .map((clause) => clause.split(CANCEL_RULE)[0])
    .join('; ');
  return CONFIRMATION_REQUIRED.some((pattern) => {
    const match = text.match(pattern);
    return match !== null && !OPTIONAL_CONFIRMATION.test(match[0]);
  });
}

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
  /** Tipo e condicao da entrada, para `limit_needs_confirmation`. */
  entryType?: unknown;
  entryCondition?: unknown;
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

  if (limitNeedsConfirmation(input.entryType, input.entryCondition)) {
    failures.push('limit_needs_confirmation');
  }

  return failures;
}
