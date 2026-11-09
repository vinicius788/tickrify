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
import { clampValidity, isValidWatchPlan, nearEdge, type WatchPlan } from '../../common/utils/plan-engine';
import { storedSignalState } from '../../common/utils/signal-decision';
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

const record = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

/** O plano de um WATCH salvo, com a validade no intervalo do motor; null fora do WATCH ou sem plano coerente. */
export function storedWatchPlan(result: unknown, recommendation: unknown): WatchPlan | null {
  const root = record(result);
  if (storedSignalState(root, recommendation) !== 'WATCH') return null;
  const raw = record(root.watchPlan);
  const plan = { ...raw, target2: raw.target2 ?? null, validForCandles: clampValidity(raw.validForCandles), trigger: String(raw.trigger ?? '') } as WatchPlan;
  return isValidWatchPlan(plan) ? plan : null;
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
        t."status", t."outcome", t."touched" FROM "tickrify"."Analysis" a
      LEFT JOIN "tickrify"."AnalysisTrack" t ON t."analysisId" = a."id"
      WHERE a."id" IN (${Prisma.join([...ids])})
    `);
    for (const row of rows) {
      out.set(row.analysisId, {
        groundingInterval: row.groundingInterval,
        setupId: row.setupId,
        track: row.status ? { status: row.status, outcome: row.outcome, touched: row.touched } : null,
      });
    }
  } catch {
    // Medicao indisponivel: a lista continua legivel.
  }
  return out;
}
