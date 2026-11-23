/**
 * WATCH como item pendente nas listas (03/11/2026): My Trades, Diario e
 * setups mostravam o WATCH como "nada a marcar", igual ao NO_TRADE. Aqui sai o
 * resumo que as telas leem: o nivel, a direcao, a invalidacao, ate quando vale
 * e, depois que a janela fecha, o que o rastreador gravou (so leitura do
 * AnalysisTrack). Nada de acerto, P&L ou "win": o WATCH nao e operacao.
 * Arquivo proprio porque a lista do historico (ai.service) e a dos setups
 * (setups.service) montam o mesmo resumo.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { clampValidity, closesBeyondInvalidation, isValidWatchPlan, nearEdge, type WatchPlan } from '../../common/utils/plan-engine';
import { storedSignalState } from '../../common/utils/signal-decision';
import type { AiLevel } from '../../common/utils/level-map';
import { TIMEFRAME_MS, analysisInterval } from '../market/candle-store';
import { priceSymbolOf } from '../market/candles';

/**
 * pending: sem linha no rastreador (janela aberta, ou fechada e ainda nao medida).
 * reached: o preco tocou o nivel dentro da validade.
 * expired: a validade acabou sem tocar o nivel.
 * invalidated: fechou alem da invalidacao antes de tocar o nivel.
 * unavailable: o rastreador nao teve velas deste ativo.
 */
export type WatchOutcome = 'pending' | 'reached' | 'expired' | 'invalidated' | 'unavailable';

/** O preco tocou o nivel e depois: alvo do plano, invalidacao ou nenhum dos dois. So o rastreador diz. */
export type WatchAfterReach = 'target' | 'invalidation' | 'neither' | null;

/** Geometria valida no nivel: o plano condicional que a tela e o e-mail mostram. */
export interface ConditionalPlan {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  tp1R: number;
}

export interface WatchSummary {
  direction: WatchPlan['direction'];
  /** Borda da area que o preco alcanca primeiro (o nivel que destrava a entrada). */
  level: number;
  invalidation: number;
  validForCandles: number;
  /** Hora da analise + validade x tempo grafico; null sem tempo grafico conhecido. */
  expiresAt: string | null;
  outcome: WatchOutcome;
  afterReach: WatchAfterReach;
  /** R do alvo que o rastreador mediu (bruto); so com afterReach 'target'. Informacao de mercado, nunca P&L. */
  targetR: number | null;
  /** O ativo tem fonte de preco: a tela oferece o alerta no nivel. */
  alertAvailable: boolean;
  setupId: string | null;
  /** null: geometria rejeitada no nivel ou analise sem o campo; so nivel e invalidacao. */
  plan: ConditionalPlan | null;
}

export interface WatchTrack {
  status: string;
  outcome: string | null;
  touched: boolean;
  fillPrice?: number | null;
  stopLoss?: number | null;
  takeProfit1?: number | null;
}

export function watchOutcomeOf(track: WatchTrack | null | undefined): WatchOutcome {
  if (!track) return 'pending';
  if (track.status !== 'tracked' || track.outcome === 'NO_CANDLES') return 'unavailable';
  // A ordem encerrou antes do fill. 'touched' tambem inclui retornos posteriores a zona.
  if (track.outcome === 'INVALIDATED') return 'invalidated';
  return track.touched ? 'reached' : 'expired';
}

/** Nomes do mercado, nunca de operacao: WIN e LOSS do rastreador aqui so dizem aonde o preco foi. */
export function watchAfterReachOf(track: WatchTrack | null | undefined): WatchAfterReach {
  if (!track || track.status !== 'tracked' || !track.touched) return null;
  if (track.outcome === 'WIN') return 'target';
  if (track.outcome === 'LOSS') return 'invalidation';
  return track.outcome === 'TIMEOUT' ? 'neither' : null;
}

/** R ate o alvo a partir do preco de entrada medido. */
export function watchTargetROf(track: WatchTrack | null | undefined): number | null {
  if (watchAfterReachOf(track) !== 'target' || !track?.fillPrice || !track.stopLoss || !track.takeProfit1) return null;
  const risk = Math.abs(track.fillPrice - track.stopLoss);
  return risk > 0 ? Math.abs(track.takeProfit1 - track.fillPrice) / risk : null;
}

const record = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

/** O plano de um WATCH salvo, com a validade no intervalo do motor; null fora do WATCH ou sem plano coerente. */
export function storedWatchPlan(result: unknown, recommendation: unknown): WatchPlan | null {
  const root = record(result);
  if (storedSignalState(root, recommendation) !== 'WATCH') return null;
  const raw = record(root.watchPlan);
  const plan = { ...raw, target2: raw.target2 ?? null, validForCandles: clampValidity(raw.validForCandles), trigger: String(raw.trigger ?? '') } as WatchPlan;
  return isValidWatchPlan(plan) ? plan : null;
}

