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
  /** Perfis de risco (17/11/2026): mesmos limites de R, amostra minima menor. */
  profile: { minTrades: 20 },
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
  /** `groundingStats.coverage`; ausente em analise anterior ao registro do motivo. */
  coverage?: string | null;
  /** `result.snapFallback`: seguiu com a invalidacao do modelo (chave ENGINE_SNAP_FALLBACK). */
  snapFallback?: boolean | null;
  /** `result.entryWarnings` com 2 ou 7: ENTER_NOW com C2 ou C7 em FAIL (chave ENGINE_ENTER_REQUIRED_CHECKS). */
  entryWarned?: boolean | null;
  /** `result.entryWarnings` com 8: ENTER_NOW com movimento atrasado (chave ENGINE_LATE_AS_WARNING). */
  lateWarned?: boolean | null;
  /** `result.permissiveEntry`: ENTER_NOW que so existe pelo modo permissivo (chave ENGINE_PERMISSIVE). */
  permissiveEntry?: boolean | null;
  /** `result.pendingEntry`: WATCH mostrado como entrada pendente (chave ENGINE_PENDING_ENTRY_LABEL). */
  pendingEntry?: boolean | null;
  /** `result.targetMoved`: TP1 no proximo nivel (chave ENGINE_NEXT_TARGET). */
  targetMoved?: boolean | null;
};

/** ENTER_NOW que so existe por causa de uma chave de 16/11/2026, em serie propria. */
export type GateSeries = { flag: 'ENGINE_SNAP_FALLBACK' | 'ENGINE_ENTER_REQUIRED_CHECKS' | 'ENGINE_LATE_AS_WARNING' | 'ENGINE_PERMISSIVE' | 'ENGINE_PENDING_ENTRY_LABEL' | 'ENGINE_NEXT_TARGET'; trades: number; meanR: number | null; verdict: string };

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
  variants: { variant: 'A' | 'B' | 'C' | 'D'; total: EngineStats; classes: { assetClass: AssetClass; stats: EngineStats }[] }[];
  enterNow: { trades: number; meanR: number | null; verdict: string };
  gates: GateSeries[];
  noCandles: { reason: string; count: number }[];
  /** Perfis de risco (AnalysisProfileTrack); ausente enquanto nenhuma analise tem perfis. */
  profiles?: ProfileReport[];
};

export type ProfileKey = 'conservative' | 'balanced' | 'aggressive';
export const PROFILE_ORDER: readonly ProfileKey[] = ['conservative', 'balanced', 'aggressive'];
export type ProfileRow = Omit<EngineReportRow, 'variant'> & { profile: string };
export type ProfileReport = { profile: ProfileKey; stats: EngineStats; verdict: string };

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

const variantOf = (row: EngineReportRow): 'A' | 'B' | 'C' | 'D' => (row.variant === 'B' || row.variant === 'C' || row.variant === 'D' ? row.variant : 'A');
const pct = (part: number, whole: number) => (whole ? (100 * part) / whole : null);
const tradeOf = (row: Omit<EngineReportRow, 'variant'>) => trackedTradeR({ symbol: row.symbol, outcome: row.outcome, fillPrice: row.fillPrice, stopLoss: row.stopLoss, takeProfit1: row.takeProfit1 });

function statsOf(rows: readonly Omit<EngineReportRow, 'variant'>[]): EngineStats {
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
  const B = b.variant;
  const key = `PROMPT_VARIANT_${B}_PERCENT`;
  const R = ENGINE_DECISION_RULES;
  const missingA = Math.max(0, R.minTradesPerVariant - a.total.closedTrades);
  const missingB = Math.max(0, R.minTradesPerVariant - b.total.closedTrades);
  if (missingA || missingB || a.total.meanR === null || b.total.meanR === null) {
    return `Manter e esperar mais dados: faltam ${missingA} trades fechados na A e ${missingB} na ${B}.`;
  }
  const worseClass = b.classes.some(({ assetClass, stats }) => {
    const other = a.classes.find((c) => c.assetClass === assetClass)?.stats;
    return stats.closedTrades >= R.minClassTrades && !!other && other.closedTrades >= R.minClassTrades && (stats.meanR as number) < (other.meanR as number);
  });
  const compare = `A ${signed(a.total.meanR)}, ${B} ${signed(b.total.meanR)} por trade`;
  if (a.total.meanR - b.total.meanR >= R.turnOffGapR) return `Desligar a ${B}: ${compare}. Ponha ${key} em 0 na aba Config.`;
  if (b.total.meanR > a.total.meanR && !worseClass) return `Ligar a ${B} para todos: ${compare}. Ponha ${key} em 100 na aba Config.`;
  return `Manter e esperar mais dados: ${compare}, sem diferenca que decida${worseClass ? ` (a ${B} perde em alguma classe com 10 ou mais trades)` : ''}. Ja ha trades suficientes (faltam 0 na A e 0 na ${B}).`;
}

