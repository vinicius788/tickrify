/**
 * Rastreador de resultado (28/10/2026): o que o mercado fez com cada
 * plano, pela MESMA regua do replay (trackPlan em plan-engine.ts).
 *
 * Toda analise com estado (v10 em diante) ganha uma linha em "AnalysisTrack",
 * com o estado, a versao do motor e a do prompt; NO_TRADE e analise sem plano
 * ficam como `skipped`. Com plano, depois que a janela fecha (validade + 48h),
 * busca as velas do periodo (1m quando a janela cabe em 5000 min, senao 5m) e
 * grava: toque no nivel, fill (a mercado no ENTER_NOW, no nivel do plano no
 * WATCH), TP1/stop/TIMEOUT (stop_only), MFE e MAE em R, o "missed" (o alvo
 * veio antes do fill) e a referencia de direcao (a mercado na analise, stop e
 * alvo de 1 ATR), que a revisao mensal compara (scripts/replay-variants.ts).
 *
 * Isto ainda nao aparece para o usuario: e medicao. O outcome sweeper
 * (outcome.sweeper.ts) segue sendo a fonte da /accuracy.
 *
 * Cota: forex/metal pelo medidor do Twelve Data com a prioridade mais baixa
 * (sweeper). Recusa de cota deixa a analise para a volta seguinte.
 * Best-effort absoluto: nenhuma falha aqui derruba o worker de analises.
 */
import { PrismaClient } from '@prisma/client';
import { clampValidity, isValidWatchPlan, resolveTp1, stopMarginAtr, trackPlan, type WatchPlan } from '../src/common/utils/plan-engine';
import { calibrationPair } from '../src/common/utils/signal-decision';
import { TIMEFRAME_MS, candleMarketOf, fetchWindow, normalizeTimeframe } from '../src/modules/market/candle-store';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const TRACKER_RULES = {
  intervalMs: 30 * MINUTE,
  firstDelayMs: 4 * MINUTE,
  /** TP1 x stop depois do fill: 48h, como o replay. */
  resolveMs: 48 * HOUR,
  /** Janelas ate isto em minutos usam velas de 1m; acima, 5m. */
  fineMaxMinutes: 5000,
  /** Forex e metal fecham no fim de semana: folga na janela. */
  fxWeekendMs: 72 * HOUR,
  batch: 20,
  lookbackDays: 21,
  /** DDL falhou: nova tentativa a cada 10 min, ate conseguir. */
  ddlRetryMs: 10 * MINUTE,
} as const;