/** O nivel da IA de um NO_TRADE rebaixado por risco; null fora disso ou em analise anterior ao campo completo. */
export function storedAiLevel(result: unknown, recommendation: unknown): AiLevel | null {
  const root = record(result);
  if (storedSignalState(root, recommendation) !== 'NO_TRADE') return null;
  const ai = record(root.aiLevel);
  const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (![ai.price, ai.invalidation, ai.validForCandles].every(positive) || (ai.direction !== 'long' && ai.direction !== 'short')) return null;
  return ai as AiLevel;
}

/** Ate quando o alerta do nivel da IA vale: a mesma conta do WATCH. */
export function aiLevelExpiresAt(ai: AiLevel, result: unknown, createdAt: Date, groundingInterval: string | null): string | null {
  const step = TIMEFRAME_MS[analysisInterval(groundingInterval, record(record(result).analysis).timeframe) ?? ''];
  return step ? new Date(createdAt.getTime() + ai.validForCandles * step).toISOString() : null;
}

/** Os niveis que o motor gravou para o WATCH; null = sem geometria valida no nivel. */
export function conditionalPlanOf(result: unknown): ConditionalPlan | null {
  const raw = record(record(result).watchLevels);
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (![raw.entry, raw.stopLoss, raw.takeProfit1, raw.tp1R].every(positive)) return null;
  return { entry: raw.entry, stopLoss: raw.stopLoss, takeProfit1: raw.takeProfit1, tp1R: raw.tp1R };
}

/** Resumo do WATCH de um resultado salvo; null fora do WATCH ou sem plano coerente (analise antiga). */
export function watchSummaryOf(
  result: unknown,
  recommendation: unknown,
  createdAt: Date,
  context: WatchContext | null | undefined,
): WatchSummary | null {
  const plan = storedWatchPlan(result, recommendation);
  if (!plan) return null;
  const root = record(result);
  const analysis = record(root.analysis);
  const interval = analysisInterval(context?.groundingInterval, analysis.timeframe);
  const step = interval ? TIMEFRAME_MS[interval] : undefined;
  const symbol = typeof analysis.symbol === 'string' ? analysis.symbol : typeof root.symbol === 'string' ? root.symbol : null;
  return {
    direction: plan.direction,
    level: nearEdge(plan),
    invalidation: plan.invalidation,
    validForCandles: plan.validForCandles,
    expiresAt: step ? new Date(createdAt.getTime() + plan.validForCandles * step).toISOString() : null,
    outcome: watchOutcomeOf(context?.track),
    afterReach: watchAfterReachOf(context?.track),
    targetR: watchTargetROf(context?.track),
    setupId: context?.setupId ?? null,
    alertAvailable: priceSymbolOf(symbol) !== null,
    plan: conditionalPlanOf(root),
  };
}

export interface WatchContext {
  groundingInterval: string | null;
  setupId: string | null;
  track: WatchTrack | null;
}

/** A analise fornece intervalo e setup mesmo antes de existir uma medicao. */
export async function loadWatchContexts(db: Pick<PrismaClient, '$queryRaw'>, ids: readonly string[]): Promise<Map<string, WatchContext>> {
  const out = new Map<string, WatchContext>();
  if (!ids.length) return out;
  try {
    const rows = await db.$queryRaw<Array<WatchTrack & { analysisId: string; groundingInterval: string | null; setupId: string | null }>>(Prisma.sql`
      SELECT a."id" AS "analysisId", a."groundingStats"->>'interval' AS "groundingInterval", a."setupId",
        t."status", t."outcome", t."touched", t."fillPrice", t."stopLoss", t."takeProfit1" FROM "tickrify"."Analysis" a
      LEFT JOIN "tickrify"."AnalysisTrack" t ON t."analysisId" = a."id"
      WHERE a."id" IN (${Prisma.join([...ids])})
    `);
    for (const row of rows) {
      out.set(row.analysisId, {
        groundingInterval: row.groundingInterval,
        setupId: row.setupId,
        track: row.status ? { status: row.status, outcome: row.outcome, touched: row.touched, fillPrice: row.fillPrice, stopLoss: row.stopLoss, takeProfit1: row.takeProfit1 } : null,
      });
    }
  } catch {
    // Medicao indisponivel: a lista continua legivel.
  }
  return out;
}

/** A analise seguinte do setup propos entrada: ENTER_NOW (ou a ordem antiga) ou BUY/SELL de antes do estado. */
export function isTradeSignal(signalState: string | null | undefined, recommendation: string | null | undefined): boolean {
  if (signalState === 'ENTER_NOW' || signalState === 'ARMED') return true;
  if (signalState === 'WATCH' || signalState === 'NO_TRADE') return false;
  return recommendation === 'BUY' || recommendation === 'SELL';
}

