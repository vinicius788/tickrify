import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import { releasePendingTradeCheck } from './trade-check-reservation';

const KEY = 'ops.trade_checks.v1';
type Ticket = { id: string; userId: string; instance: string; startedAt: string };
type State = { version: 1; paused: boolean; active: Ticket[] };
const closed = (): State => ({ version: 1, paused: true, active: [] });
const pausedError = () => new ServiceUnavailableException({ code: 'trade_checks_paused', message: 'Trade checks are temporarily paused. Normal analyses and payments remain available.' });

function parse(value: string): State {
  const state = JSON.parse(value);
  if (state?.version !== 1 || typeof state.paused !== 'boolean' || !Array.isArray(state.active) ||
      state.active.some((t: Ticket) => !t || typeof t.id !== 'string' || typeof t.userId !== 'string' ||
        typeof t.instance !== 'string' || typeof t.startedAt !== 'string')) throw new Error('Invalid trade-check control; manual review required.');
  return state;
}
async function locked(tx: Prisma.TransactionClient): Promise<State> {
  const rows = await tx.$queryRawUnsafe<Array<{ value: string }>>(
    'SELECT "value" FROM "tickrify"."FeatureFlag" WHERE "key" = $1 FOR UPDATE', KEY);
  if (!rows[0]) throw pausedError();
  return parse(rows[0].value);
}
async function save(tx: Prisma.TransactionClient, state: State): Promise<void> {
  await tx.$executeRawUnsafe('UPDATE "tickrify"."FeatureFlag" SET "value" = $2, "updatedAt" = NOW() WHERE "key" = $1', KEY, JSON.stringify(state));
}
async function pending(tx: Prisma.TransactionClient): Promise<number> {
  const [row] = await tx.$queryRawUnsafe<Array<{ n: number }>>('SELECT COUNT(*)::int AS n FROM "tickrify"."TradeCheck" WHERE "result" = \'null\'::jsonb');
  return row.n;
}

/** Uses one existing row, transaction-level row locks and no session affinity.
 * Missing/invalid state fails closed. Never uses the feature-flag memory cache.
 */
export async function admitTradeCheck(prisma: PrismaService, ticket: Ticket): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const state = await locked(tx);
    if (state.paused) throw pausedError();
    if (state.active.some((t) => t.id === ticket.id)) throw new Error('Duplicate check ticket');
    state.active.push(ticket);
    await save(tx, state);
  });
}
export async function finishTradeCheck(prisma: PrismaService, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const state = await locked(tx);
    state.active = state.active.filter((t) => t.id !== id);
    await save(tx, state);
  });
}
export async function tradeCheckStatus(prisma: PrismaService) {
  const row = await prisma.featureFlag.findUnique({ where: { key: KEY }, select: { value: true } });
  const state = row ? parse(row.value) : closed();
  return { ...state, initialized: Boolean(row), pending: await pending(prisma) };
}
export async function pauseTradeChecks(prisma: PrismaService): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('INSERT INTO "tickrify"."FeatureFlag" ("key", "value", "updatedAt") VALUES ($1, $2, NOW()) ON CONFLICT ("key") DO NOTHING', KEY, JSON.stringify(closed()));
    const state = await locked(tx);
    state.paused = true;
    await save(tx, state);
  });
}
/** Caller must verify retirement of the bootstrap version before the first open. */
export async function openTradeChecks(prisma: PrismaService): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const state = await locked(tx);
    if (state.active.length || await pending(tx)) throw new Error('Trade checks have not drained/reconciled.');
    state.paused = false;
    await save(tx, state);
  });
}
export async function recoverTradeCheck(prisma: PrismaService, id: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const state = await locked(tx);
    if (!state.paused) throw new Error('Pause checks before recovery.');
    const ticket = state.active.find((t) => t.id === id);
    const [row] = await tx.$queryRawUnsafe<Array<{ userId: string }>>('SELECT "userId" FROM "tickrify"."TradeCheck" WHERE "id" = $1', id);
    if (ticket && row && ticket.userId !== row.userId) throw new Error('Inconsistent ticket owner.');
    const userId = ticket?.userId ?? row?.userId;
    const released = userId ? await releasePendingTradeCheck(prisma, userId, id, tx) : false;
    state.active = state.active.filter((t) => t.id !== id);
    await save(tx, state);
    return released;
  });
}