export const TRACKER_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."AnalysisTrack" (
    "analysisId" TEXT NOT NULL,
    "promptVer" INTEGER,
    "engineVersion" TEXT,
    "symbol" TEXT,
    "timeframe" TEXT,
    "signalState" TEXT NOT NULL,
    "dataMode" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "outcome" TEXT,
    "touched" BOOLEAN NOT NULL DEFAULT false,
    "touchedAt" TIMESTAMP(3),
    "filled" BOOLEAN NOT NULL DEFAULT false,
    "fillAt" TIMESTAMP(3),
    "fillPrice" DOUBLE PRECISION,
    "entry" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit1" DOUBLE PRECISION,
    "mfeR" DOUBLE PRECISION,
    "maeR" DOUBLE PRECISION,
    "missed" BOOLEAN NOT NULL DEFAULT false,
    "candleInterval" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalysisTrack_pkey" PRIMARY KEY ("analysisId"),
    CONSTRAINT "AnalysisTrack_status_check" CHECK ("status" IN ('tracked', 'skipped')),
    CONSTRAINT "AnalysisTrack_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "tickrify"."Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "AnalysisTrack_promptVer_idx" ON "tickrify"."AnalysisTrack"("promptVer")`,
  // Revisao mensal (02/11/2026): lado, ATR e a referencia de direcao.
  `ALTER TABLE "tickrify"."AnalysisTrack" ADD COLUMN IF NOT EXISTS "direction" TEXT`,
  `ALTER TABLE "tickrify"."AnalysisTrack" ADD COLUMN IF NOT EXISTS "atr" DOUBLE PRECISION`,
  `ALTER TABLE "tickrify"."AnalysisTrack" ADD COLUMN IF NOT EXISTS "refOutcome" TEXT`,
  `ALTER TABLE "tickrify"."AnalysisTrack" ADD COLUMN IF NOT EXISTS "refFillPrice" DOUBLE PRECISION`,
];

type Candidate = {
  id: string;
  createdAt: Date;
  promptVer: number | null;
  result: Record<string, any> | null;
  groundingStats: {
    interval?: string | null;
    coverage?: string;
    numbers?: { atr14?: number | null; volRegime?: 'low' | 'normal' | 'high' | null } | null;
  } | null;
};

export type TrackRow = {
  analysisId: string;
  promptVer: number | null;
  engineVersion: string | null;
  symbol: string | null;
  timeframe: string | null;
  signalState: string;
  dataMode: string | null;
  status: 'tracked' | 'skipped';
  reason: string | null;
  outcome: string | null;
  touched: boolean;
  touchedAt: Date | null;
  filled: boolean;
  fillAt: Date | null;
  fillPrice: number | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  mfeR: number | null;
  maeR: number | null;
  missed: boolean;
  candleInterval: string | null;
  direction: 'long' | 'short' | null;
  atr: number | null;
  /** Referencia: a direcao do plano a mercado na analise, stop e alvo de 1 ATR (WIN, LOSS ou TIMEOUT). */
  refOutcome: string | null;
  refFillPrice: number | null;
};

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** O plano gravado, com a validade no intervalo do motor; null = sem plano coerente. */
function planOf(raw: unknown): WatchPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const plan = { ...r, target2: r.target2 ?? null, validForCandles: clampValidity(r.validForCandles), trigger: String(r.trigger ?? '') } as WatchPlan;
  return isValidWatchPlan(plan) ? plan : null;
}

/**
 * Avalia uma analise. `null` = ainda nao da (janela aberta ou cota recusada):
 * fica para a volta seguinte. `now` e `fetch` injetaveis para o teste.
 */
export async function trackAnalysis(
  c: Candidate,
  nowMs: number,
  fetch: typeof fetchWindow = fetchWindow,
): Promise<TrackRow | null> {
  const result = c.result ?? {};
  const analysis = (result.analysis ?? {}) as Record<string, unknown>;
  const state = String(result.signalState ?? '');
  const symbol = typeof analysis.symbol === 'string' ? analysis.symbol : null;
  const interval = c.groundingStats?.interval ?? normalizeTimeframe(String(analysis.timeframe ?? ''));
  const base: TrackRow = {
    analysisId: c.id, promptVer: c.promptVer, engineVersion: typeof result.engine?.version === 'string' ? result.engine.version : null,
    symbol, timeframe: interval, signalState: state, dataMode: typeof result.dataMode === 'string' ? result.dataMode : null,
    status: 'skipped', reason: null, outcome: null, touched: false, touchedAt: null, filled: false, fillAt: null, fillPrice: null,
    entry: null, stopLoss: null, takeProfit1: null, mfeR: null, maeR: null, missed: false, candleInterval: null,
    direction: null, atr: null, refOutcome: null, refFillPrice: null,
  };
  const plan = planOf(result.watchPlan);
  if (!plan) return { ...base, reason: 'no_plan' };
  base.direction = plan.direction;
  const step = interval ? TIMEFRAME_MS[interval] : undefined;
  if (!symbol || !interval || !step) return { ...base, reason: 'no_timeframe' };
  const market = candleMarketOf(symbol);
  if (!market) return { ...base, reason: 'no_source' };

  const start = c.createdAt.getTime();
  const span = (plan.validForCandles + 2) * step + TRACKER_RULES.resolveMs;
  const end = start + span + (market.market === 'crypto' ? 0 : TRACKER_RULES.fxWeekendMs);
  if (nowMs < end) return null;
  const fineInterval = span / MINUTE <= TRACKER_RULES.fineMaxMinutes ? '1m' : '5m';
  const tf = await fetch(symbol, interval, start - step, end, 'sweeper');
  if (tf.denied) return null;
  const fine = tf.candles ? await fetch(symbol, fineInterval, start - step, end, 'sweeper') : tf;
  if (fine.denied) return null;
  if (!tf.candles || !fine.candles) return { ...base, reason: 'no_candles' };

  const signal = state === 'ARMED' || state === 'ENTER_NOW';
  const levels = signal && positive(analysis.entry) && positive(analysis.stopLoss) && positive(analysis.takeProfit1)
    ? { entry: analysis.entry, stopLoss: analysis.stopLoss, takeProfit1: analysis.takeProfit1 }
    : null;
  const injected = c.groundingStats?.coverage === 'injected' ? c.groundingStats.numbers ?? null : null;
  const atr = injected?.atr14 ?? null;
  base.atr = atr;
  // A margem do validador (P80 do par e do regime gravado na analise), nunca o padrao solto.
  const marginAtr = stopMarginAtr(calibrationPair(symbol), injected?.volRegime ?? null);
  const t = trackPlan({
    plan, enterNow: state === 'ENTER_NOW', atr, marginAtr, levels,
    tf: tf.candles, tfStepMs: step, fine: fine.candles, startMs: start, resolveMs: TRACKER_RULES.resolveMs,
  });
  const at = (i: number | null) => (i === null ? null : new Date(fine.candles![i][0]));
  // Referencia de direcao, pela mesma regua: a mercado na 1a vela fina, 1 ATR.
  const i0 = fine.candles.findIndex((b) => b[0] >= start);
  let ref: { outcome: string; price: number } | null = null;
  if (atr && atr > 0 && i0 >= 0) {
    const long = plan.direction === 'long';
    const fill = { index: i0, price: fine.candles[i0][1] };
    const r = resolveTp1(fine.candles, long, fill, long ? fill.price - atr : fill.price + atr, long ? fill.price + atr : fill.price - atr, fine.candles[i0][0] + TRACKER_RULES.resolveMs);
    ref = { outcome: r.outcome, price: fill.price };
  }
  return {
    ...base,
    status: 'tracked',
    reason: t.rejection,
    outcome: t.outcome,
    touched: t.touchIndex !== null,
    touchedAt: at(t.touchIndex),
    filled: t.fill !== null,
    fillAt: at(t.fill?.index ?? null),
    fillPrice: t.fill?.price ?? null,
    entry: t.levels?.entry ?? null,
    stopLoss: t.levels?.stopLoss ?? null,
    takeProfit1: t.levels?.takeProfit1 ?? null,
    mfeR: t.resolution?.mfeR ?? null,
    maeR: t.resolution?.maeR ?? null,
    missed: t.outcome === 'MISSED',
    candleInterval: fineInterval,
    refOutcome: ref?.outcome ?? null,
    refFillPrice: ref?.price ?? null,
  };
}

async function insert(prisma: PrismaClient, r: TrackRow): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "tickrify"."AnalysisTrack" ("analysisId", "promptVer", "engineVersion", "symbol", "timeframe", "signalState",
       "dataMode", "status", "reason", "outcome", "touched", "touchedAt", "filled", "fillAt", "fillPrice", "entry", "stopLoss",
       "takeProfit1", "mfeR", "maeR", "missed", "candleInterval", "direction", "atr", "refOutcome", "refFillPrice")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
     ON CONFLICT ("analysisId") DO NOTHING`,
    r.analysisId, r.promptVer, r.engineVersion, r.symbol, r.timeframe, r.signalState, r.dataMode, r.status, r.reason, r.outcome,
    r.touched, r.touchedAt, r.filled, r.fillAt, r.fillPrice, r.entry, r.stopLoss, r.takeProfit1, r.mfeR, r.maeR, r.missed, r.candleInterval,
    r.direction, r.atr, r.refOutcome, r.refFillPrice,
  );
}