const ENTERED_VERDICTS = new Set(['open', 'tp1', 'tp2', 'stop']);

/** A analise seguinte no mesmo setup: a reanalise feita depois do WATCH. */
export interface WatchNext {
  analysisId: string;
  createdAt: Date;
  signalState: string | null;
  recommendation: string | null;
  userVerdict: string | null;
}

export type WatchJourneyEnd = 'entered' | 'skipped' | 'invalidated' | 'expired' | null;

/**
 * Jornada do WATCH na aba Watching: vigiando, o preco chegou, reanalisado,
 * e o fim (entrou, pulou, invalidou ou expirou). "Entrou" so com o resultado
 * que o trader marcou na reanalise; o motor nunca decide isso por ele.
 */
export interface WatchJourney {
  priceReached: boolean;
  recheck: { analysisId: string; createdAt: Date; signalState: string | null } | null;
  entered: { analysisId: string } | null;
  end: WatchJourneyEnd;
}

export function watchJourneyOf(watch: Pick<WatchSummary, 'outcome'>, alertTriggered: boolean, next: WatchNext | null): WatchJourney {
  const priceReached = alertTriggered || watch.outcome === 'reached';
  if (next) {
    const recheck = { analysisId: next.analysisId, createdAt: next.createdAt, signalState: next.signalState };
    const trade = isTradeSignal(next.signalState, next.recommendation);
    if (trade && next.userVerdict && ENTERED_VERDICTS.has(next.userVerdict)) {
      return { priceReached, recheck, entered: { analysisId: next.analysisId }, end: 'entered' };
    }
    // Entrada proposta e ainda sem marcacao: a decisao e do trader, a jornada para no reanalisado.
    return { priceReached, recheck, entered: null, end: trade && !next.userVerdict ? null : 'skipped' };
  }
  const end = watch.outcome === 'invalidated' ? 'invalidated' : watch.outcome === 'expired' ? 'expired' : null;
  return { priceReached, recheck: null, entered: null, end };
}

/** A primeira analise concluida do mesmo setup depois de cada WATCH. */
export async function loadWatchNext(db: Pick<PrismaClient, '$queryRaw'>, userId: string, ids: readonly string[]): Promise<Map<string, WatchNext>> {
  const out = new Map<string, WatchNext>();
  if (!ids.length) return out;
  try {
    const rows = await db.$queryRaw<Array<WatchNext & { watchId: string }>>(Prisma.sql`
      SELECT DISTINCT ON (w."id") w."id" AS "watchId", n."id" AS "analysisId", n."createdAt",
        n."result"->>'signalState' AS "signalState", n."recommendation", n."userVerdict"
      FROM "tickrify"."Analysis" w
      JOIN "tickrify"."Analysis" n ON n."setupId" = w."setupId" AND n."userId" = w."userId"
        AND n."status" = 'completed' AND n."createdAt" > w."createdAt"
      WHERE w."userId" = ${userId} AND w."setupId" IS NOT NULL AND w."id" IN (${Prisma.join([...ids])})
      ORDER BY w."id", n."createdAt" ASC, n."id" ASC
    `);
    for (const { watchId, ...next } of rows) out.set(watchId, next);
  } catch {
    // Sem a jornada a aba continua legivel: so nao mostra o reanalisado.
  }
  return out;
}

/** "From a watch on <data>": a analise anterior do mesmo setup era um WATCH. */
export interface WatchOrigin {
  analysisId: string;
  createdAt: Date;
}

export async function loadWatchOrigins(db: Pick<PrismaClient, '$queryRaw'>, userId: string, ids: readonly string[]): Promise<Map<string, WatchOrigin>> {
  const out = new Map<string, WatchOrigin>();
  if (!ids.length) return out;
  try {
    const rows = await db.$queryRaw<Array<WatchOrigin & { id: string }>>(Prisma.sql`
      SELECT a."id", p."id" AS "analysisId", p."createdAt"
      FROM "tickrify"."Analysis" a
      JOIN LATERAL (
        SELECT q."id", q."createdAt", q."result"->>'signalState' AS "signalState" FROM "tickrify"."Analysis" q
        WHERE q."setupId" = a."setupId" AND q."userId" = a."userId" AND q."status" = 'completed' AND q."createdAt" < a."createdAt"
        ORDER BY q."createdAt" DESC, q."id" DESC LIMIT 1
      ) p ON true
      WHERE a."userId" = ${userId} AND a."setupId" IS NOT NULL AND a."id" IN (${Prisma.join([...ids])}) AND p."signalState" = 'WATCH'
    `);
    for (const { id, ...origin } of rows) out.set(id, origin);
  } catch {
    // Sem a origem a linha do My Trades fica igual a antes.
  }
  return out;
}

