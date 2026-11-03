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
import { TIMEFRAME_MS, normalizeTimeframe } from '../market/candle-store';
import { priceSymbolOf } from '../market/candles';

/**
 * pending: sem linha no rastreador (janela aberta, ou fechada e ainda nao medida).
 * reached: o preco tocou o nivel dentro da validade.
 * expired: a validade acabou sem tocar o nivel.
 * invalidated: fechou alem da invalidacao antes de tocar o nivel.
 * unavailable: o rastreador nao teve velas deste ativo.
 */
export type WatchOutcome = 'pending' | 'reached' | 'expired' | 'invalidated' | 'unavailable';

export interface WatchSummary {
  direction: WatchPlan['direction'];
  /** Borda da area que o preco alcanca primeiro (o nivel que destrava a entrada). */
  level: number;
  invalidation: number;
  validForCandles: number;
  /** Hora da analise + validade x tempo grafico; null sem tempo grafico conhecido. */
  expiresAt: string | null;
  outcome: WatchOutcome;
  /** O ativo tem fonte de preco: a tela oferece o alerta no nivel. */
  alertAvailable: boolean;
}

export interface WatchTrack {
  status: string;
  outcome: string | null;
  touched: boolean;
}

export function watchOutcomeOf(track: WatchTrack | null | undefined): WatchOutcome {
  if (!track) return 'pending';
  if (track.status !== 'tracked' || track.outcome === 'NO_CANDLES') return 'unavailable';
  if (track.touched) return 'reached';
  return track.outcome === 'INVALIDATED' ? 'invalidated' : 'expired';
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

/** Resumo do WATCH de um resultado salvo; null fora do WATCH ou sem plano coerente (analise antiga). */
export function watchSummaryOf(
  result: unknown,
  recommendation: unknown,
  createdAt: Date,
  track: WatchTrack | null | undefined,
): WatchSummary | null {
  const plan = storedWatchPlan(result, recommendation);
  if (!plan) return null;
  const root = record(result);
  const analysis = record(root.analysis);
  const interval = normalizeTimeframe(String(analysis.timeframe ?? root.timeframe ?? ''));
  const step = interval ? TIMEFRAME_MS[interval] : undefined;
  const symbol = typeof analysis.symbol === 'string' ? analysis.symbol : typeof root.symbol === 'string' ? root.symbol : null;
  return {
    direction: plan.direction,
    level: nearEdge(plan),
    invalidation: plan.invalidation,
    validForCandles: plan.validForCandles,
    expiresAt: step ? new Date(createdAt.getTime() + plan.validForCandles * step).toISOString() : null,
    outcome: watchOutcomeOf(track),
    alertAvailable: priceSymbolOf(symbol) !== null,
  };
}

/** O que o rastreador gravou para estas analises. Tabela ainda ausente ou falha: vazio (tudo segue pendente). */
export async function loadWatchTracks(db: Pick<PrismaClient, '$queryRaw'>, ids: readonly string[]): Promise<Map<string, WatchTrack>> {
  const out = new Map<string, WatchTrack>();
  if (!ids.length) return out;
  try {
    const rows = await db.$queryRaw<Array<WatchTrack & { analysisId: string }>>(Prisma.sql`
      SELECT "analysisId", "status", "outcome", "touched" FROM "tickrify"."AnalysisTrack"
      WHERE "analysisId" IN (${Prisma.join([...ids])})
    `);
    for (const row of rows ?? []) out.set(row.analysisId, { status: row.status, outcome: row.outcome, touched: row.touched === true });
  } catch {
    // Leitura de medicao: nunca derruba a lista.
  }
  return out;
}