/** Regra da revisao mensal: vale para ENTER_NOW e para WATCH tocado e preenchido, cada um na sua serie. */
export function reviewDecision(trades: number, meanR: number | null, minTrades: number = ENGINE_DECISION_RULES.enterNow.minTrades): 'keep' | 'disable' | 'wait' {
  const R = ENGINE_DECISION_RULES.enterNow;
  if (trades < minTrades || meanR === null) return 'wait';
  return meanR >= R.keepAtOrAbove ? 'keep' : meanR <= R.disableAtOrBelow ? 'disable' : 'wait';
}

/** WATCH em que o preco chegou ao nivel e a ordem no nivel foi preenchida, pelo rastreador. */
export function isFilledWatch(r: { signalState: string | null; touched: boolean | null; filled: boolean | null }): boolean {
  return r.signalState === 'WATCH' && r.touched === true && r.filled === true;
}

function enterNowVerdict(trades: number, meanR: number | null): string {
  const R = ENGINE_DECISION_RULES.enterNow;
  const decision = reviewDecision(trades, meanR);
  if (decision === 'keep') return 'Manter o ENTER_NOW.';
  if (decision === 'disable') return 'Desligar o ENTER_NOW: o produto fica so no modo leitura.';
  return trades < R.minTrades || meanR === null
    ? `Manter e esperar mais dados: faltam ${R.minTrades - trades} trades de ENTER_NOW.`
    : 'Manter e esperar mais dados: entre -0,15R e -0,05R a regra nao decide.';
}

function gateSeries(flag: GateSeries['flag'], rows: readonly EngineReportRow[], state = 'ENTER_NOW'): GateSeries {
  const R = ENGINE_DECISION_RULES.enterNow;
  const trades = rows.filter((r) => r.signalState === state).flatMap((r) => tradeOf(r) ?? []);
  const meanR = trades.length ? trades.reduce((sum, t) => sum + t.r, 0) / trades.length : null;
  const decision = reviewDecision(trades.length, meanR);
  const verdict = decision === 'keep'
    ? 'Manter a chave ligada.'
    : decision === 'disable'
      ? 'Voltar a chave para 0.'
      : trades.length < R.minTrades || meanR === null
        ? `Esperar mais dados: faltam ${R.minTrades - trades.length} trades.`
        : 'Esperar mais dados: entre -0,15R e -0,05R a regra nao decide.';
  return { flag, trades: trades.length, meanR, verdict };
}

function profileVerdict(trades: number, meanR: number | null): string {
  const min = ENGINE_DECISION_RULES.profile.minTrades;
  if (trades < min || meanR === null) return `Esperar mais dados (faltam ${Math.max(0, min - trades)}).`;
  const decision = reviewDecision(trades, meanR, min);
  if (decision === 'keep') return 'Manter o perfil.';
  if (decision === 'disable') return 'Desligar o perfil.';
  return 'Esperar mais dados: entre -0,15R e -0,05R a regra nao decide.';
}

