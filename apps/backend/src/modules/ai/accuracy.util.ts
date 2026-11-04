/**
 * Matemática do relatório público de acurácia (`GET /api/ai/accuracy`).
 *
 * Funções puras, sem Prisma — o controller só busca as linhas e chama daqui. Mesma matemática do `scripts/backtest/evaluate.py`
 * (intervalo de Wilson), para o número da página bater com o do relatório interno.
 */
import { canonicalFxPair } from '../../common/utils/analysis-normalizer';
import { normalizeToBinancePerp } from '../market/market.service';
import { watchOutcomeOf, type WatchTrack } from './watch-pending';

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

// ── Motor atual x anterior (04/11/2026) ─────────────────────────────────────

/**
 * Motor atual = `result.engine.version` com major >= 4 (ENGINE_VERSION '4.0.0',
 * v11). O deploy ficou live em 03/11/2026 01:24 UTC; a versao gravada decide,
 * a data so aparece no texto. Sem versao (analise antiga) = motor anterior.
 */
export const CURRENT_ENGINE_MAJOR = 4;
export const CURRENT_ENGINE_SINCE = new Date('2026-11-03T01:24:00.000Z');

/** Major da versao gravada; null sem versao legivel. */
export function engineMajor(version: unknown): number | null {
  const m = typeof version === 'string' ? /^(\d+)/.exec(version.trim()) : null;
  return m ? Number(m[1]) : null;
}

export const isCurrentEngine = (version: unknown) => (engineMajor(version) ?? 0) >= CURRENT_ENGINE_MAJOR;

/** Predicado SQL equivalente ao isCurrentEngine, sobre o `result` de "Analysis" com alias `a`. */
export const CURRENT_ENGINE_SQL =
  `COALESCE(substring(a."result"->'engine'->>'version' from '^\\s*([0-9]+)')::int, 0) >= ${CURRENT_ENGINE_MAJOR}`;

/**
 * Bloco REAL DATA: INTERMARKET com o EUR/USD invertido (6.2 do CLAUDE.md): ouro
 * e forex do motor atual criados ate o deploy da correcao (03/11/2026 17:28:26
 * UTC). Ficam na conta e ganham contagem propria para a nota de rodape.
 */
export const EURUSD_BLOCK_FIXED_AT = new Date('2026-11-03T17:28:26.000Z');

/** Taxa de acerto que empata com o R medio do TP1: 1 / (1 + R). null sem R. */
export function breakEvenRate(avgReward: number | null): number | null {
  if (avgReward === null || !Number.isFinite(avgReward) || avgReward <= 0) return null;
  return round1(1 / (1 + avgReward));
}

/**
 * Acerto contra o empate, pelo intervalo de Wilson: 'below' (o intervalo
 * inteiro abaixo), 'above' (inteiro acima) ou 'inconclusive' (o empate esta
 * dentro). null quando o recorte nao publica taxa. A frase publica sai daqui.
 */
export type EdgeVerdict = 'below' | 'above' | 'inconclusive';
export function edgeVerdict(interval: Pick<Interval, 'publishable' | 'low' | 'high'>, breakEven: number | null): EdgeVerdict | null {
  if (!interval.publishable || interval.low === null || interval.high === null || breakEven === null) return null;
  if (interval.high < breakEven) return 'below';
  if (interval.low > breakEven) return 'above';
  return 'inconclusive';
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** R medio do TP1 (riskRewardTp1 gravado) dos WIN/LOSS; null sem nenhum valor. */
export function avgRewardOf(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const m = meanOf(xs);
  return m === null ? null : round2(m);
}

/** Recorte publico do motor atual: com menos de MIN_N_TO_PUBLISH sai so o n. */
export type Gated = Interval | { n: number; publishable: false };
export function gated(interval: Interval): Gated {
  return interval.publishable ? interval : { n: interval.n, publishable: false };
}

/**
 * Spread tipico de conta de varejo, em preco: ouro 0,30; prata 0,03; forex
 * 1,2 pip nos majors e 2 pips nos cruzados; BTC e ETH 0,02% do preco; outras
 * cripto 0,05%. A revisao mensal (scripts/replay-variants.ts) usa este mesmo.
 */
export function spreadOf(symbol: string, price: number): number {
  const fx = canonicalFxPair(symbol);
  if (fx === 'XAUUSD') return 0.3;
  if (fx === 'XAGUSD') return 0.03;
  if (fx) {
    const major = ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY'].includes(fx);
    return (fx.endsWith('JPY') ? 0.01 : 0.0001) * (major ? 1.2 : 2);
  }
  const base = normalizeToBinancePerp(symbol).base;
  return price * (base === 'BTC' || base === 'ETH' ? 0.0002 : 0.0005);
}

export type TrackedOutcome = 'WIN' | 'LOSS' | 'TIMEOUT';
export interface TrackedTrade {
  symbol: string | null;
  outcome: string | null;
  fillPrice: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
}

/**
 * Trade executado do rastreador (regra da revisao mensal): R bruto do TP1 a
 * partir do preco executado, LOSS = -1, TIMEOUT = 0, menos o spread em R.
 * null sem desfecho decidido ou sem niveis.
 */
export function trackedTradeR(t: TrackedTrade): { outcome: TrackedOutcome; r: number; reward: number } | null {
  if (!t.symbol || !['WIN', 'LOSS', 'TIMEOUT'].includes(String(t.outcome)) || !t.fillPrice || !t.stopLoss || !t.takeProfit1) return null;
  const risk = Math.abs(t.fillPrice - t.stopLoss);
  if (!(risk > 0)) return null;
  const outcome = t.outcome as TrackedOutcome;
  const reward = Math.abs(t.takeProfit1 - t.fillPrice) / risk;
  const gross = outcome === 'WIN' ? reward : outcome === 'LOSS' ? -1 : 0;
  return { outcome, r: gross - spreadOf(t.symbol, t.fillPrice) / risk, reward };
}

/** Uma analise do motor atual, com a linha do rastreador quando a janela ja fechou. */
export interface CurrentEngineRow {
  createdAt: Date;
  signalState: string | null;
  dataMode: string | null;
  symbol: string | null;
  /** result.watchReach.probability (0 a 1), so no WATCH com calibracao. */
  reachProbability: number | null;
  track: (WatchTrack & TrackedTrade) | null;
}

const REACH_BANDS = [
  { band: '0-25', lo: 0, hi: 0.25 },
  { band: '25-50', lo: 0.25, hi: 0.5 },
  { band: '50-75', lo: 0.5, hi: 0.75 },
  { band: '75-100', lo: 0.75, hi: 1.000001 },
] as const;

const countBy = (keys: string[]) => keys.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});