/**
 * Watch que arma sozinho (23/11/2026): quando o alerta do nivel de um WATCH
 * dispara, o codigo confere o plano nas velas que o monitor ja tem, sem IA e
 * sem cota extra. `armed` = nenhuma vela do tempo grafico fechou alem da
 * invalidacao desde a analise; `invalidated` = alguma fechou; `pending` =
 * rompimento (breakout_close) que ainda nao fechou alem do nivel (so interno:
 * nada sai para pessoa nenhuma enquanto pendente).
 */
export interface ArmCheck {
  status: 'armed' | 'invalidated' | 'pending';
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  target: number | null;
  checkedAt: string;
}

/** O que a tela, o e-mail e o Telegram recebem: so armed e invalidated. */
export type ArmCheckView = Omit<ArmCheck, 'status'> & { status: 'armed' | 'invalidated' };

export function armCheckView(raw: unknown): ArmCheckView | null {
  const r = record(raw);
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if ((r.status !== 'armed' && r.status !== 'invalidated') || (r.direction !== 'long' && r.direction !== 'short')) return null;
  if (!num(r.entry) || !num(r.stop) || typeof r.checkedAt !== 'string') return null;
  return { status: r.status, direction: r.direction, entry: r.entry, stop: r.stop, target: num(r.target) ? (r.target as number) : null, checkedAt: r.checkedAt };
}

const fmtLevel = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 5 : 8 });

/** Mesmo texto no e-mail e no Telegram (ingles, copiloto: nunca ordem). */
export function armCheckText(check: ArmCheckView): string {
  const long = check.direction === 'long';
  if (check.status === 'invalidated') {
    return `Setup invalidated: a candle closed ${long ? 'below' : 'above'} ${fmtLevel(check.stop)} before price reached ${fmtLevel(check.entry)}.`;
  }
  return `Setup armed: ${long ? 'buy' : 'sell'} at ${fmtLevel(check.entry)}, stop ${fmtLevel(check.stop)}${check.target !== null ? `, target ${fmtLevel(check.target)}` : ''}.`;
}

type FineBar = readonly [number, number, number, number, number];

/** Velas finas -> velas do tempo grafico, so as FECHADAS e inteiras (cobertura completa do balde). */
export function closedTimeframeBars(fine: readonly FineBar[], fineStepMs: number, tfStepMs: number, fromMs: number, nowMs: number): FineBar[] {
  if (tfStepMs <= fineStepMs) return fine.filter((c) => c[0] + fineStepMs > fromMs && c[0] + fineStepMs <= nowMs);
  const buckets = new Map<number, FineBar[]>();
  for (const c of fine) {
    const start = Math.floor(c[0] / tfStepMs) * tfStepMs;
    if (start + tfStepMs <= fromMs || start + tfStepMs > nowMs) continue;
    buckets.set(start, [...(buckets.get(start) ?? []), c]);
  }
  const out: FineBar[] = [];
  for (const [start, cs] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...cs].sort((a, b) => a[0] - b[0]);
    // Balde incompleto (a fonte nao cobre o comeco ou o fim dele): nao se afirma nada.
    if (sorted[0][0] - start >= fineStepMs || start + tfStepMs - sorted[sorted.length - 1][0] > fineStepMs) continue;
    out.push([start, sorted[0][1], Math.max(...sorted.map((c) => c[2])), Math.min(...sorted.map((c) => c[3])), sorted[sorted.length - 1][4]]);
  }
  return out;
}

/**
 * A conferencia. `bars` = velas do tempo grafico fechadas desde a analise.
 * null = nao da para afirmar nada (sem plano; armado sem os niveis do plano):
 * o alerta segue como era, so "chegou no nivel".
 */
export function armCheckOf(input: {
  plan: WatchPlan | null;
  levels: ConditionalPlan | null;
  alertLevel: number;
  bars: readonly FineBar[];
  nowMs: number;
}): ArmCheck | null {
  const { plan, levels, alertLevel, bars, nowMs } = input;
  if (!plan) return null;
  const base = { direction: plan.direction, checkedAt: new Date(nowMs).toISOString() };
  const dead = bars.findIndex((b) => closesBeyondInvalidation(plan, b));
  if (dead >= 0) return { ...base, status: 'invalidated', entry: levels?.entry ?? alertLevel, stop: plan.invalidation, target: null };
  if (!levels) return null;
  if (plan.triggerType === 'breakout_close') {
    const closed = bars.some((b) => (plan.direction === 'long' ? b[4] > alertLevel : b[4] < alertLevel));
    if (!closed) return { ...base, status: 'pending', entry: levels.entry, stop: levels.stopLoss, target: levels.takeProfit1 };
  }
  return { ...base, status: 'armed', entry: levels.entry, stop: levels.stopLoss, target: levels.takeProfit1 };
}