/** Um bloco por perfil de risco, so com as linhas do AnalysisProfileTrack. Vazio = sem bloco. */
export function buildProfileReport(rows: readonly ProfileRow[]): ProfileReport[] {
  if (!rows.length) return [];
  return PROFILE_ORDER.map((profile) => {
    const own = rows.filter((r) => r.profile === profile);
    const stats = statsOf(own);
    return { profile, stats, verdict: profileVerdict(stats.closedTrades, stats.meanR) };
  });
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

export function buildEngineReport(rows: readonly EngineReportRow[]): EngineReport {
  const hasVariantB = rows.some((r) => variantOf(r) === 'B');
  const present = (['A', 'B', 'C', 'D'] as const).filter((variant) => variant === 'A' || rows.some((r) => variantOf(r) === variant));
  const variants = present.map((variant) => {
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
    verdict: variants.length > 1 ? variants.slice(1).map((v) => abVerdict(variants[0], v)).join(' ') : 'So existe a variante A: nao ha teste A/B para decidir.',
    variants,
    enterNow: { trades: enterNowTrades.length, meanR, verdict: enterNowVerdict(enterNowTrades.length, meanR) },
    gates: [
      gateSeries('ENGINE_SNAP_FALLBACK', rows.filter((r) => r.snapFallback === true)),
      gateSeries('ENGINE_ENTER_REQUIRED_CHECKS', rows.filter((r) => r.entryWarned === true)),
      gateSeries('ENGINE_LATE_AS_WARNING', rows.filter((r) => r.lateWarned === true)),
      gateSeries('ENGINE_PERMISSIVE', rows.filter((r) => r.permissiveEntry === true)),
      // Entrada pendente: so os WATCH que o rastreador preencheu no nivel viram trade.
      gateSeries('ENGINE_PENDING_ENTRY_LABEL', rows.filter((r) => r.pendingEntry === true), 'WATCH'),
      gateSeries('ENGINE_NEXT_TARGET', rows.filter((r) => r.targetMoved === true)),
    ],
    noCandles: noCandlesOf(rows),
  };
}

type RawQuerier = { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> };

export async function loadEngineReport(db: RawQuerier): Promise<EngineReport> {
  const report = await loadBaseReport(db);
  // Tabela nova e criada pelo worker no boot: se ainda nao existe, o relatorio segue sem o bloco.
  const profileRows = await db.$queryRaw<ProfileRow[]>(Prisma.sql`
    SELECT t."profile" AS "profile",
           t."symbol" AS "symbol",
           t."signalState" AS "signalState",
           t."status" AS "trackStatus",
           t."touched" AS "touched",
           t."outcome" AS "outcome",
           t."fillPrice" AS "fillPrice",
           t."stopLoss" AS "stopLoss",
           t."takeProfit1" AS "takeProfit1"
    FROM "tickrify"."AnalysisProfileTrack" t
    JOIN "tickrify"."Analysis" a ON a."id" = t."analysisId"
    WHERE a."status" = 'completed'
      AND a."createdAt" >= ${new Date(ENGINE_REPORT_SINCE)}
  `).catch(() => [] as ProfileRow[]);
  const profiles = buildProfileReport(profileRows);
  return profiles.length ? { ...report, profiles } : report;
}

async function loadBaseReport(db: RawQuerier): Promise<EngineReport> {
  const rows = await db.$queryRaw<EngineReportRow[]>(Prisma.sql`
    SELECT a."result"->'analysis'->>'symbol' AS "symbol",
           a."result"->'engine'->>'prompt_variant' AS "variant",
           a."result"->>'signalState' AS "signalState",
           t."status" AS "trackStatus",
           t."touched" AS "touched",
           t."outcome" AS "outcome",
           t."fillPrice" AS "fillPrice",
           t."stopLoss" AS "stopLoss",
           t."takeProfit1" AS "takeProfit1",
           a."groundingStats"->>'coverage' AS "coverage",
           (a."result"->>'snapFallback') = 'true' AS "snapFallback",
           (a."result"->'entryWarnings' @> '[2]'::jsonb OR a."result"->'entryWarnings' @> '[7]'::jsonb) AS "entryWarned",
           a."result"->'entryWarnings' @> '[8]'::jsonb AS "lateWarned",
           (a."result"->>'permissiveEntry') = 'true' AS "permissiveEntry",
           (a."result"->>'pendingEntry') = 'true' AS "pendingEntry",
           (a."result"->>'targetMoved') = 'true' AS "targetMoved"
    FROM "tickrify"."Analysis" a
    LEFT JOIN "tickrify"."AnalysisTrack" t ON t."analysisId" = a."id"
    WHERE a."status" = 'completed'
      AND a."createdAt" >= ${new Date(ENGINE_REPORT_SINCE)}
      AND a."result"->>'signalState' IS NOT NULL
  `);
  return buildEngineReport(rows);
}
