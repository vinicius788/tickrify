/**
 * "I entered" num WATCH (11/11/2026): o trader registra que entrou no
 * plano da leitura (no nivel). E o registro DELE: aparece no
 * My Trades e no Diario, com o resultado que ele marcar. A leitura continua
 * WATCH; nada daqui entra na /accuracy, no sweeper nem no rastreador.
 */
import { storedWatchPlan } from './watch-pending';

export const WATCH_ENTRY_PLANS = ['level'] as const;
export type WatchEntryPlan = (typeof WATCH_ENTRY_PLANS)[number];

export interface WatchEntry {
  plan: WatchEntryPlan;
  direction: 'long' | 'short';
  /** Preco em que o trader entrou (digitado); stop e alvo sao os do plano escolhido. */
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  /** R do TP1 pelo preco de entrada digitado. */
  rr: number;
  at: string;
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** O que foi gravado, relido com desconfianca; qualquer campo torto = sem entrada. */
export function sanitizeWatchEntry(raw: unknown): WatchEntry | null {
  const e = record(typeof raw === 'string' ? safeParse(raw) : raw);
  if (!(WATCH_ENTRY_PLANS as readonly unknown[]).includes(e.plan)) return null;
  if (e.direction !== 'long' && e.direction !== 'short') return null;
  if (![e.entry, e.stopLoss, e.takeProfit1, e.rr].every(positive) || typeof e.at !== 'string') return null;
  return { plan: e.plan as WatchEntryPlan, direction: e.direction, entry: e.entry as number, stopLoss: e.stopLoss as number, takeProfit1: e.takeProfit1 as number, rr: e.rr as number, at: e.at };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type WatchEntryRefusal = 'not_a_watch' | 'watch_plan_unavailable' | 'entry_out_of_plan';

/**
 * Monta a entrada a partir do resultado salvo. Stop e alvo vem SO do plano que
 * o motor gravou (`watchLevels`, no nivel): sem
 * geometria valida gravada, nao ha o que registrar. O preco digitado tem de
 * ficar entre o stop e o alvo, do lado certo.
 */
export function buildWatchEntry(
  result: unknown,
  recommendation: unknown,
  input: { plan: WatchEntryPlan; entry: number },
  now: Date = new Date(),
): WatchEntry | WatchEntryRefusal {
  const watch = storedWatchPlan(result, recommendation);
  if (!watch) return 'not_a_watch';
  const levels = record(record(result).watchLevels);
  if (![levels.stopLoss, levels.takeProfit1].every(positive)) return 'watch_plan_unavailable';
  const stopLoss = levels.stopLoss as number;
  const takeProfit1 = levels.takeProfit1 as number;
  const long = watch.direction === 'long';
  if (long !== takeProfit1 > stopLoss) return 'watch_plan_unavailable';
  const { entry } = input;
  if (!positive(entry) || (long ? !(entry > stopLoss && entry < takeProfit1) : !(entry < stopLoss && entry > takeProfit1))) return 'entry_out_of_plan';
  const rr = Math.abs(takeProfit1 - entry) / Math.abs(entry - stopLoss);
  return { plan: input.plan, direction: watch.direction, entry, stopLoss, takeProfit1, rr: Math.round(rr * 100) / 100, at: now.toISOString() };
}
