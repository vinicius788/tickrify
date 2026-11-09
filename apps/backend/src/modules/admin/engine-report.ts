/**
 * Aba "Motor" do /admin: como o motor esta indo desde a correcao do fuso, por
 * variante do prompt e classe de ativo, com a regra de decisao ja aplicada.
 * So leitura. Antes do corte, ouro e forex vinham sem swings (+11h no Twelve
 * Data) e nao servem para julgar nada.
 */
import { Prisma } from '@prisma/client';
import { canonicalFxPair } from '../../common/utils/analysis-normalizer';
import { candleMarketOf } from '../market/candle-store';
import { trackedTradeR } from '../ai/accuracy.util';

/** Deploy da correcao do fuso do Twelve Data. */
export const ENGINE_REPORT_SINCE = '2026-11-09T14:09:48Z';

export const ENGINE_DECISION_RULES = {
  minTradesPerVariant: 30,
  minClassTrades: 10,
  turnOffGapR: 0.1,
  enterNow: { minTrades: 30, keepAtOrAbove: -0.05, disableAtOrBelow: -0.15 },
} as const;

export type EngineReportRow = {
  symbol: string | null;
  variant: string | null;
  signalState: string | null;
  trackStatus: string | null;
  touched: boolean | null;
  outcome: string | null;
  fillPrice: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
};

export type AssetClass = 'metal' | 'forex' | 'crypto' | 'other';
const CLASSES: readonly AssetClass[] = ['metal', 'forex', 'crypto', 'other'];

export type EngineStats = {
  analyses: number;
  enterNowPct: number | null;
  watchPct: number | null;
  /** WATCH com janela fechada no rastreador, e quantos tocaram o nivel. */
  watchTracked: number;
  watchTouched: number;
  watchTouchedPct: number | null;
  closedTrades: number;
  win: number;
  loss: number;
  timeout: number;
  meanR: number | null;
};

export type EngineReport = {
  since: string;
  verdict: string;
  hasVariantB: boolean;
  variants: { variant: 'A' | 'B'; total: EngineStats; classes: { assetClass: AssetClass; stats: EngineStats }[] }[];
  enterNow: { trades: number; meanR: number | null; verdict: string };
};

export function assetClassOf(symbol: string | null): AssetClass {
  if (!symbol) return 'other';
  const market = candleMarketOf(symbol);
  if (market?.market === 'crypto') return 'crypto';
  if (market?.market === 'fx') {
    const pair = canonicalFxPair(symbol);
    return pair && (pair.startsWith('XAU') || pair.startsWith('XAG')) ? 'metal' : 'forex';
  }
  return 'other';
}

const variantOf = (row: EngineReportRow): 'A' | 'B' => (row.variant === 'B' ? 'B' : 'A');
const pct = (part: number, whole: number) => (whole ? (100 * part) / whole : null);
const tradeOf = (row: EngineReportRow) => trackedTradeR({ symbol: row.symbol, outcome: row.outcome, fillPrice: row.fillPrice, stopLoss: row.stopLoss, takeProfit1: row.takeProfit1 });

function statsOf(rows: readonly EngineReportRow[]): EngineStats {
  const watch = rows.filter((r) => r.signalState === 'WATCH');
  const watchTracked = watch.filter((r) => r.trackStatus === 'tracked');
  const watchTouched = watchTracked.filter((r) => r.touched === true).length;
  const trades = rows.flatMap((r) => tradeOf(r) ?? []);
  return {
    analyses: rows.length,
    enterNowPct: pct(rows.filter((r) => r.signalState === 'ENTER_NOW').length, rows.length),
    watchPct: pct(watch.length, rows.length),
    watchTracked: watchTracked.length,
    watchTouched,
    watchTouchedPct: pct(watchTouched, watchTracked.length),
    closedTrades: trades.length,
    win: trades.filter((t) => t.outcome === 'WIN').length,
    loss: trades.filter((t) => t.outcome === 'LOSS').length,
    timeout: trades.filter((t) => t.outcome === 'TIMEOUT').length,
    meanR: trades.length ? trades.reduce((sum, t) => sum + t.r, 0) / trades.length : null,
  };
}