export async function runAnalysisTracker(prisma: PrismaClient, nowMs: number = Date.now()): Promise<{ tracked: number; skipped: number; pending: number }> {
  const candidates = await prisma.$queryRawUnsafe<Candidate[]>(
    `SELECT a."id", a."createdAt", a."promptVer", a."result", a."groundingStats"
     FROM "tickrify"."Analysis" a
     WHERE a."status" = 'completed'
       AND a."createdAt" > NOW() - ($1 || ' days')::interval
       AND a."result"->>'signalState' IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "tickrify"."AnalysisTrack" t WHERE t."analysisId" = a."id")
     ORDER BY a."createdAt" ASC
     LIMIT $2`,
    String(TRACKER_RULES.lookbackDays), TRACKER_RULES.batch,
  );
  const counts = { tracked: 0, skipped: 0, pending: 0 };
  for (const c of candidates) {
    const row = await trackAnalysis(c, nowMs).catch(() => null);
    if (!row) { counts.pending++; continue; }
    await insert(prisma, row);
    counts[row.status === 'tracked' ? 'tracked' : 'skipped']++;
  }
  return counts;
}

/** Cada DDL na propria transacao, com lock_timeout de 5 s: nunca fica preso atras de outra trava. */
async function ensureTrackerTables(prisma: PrismaClient): Promise<void> {
  for (const sql of TRACKER_SQL) {
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`),
      prisma.$executeRawUnsafe(sql),
    ]);
  }
}

export function startAnalysisTracker(prisma: PrismaClient): void {
  const run = async () => {
    try {
      const c = await runAnalysisTracker(prisma);
      if (c.tracked || c.skipped) console.log(`[tracker] tracked=${c.tracked} skipped=${c.skipped} pending=${c.pending}`);
    } catch (err) {
      console.warn(`[tracker] Varredura falhou: ${err instanceof Error ? err.message : err}`);
    }
  };
  // A varredura so e agendada depois que as colunas existem.
  const boot = async (attempt: number) => {
    try {
      await ensureTrackerTables(prisma);
    } catch (err) {
      console.warn(
        `[tracker] Tabela indisponivel (tentativa ${attempt}), nova tentativa em ${TRACKER_RULES.ddlRetryMs / MINUTE} min: ` +
          `${err instanceof Error ? err.message : err}`,
      );
      setTimeout(() => void boot(attempt + 1), TRACKER_RULES.ddlRetryMs).unref();
      return;
    }
    console.log(`[tracker] Tabela pronta${attempt > 1 ? ` na tentativa ${attempt}` : ''} (varredura a cada 30 min).`);
    setTimeout(() => {
      void run();
      setInterval(() => void run(), TRACKER_RULES.intervalMs).unref();
    }, TRACKER_RULES.firstDelayMs).unref();
  };
  void boot(1);
}