/**
 * O que o motor atual entregou, lido do rastreador (AnalysisTrack):
 * - estados emitidos e cobertura de dados (velas reais x so o print);
 * - WATCH com janela fechada por desfecho (watchOutcomeOf, a mesma regra das
 *   listas), a taxa de chegada ao nivel e a calibracao da chance mostrada;
 * - ENTER_NOW resolvido (TP1, stop, TIMEOUT), acerto (Wilson), R liquido medio
 *   e o empate pelo R medio do TP1.
 * Todo recorte com menos de 20 resolvidos sai so com o n.
 */
export function currentEngineReport(rows: CurrentEngineRow[]) {
  const watchClosed = rows.filter((r) => r.signalState === 'WATCH' && r.track);
  const watchOutcomes = watchClosed.map((r) => watchOutcomeOf(r.track));
  const reached = watchOutcomes.filter((o) => o === 'reached').length;
  const missedLevel = watchOutcomes.filter((o) => o === 'expired' || o === 'invalidated').length;

  const calibration = REACH_BANDS.map(({ band, lo, hi }) => {
    const inBand = watchClosed.filter((r) => {
      const p = r.reachProbability;
      return typeof p === 'number' && p >= lo && p < hi && watchOutcomeOf(r.track) !== 'unavailable';
    });
    const hits = inBand.filter((r) => watchOutcomeOf(r.track) === 'reached').length;
    const observed = wilson(hits, inBand.length - hits);
    const predicted = meanOf(inBand.map((r) => r.reachProbability as number));
    return observed.publishable
      ? { band, n: inBand.length, publishable: true as const, predicted: predicted === null ? null : round1(predicted), observed }
      : { band, n: inBand.length, publishable: false as const };
  });

  const enter = rows.filter((r) => r.signalState === 'ENTER_NOW');
  const trades = enter.flatMap((r) => {
    const t = r.track && r.track.status === 'tracked' ? trackedTradeR(r.track) : null;
    return t ? [t] : [];
  });
  const wins = trades.filter((t) => t.outcome === 'WIN').length;
  const losses = trades.filter((t) => t.outcome === 'LOSS').length;
  const hitRate = wilson(wins, losses);
  const decidedRewards = trades.filter((t) => t.outcome !== 'TIMEOUT').map((t) => t.reward);
  const avgReward = trades.length >= MIN_N_TO_PUBLISH ? avgRewardOf(decidedRewards) : null;
  const breakEven = breakEvenRate(avgReward);
  const avgR = trades.length >= MIN_N_TO_PUBLISH ? meanOf(trades.map((t) => t.r)) : null;

  const flagged = rows.filter((r) => r.createdAt < EURUSD_BLOCK_FIXED_AT && canonicalFxPair(r.symbol ?? '') !== null);

  return {
    since: CURRENT_ENGINE_SINCE.toISOString(),
    analyses: rows.length,
    byState: countBy(rows.map((r) => r.signalState ?? 'unknown')),
    dataMode: countBy(rows.map((r) => (r.dataMode === 'real_data' || r.dataMode === 'print' ? r.dataMode : 'unknown'))),
    watch: {
      emitted: rows.filter((r) => r.signalState === 'WATCH').length,
      open: rows.filter((r) => r.signalState === 'WATCH' && !r.track).length,
      closed: watchClosed.length,
      outcomes: { reached: 0, invalidated: 0, expired: 0, unavailable: 0, ...countBy(watchOutcomes) },
      reachRate: gated(wilson(reached, missedLevel)),
      calibrationAvailable: watchClosed.some((r) => typeof r.reachProbability === 'number'),
      calibration,
    },
    enterNow: {
      emitted: enter.length,
      /** Janela ainda aberta (sem linha no rastreador). */
      open: enter.filter((r) => !r.track).length,
      /** Janela fechada sem trade pontuavel (sem velas, sem fonte ou sem niveis). */
      notScored: enter.filter((r) => r.track).length - trades.length,
      resolved: trades.length,
      outcomes: { tp1: wins, stop: losses, timeout: trades.length - wins - losses },
      hitRate: gated(hitRate),
      avgNetR: avgR === null ? null : round2(avgR),
      avgRewardTp1: avgReward,
      breakEvenRate: breakEven,
      edge: edgeVerdict(hitRate, breakEven),
    },
    eurUsdBlock: {
      until: EURUSD_BLOCK_FIXED_AT.toISOString(),
      analyses: flagged.length,
      closedWatch: flagged.filter((r) => r.signalState === 'WATCH' && r.track).length,
      enterNow: flagged.filter((r) => r.signalState === 'ENTER_NOW').length,
    },
  };
}