const signed = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(2).replace('.', ',')}R`;

function abVerdict(a: EngineReport['variants'][number], b: EngineReport['variants'][number]): string {
  const R = ENGINE_DECISION_RULES;
  const missingA = Math.max(0, R.minTradesPerVariant - a.total.closedTrades);
  const missingB = Math.max(0, R.minTradesPerVariant - b.total.closedTrades);
  if (missingA || missingB || a.total.meanR === null || b.total.meanR === null) {
    return `Manter e esperar mais dados: faltam ${missingA} trades fechados na A e ${missingB} na B.`;
  }
  const worseClass = b.classes.some(({ assetClass, stats }) => {
    const other = a.classes.find((c) => c.assetClass === assetClass)?.stats;
    return stats.closedTrades >= R.minClassTrades && !!other && other.closedTrades >= R.minClassTrades && (stats.meanR as number) < (other.meanR as number);
  });
  const compare = `A ${signed(a.total.meanR)}, B ${signed(b.total.meanR)} por trade`;
  if (a.total.meanR - b.total.meanR >= R.turnOffGapR) return `Desligar a B: ${compare}. Ponha PROMPT_VARIANT_B_PERCENT em 0 na aba Config.`;
  if (b.total.meanR > a.total.meanR && !worseClass) return `Ligar a B para todos: ${compare}. Ponha PROMPT_VARIANT_B_PERCENT em 100 na aba Config.`;
  return `Manter e esperar mais dados: ${compare}, sem diferenca que decida${worseClass ? ' (a B perde em alguma classe com 10 ou mais trades)' : ''}. Ja ha trades suficientes (faltam 0 na A e 0 na B).`;
}

function enterNowVerdict(trades: number, meanR: number | null): string {
  const R = ENGINE_DECISION_RULES.enterNow;
  if (trades < R.minTrades || meanR === null) return `Manter e esperar mais dados: faltam ${R.minTrades - trades} trades de ENTER_NOW.`;
  if (meanR >= R.keepAtOrAbove) return 'Manter o ENTER_NOW.';
  if (meanR <= R.disableAtOrBelow) return 'Desligar o ENTER_NOW: o produto fica so no modo leitura.';
  return 'Manter e esperar mais dados: entre -0,15R e -0,05R a regra nao decide.';
}

export function buildEngineReport(rows: readonly EngineReportRow[]): EngineReport {
  const hasVariantB = rows.some((r) => variantOf(r) === 'B');
  const variants = (hasVariantB ? (['A', 'B'] as const) : (['A'] as const)).map((variant) => {
    const own = rows.filter((r) => variantOf(r) === variant);
    return {
      variant,
      total: statsOf(own),
      classes: CLASSES.map((assetClass) => ({ assetClass, stats: statsOf(own.filter((r) => assetClassOf(r.symbol) === assetClass)) })).filter((c) => c.stats.analyses > 0),
    };
  });
  const enterNowTrades = rows.filter((r) => variantOf(r) === 'A' && r.signalState === 'ENTER_NOW').flatMap((r) => tradeOf(r) ?? []);
  const meanR = enterNowTrades.length ? enterNowTrades.reduce((sum, t) => sum + t.r, 0) / enterNowTrades.length : null;
  return {
    since: ENGINE_REPORT_SINCE,
    hasVariantB,
    verdict: hasVariantB ? abVerdict(variants[0], variants[1]) : 'So existe a variante A: nao ha teste A/B para decidir.',
    variants,
    enterNow: { trades: enterNowTrades.length, meanR, verdict: enterNowVerdict(enterNowTrades.length, meanR) },
  };
}

type RawQuerier = { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> };

export async function loadEngineReport(db: RawQuerier): Promise<EngineReport> {
  const rows = await db.$queryRaw<EngineReportRow[]>(Prisma.sql`
    SELECT a."result"->'analysis'->>'symbol' AS "symbol",
           a."result"->'engine'->>'prompt_variant' AS "variant",
           a."result"->>'signalState' AS "signalState",
           t."status" AS "trackStatus",
           t."touched" AS "touched",
           t."outcome" AS "outcome",
           t."fillPrice" AS "fillPrice",
           t."stopLoss" AS "stopLoss",
           t."takeProfit1" AS "takeProfit1"
    FROM "tickrify"."Analysis" a
    LEFT JOIN "tickrify"."AnalysisTrack" t ON t."analysisId" = a."id"
    WHERE a."status" = 'completed'
      AND a."createdAt" >= ${new Date(ENGINE_REPORT_SINCE)}
      AND a."result"->>'signalState' IS NOT NULL
  `);
  return buildEngineReport(rows);
}
