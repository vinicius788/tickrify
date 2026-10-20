/**
 * Matemática do relatório público de acurácia (`GET /api/ai/accuracy`).
 *
 * Funções puras, sem dependência de Prisma nem de Nest — o controller só
 * busca as linhas e chama daqui. Mesma matemática do `scripts/backtest/evaluate.py`
 * (intervalo de Wilson), para o número da página bater com o do relatório interno.
 */

/**
 * Outcomes gravados pelo SWEEPER AUTOMÁTICO (`worker/outcome.sweeper.ts`).
 *
 * ATENÇÃO: o campo `Analysis.outcome` é compartilhado com o veredicto MANUAL
 * que o usuário marca no My Trades, que grava em minúsculas ('tp1', 'tp2',
 * 'stop', 'open'). Esses NUNCA podem entrar na estatística pública — são
 * autorrelato, não medição. Por isso a lista abaixo é explícita.
 */
export const AUTOMATIC_OUTCOMES = [
  'WIN',
  'LOSS',
  'NO_FILL',
  'ABSTAIN',
  'UNTRACKABLE',
  'INCOMPLETE',
  'TIMEOUT',
] as const;

/**
 * Outcomes que a vitrine "48 hours later" mostra: todo plano de trade que o
 * sweeper conseguiu avaliar, inclusive os que não preencheram ou não
 * resolveram em 48h. Fora: ABSTAIN (WAIT), UNTRACKABLE e INCOMPLETE.
 */
export const PUBLIC_SCORED_OUTCOMES = ['WIN', 'LOSS', 'NO_FILL', 'TIMEOUT'] as const;

/** Data em que o grounding com candles ao vivo entrou em produção. */
export const GROUNDING_LIVE_SINCE = new Date('2026-07-17T00:00:00.000Z');

/** Abaixo disso, um recorte não é publicado com número — só com o n. */
export const MIN_N_TO_PUBLISH = 20;

export interface Interval {
  n: number;
  wins: number;
  losses: number;
  /** Percentuais já arredondados para 1 casa. null quando n = 0. */
  rate: number | null;
  low: number | null;
  high: number | null;
  /** false quando n < MIN_N_TO_PUBLISH — o front mostra o n, não a taxa. */
  publishable: boolean;
}

const round1 = (v: number) => Math.round(v * 1000) / 10;

/**
 * Intervalo de confiança de Wilson (95%) para uma proporção.
 * Preferido ao intervalo normal porque continua honesto com n pequeno e
 * com taxas perto de 0 ou 100 — exatamente o caso desta base.
 */
export function wilson(wins: number, losses: number): Interval {
  const n = wins + losses;
  if (n <= 0) {
    return { n: 0, wins: 0, losses: 0, rate: null, low: null, high: null, publishable: false };
  }

  const z = 1.96;
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;

  return {
    n,
    wins,
    losses,
    rate: round1(p),
    low: round1(Math.max(0, centre - margin)),
    high: round1(Math.min(1, centre + margin)),
    publishable: n >= MIN_N_TO_PUBLISH,
  };
}

export type ConfidenceBand = 'below60' | 'band60to69' | 'band70plus' | 'unknown';

/**
 * Bandas no limiar 70 que veio do backtest v2 (acima dele o produto chamava a
 * leitura de "Signal"). Em producao as bandas nao separaram (39,6% x 39,7% em
 * 30/09/2026, n=116) e o score saiu da tela nesse dia. A quebra continua
 * publicada na /accuracy como prova de que ele nao carrega informacao.
 */
export function confidenceBand(confidence: number | null | undefined): ConfidenceBand {
  if (confidence === null || confidence === undefined || !Number.isFinite(Number(confidence))) {
    return 'unknown';
  }
  const value = Number(confidence);
  if (value >= 70) return 'band70plus';
  if (value >= 60) return 'band60to69';
  return 'below60';
}

/**
 * Regra do candle do fill (20/10/2026), gravada em `outcomeDetail.fillCandleRule`.
 * - `legacy`: o TP1 vale ja no candle do fill (regra ate 20/10). Linhas sem o
 *   campo foram avaliadas assim.
 * - `stop_only`: no candle do fill so o stop conta; o TP1 vale a partir do
 *   candle seguinte. Em 30m nao da para saber se o TP1 daquele candle veio antes
 *   ou depois do fill, e a metodologia publicada diz que a entrada enche
 *   PRIMEIRO. E uma convencao pessimista, nao a ordem real: em 196 trades de
 *   24/09 a 10/10, dentro do intervalo dado pelos candles de 1m em 190 (legacy:
 *   4 WIN falsos, 2 LOSS pessimistas) -> 193 (stop_only: 0 WIN falso, 3 erros
 *   pessimistas).
 * TP1 e stop no mesmo candle DEPOIS do fill seguem LOSS nas duas regras.
 */
export type FillCandleRule = 'legacy' | 'stop_only';
export const FILL_CANDLE_RULES: readonly FillCandleRule[] = ['legacy', 'stop_only'];
/** Regra das avaliacoes novas do sweeper (trades e shadow dos WAIT). */
export const FILL_CANDLE_RULE: FillCandleRule = 'stop_only';

/** Regra de uma linha ja avaliada: sem o campo (ou com valor desconhecido) = legacy. */
export function fillCandleRuleOf(detail: unknown): FillCandleRule {
  const rule = (detail as { fillCandleRule?: unknown } | null | undefined)?.fillCandleRule;
  return rule === 'stop_only' ? 'stop_only' : 'legacy';
}

export interface OutcomeRow {
  outcome: string | null;
  confidence: number | null;
  createdAt: Date;
  /** So o `fillCandleRule` e lido (fillCandleRuleOf). */
  outcomeDetail?: unknown;
}

/** Soma WIN/LOSS de um conjunto de linhas. */
export function tally(rows: OutcomeRow[]): Interval {
  let wins = 0;
  let losses = 0;
  for (const row of rows) {
    if (row.outcome === 'WIN') wins += 1;
    else if (row.outcome === 'LOSS') losses += 1;
  }
  return wilson(wins, losses);
}

/**
 * Linhas separadas pela regra do candle do fill (decisao de 20/10/2026, opcao c):
 * a serie publica principal (`overall` e os cortes) segue so `legacy`, para o
 * historico continuar comparavel; `stop_only` e uma serie a parte. As duas medem
 * o mesmo evento com convencoes diferentes no candle do fill: nunca somar.
 * Sem `fillCandleRule` (ou com valor desconhecido) = legacy.
 */
export function splitByFillCandleRule<T extends OutcomeRow>(rows: T[]): Record<FillCandleRule, T[]> {
  const split: Record<FillCandleRule, T[]> = { legacy: [], stop_only: [] };
  for (const row of rows) split[fillCandleRuleOf(row.outcomeDetail)].push(row);
  return split;
}

/** Quantas linhas por outcome (o `breakdown` da /accuracy). */
export function breakdownOf(rows: OutcomeRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row.outcome);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}
