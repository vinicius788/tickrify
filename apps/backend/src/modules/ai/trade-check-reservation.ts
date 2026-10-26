import type { PrismaService } from '../database/prisma.service';
import type { Prisma } from '@prisma/client';

/** Compensation shared by the request failure path and explicit recovery.
 * Never use age alone to decide that a pending provider call has stopped.
 */
export async function releasePendingTradeCheck(prisma: PrismaService, userId: string, checkId: string, transaction?: Prisma.TransactionClient): Promise<boolean> {
  const release = async (tx: Prisma.TransactionClient) => {
    // DELETE is the atomic claim. A committed result cannot be refunded;
    // concurrent/repeated recovery gets no row and creates no credit.
    const released = await tx.$queryRawUnsafe<Array<{ isFree: boolean; cost: number; analysisId: string }>>(
      `DELETE FROM "tickrify"."TradeCheck"
        WHERE "id" = $1 AND "userId" = $2 AND "result" = 'null'::jsonb
        RETURNING "isFree", "cost", "analysisId"`,
      checkId, userId,
    );
    const check = released[0];
    if (!check) return false;
    if (!check.isFree) {
      // Recovery may encounter an old or inconsistent JSON-null record.
      // Never infer a paid debit from the reservation's cost alone.
      const debit = await tx.tickTransaction.findFirst({
        where: { userId, type: 'USAGE', amount: -check.cost,
          metadata: { path: ['tradeCheckId'], equals: checkId } },
        select: { id: true },
      });
      const refund = await tx.tickTransaction.findFirst({
        where: { userId, type: 'REFUND', metadata: { path: ['tradeCheckId'], equals: checkId } },
        select: { id: true },
      });
      if (check.cost <= 0 || !debit || refund) {
        // Throwing also restores the deleted row, preserving evidence.
        throw new Error('Inconsistent trade-check ledger; manual review required.');
      }
      await tx.userTicks.upsert({
        where: { userId },
        create: { userId, balance: check.cost },
        update: { balance: { increment: check.cost } },
      });
      await tx.tickTransaction.create({ data: {
        userId, amount: check.cost, type: 'REFUND', description: 'Refund: trade check failed',
        // The original analysis uses metadata.analysisId for its own refunds.
        metadata: { parentAnalysisId: check.analysisId, kind: 'trade_check', tradeCheckId: checkId },
      } });
    }
    return true;
  };
  return transaction ? release(transaction) : prisma.$transaction(release);
}
