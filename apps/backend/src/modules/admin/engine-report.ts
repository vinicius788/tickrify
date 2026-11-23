/**
 * Aba "Motor" do /admin: o motor novo (tres leitores + velas, #66), por tipo de
 * entrada e por classe de ativo, com a regra de decisao ja aplicada. So leitura.
 * Entram so as analises cujo `result.engine.vote` existe: e o que separa o motor
 * novo do anterior, sem depender de data de deploy.
 */
import { Prisma } from '@prisma/client';
import { canonicalFxPair } from '../../common/utils/analysis-normalizer';
import { candleMarketOf } from '../market/candle-store';
import { trackedTradeR } from '../ai/accuracy.util';

/** Deploy da correcao do fuso do Twelve Data (corte de ouro e forex na revisao mensal). */
export const ENGINE_REPORT_SINCE = '2026-11-09T14:09:48Z';

/** Regra do projeto (CLAUDE.md 3.2): n >= 30 para decidir; R por trade liquido de spread. */
export const ENGINE_DECISION_RULES = {
  enterNow: { minTrades: 30, keepAtOrAbove: -0.05, disableAtOrBelow: -0.15 },
} as const;

export const ENTRY_KINDS = ['now', 'pullback', 'breakout', 'wait'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export type AssetClass = 'metal' | 'forex' | 'crypto' | 'other';
const CLASSES: readonly AssetClass[] = ['metal', 'forex', 'crypto', 'other'];

export type EngineReportRow = {
  symbol: string | null;
  /** `result.codeSummary.action`: buy_now, sell_pullback, wait... */
  action: string | null;
  /** `result.engine.vote.agreement`, ex.: "3/3". */
  agreement: string | null;
  signalState?: string | null;
  trackStatus: string | null;
  outcome: string | null;
  fillPrice: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  /** `groundingStats.coverage`; ausente em analise anterior ao registro do motivo. */
  coverage?: string | null;
};

export type Decision = 'keep' | 'disable' | 'wait';

export type EngineStats = {
  analyses: number;
  /** % de analises com operacao clara (qualquer coisa que nao seja esperar). */
  clearPct: number | null;
  closedTrades: number;
  win: number;
  loss: number;
  timeout: number;
  meanR: number | null;
  decision: Decision;
  verdict: string;
};

export type EngineReport = {
  /** Primeira analise do motor novo; null = ainda nenhuma. */
  since: string | null;
  total: EngineStats;
  byEntry: { entry: EntryKind; stats: EngineStats }[];
  byClass: { assetClass: AssetClass; stats: EngineStats }[];
  agreement: { agreement: string; count: number }[];
  noCandles: { reason: string; count: number }[];
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

/** buy_now / sell_pullback / buy_breakout / wait -> tipo de entrada. Valor desconhecido = null. */
export function entryKindOf(action: string | null): EntryKind | null {
  if (action === 'wait') return 'wait';
  const kind = action?.split('_')[1];
  return kind === 'now' || kind === 'pullback' || kind === 'breakout' ? kind : null;
}

const pct = (part: number, whole: number) => (whole ? (100 * part) / whole : null);
const tradeOf = (row: EngineReportRow) => trackedTradeR({ symbol: row.symbol, outcome: row.outcome, fillPrice: row.fillPrice, stopLoss: row.stopLoss, takeProfit1: row.takeProfit1 });

/** Regra da revisao mensal: n >= 30 e R >= -0,05 mantem; R <= -0,15 alerta; resto espera. */
export function reviewDecision(trades: number, meanR: number | null, minTrades: number = ENGINE_DECISION_RULES.enterNow.minTrades): Decision {
  const R = ENGINE_DECISION_RULES.enterNow;
  if (trades < minTrades || meanR === null) return 'wait';
  return meanR >= R.keepAtOrAbove ? 'keep' : meanR <= R.disableAtOrBelow ? 'disable' : 'wait';
}

/** WATCH em que o preco chegou ao nivel e a ordem no nivel foi preenchida, pelo rastreador (usado pelo replay-variants). */
export function isFilledWatch(r: { signalState: string | null; touched: boolean | null; filled: boolean | null }): boolean {
  return r.signalState === 'WATCH' && r.touched === true && r.filled === true;
}

function verdictOf(trades: number, meanR: number | null): string {
  const R = ENGINE_DECISION_RULES.enterNow;
  const decision = reviewDecision(trades, meanR);
  if (decision === 'keep') return 'Manter.';
  if (decision === 'disable') return 'Alerta: R em -0,15R ou pior. Revisar o motor.';
  return trades < R.minTrades || meanR === null
    ? `Esperar: faltam ${R.minTrades - trades} trades fechados.`
    : 'Esperar: entre -0,15R e -0,05R a regra nao decide.';
}

export function statsOf(rows: readonly EngineReportRow[]): EngineStats {
  const trades = rows.flatMap((r) => tradeOf(r) ?? []);
  const meanR = trades.length ? trades.reduce((sum, t) => sum + t.r, 0) / trades.length : null;
  return {
    analyses: rows.length,
    clearPct: pct(rows.filter((r) => r.action !== 'wait').length, rows.length),
    closedTrades: trades.length,
    win: trades.filter((t) => t.outcome === 'WIN').length,
    loss: trades.filter((t) => t.outcome === 'LOSS').length,
    timeout: trades.filter((t) => t.outcome === 'TIMEOUT').length,
    meanR,
    decision: reviewDecision(trades.length, meanR),
    verdict: verdictOf(trades.length, meanR),
  };
}

/** Por que as analises vieram sem velas, do motivo mais comum para o menos comum. */
function noCandlesOf(rows: readonly EngineReportRow[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.coverage === 'injected') continue;
    const reason = row.coverage ?? 'not_recorded';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function agreementOf(rows: readonly EngineReportRow[]): { agreement: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.agreement ?? 'sem voto';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([agreement, count]) => ({ agreement, count })).sort((a, b) => b.agreement.localeCompare(a.agreement));
}

export function buildEngineReport(rows: readonly EngineReportRow[], since: string | null = null): EngineReport {
  return {
    since,
    total: statsOf(rows),
    byEntry: ENTRY_KINDS.map((entry) => ({ entry, stats: statsOf(rows.filter((r) => entryKindOf(r.action) === entry)) })).filter((e) => e.stats.analyses > 0),
    byClass: CLASSES.map((assetClass) => ({ assetClass, stats: statsOf(rows.filter((r) => assetClassOf(r.symbol) === assetClass)) })).filter((c) => c.stats.analyses > 0),
    agreement: agreementOf(rows),
    noCandles: noCandlesOf(rows),
  };
}

type RawQuerier = { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> };

export async function loadEngineReport(db: RawQuerier): Promise<EngineReport> {
  const rows = await db.$queryRaw<Array<EngineReportRow & { createdAt: Date }>>(Prisma.sql`
    SELECT a."createdAt" AS "createdAt",
           a."result"->'analysis'->>'symbol' AS "symbol",
           a."result"->'codeSummary'->>'action' AS "action",
           a."result"->'engine'->'vote'->>'agreement' AS "agreement",
           a."result"->>'signalState' AS "signalState",
           t."status" AS "trackStatus",
           t."outcome" AS "outcome",
           t."fillPrice" AS "fillPrice",
           t."stopLoss" AS "stopLoss",
           t."takeProfit1" AS "takeProfit1",
           a."groundingStats"->>'coverage' AS "coverage"
    FROM "tickrify"."Analysis" a
    LEFT JOIN "tickrify"."AnalysisTrack" t ON t."analysisId" = a."id"
    WHERE a."status" = 'completed'
      AND a."result"->'engine'->'vote' IS NOT NULL
    ORDER BY a."createdAt" ASC
  `);
  return buildEngineReport(rows, rows.length ? rows[0].createdAt.toISOString() : null);
}
