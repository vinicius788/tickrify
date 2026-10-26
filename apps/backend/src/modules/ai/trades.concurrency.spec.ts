import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getFreeQuota } from '../../common/free-quota';
import { TicksService } from '../ticks/ticks.service';
import { AiService } from './ai.service';
import { TradesService } from './trades.service';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5h8AAAAASUVORK5CYII=';
const result = { situation: 'on_track', action: 'hold', decidedByPrice: false, needsCurrentPrice: false };
const blocked = () => new HttpException({ code: 'free_quota_exhausted' }, 402);
type Check = { id: string; analysisId: string; userId: string; isFree: boolean; cost: number;
  imageUrl: string | null; currentPrice: number | null; createdAt: Date; result: unknown };

/** In-memory transactional fixture, not a claim of PostgreSQL integration.
 * Transactions serialize with rollback; a model gate makes requests overlap.
 * The real quota reader, debit service, check method and compensation run.
 * No boot hooks, real database, storage, credentials or model calls.
 */
function fixture(options: { balance?: number; freeUsed?: number; checks?: number; trial?: boolean } = {}) {
  let data = {
    balance: options.balance ?? 1,
    checks: Array.from({ length: options.checks ?? 0 }, (_, n): Check => ({
      id: `old-${n}`, analysisId: 'a1', userId: 'u1', isFree: false, cost: 1,
      imageUrl: null, currentPrice: null, createdAt: new Date(), result,
    })),
    analyses: Array.from({ length: options.freeUsed ?? 0 }, () => ({
      userId: 'u1', isDemo: true, status: 'completed', recommendation: 'WAIT', createdAt: new Date(),
    })),
    ledger: [] as Array<Record<string, any>>,
    control: { version: 1, paused: false, active: [] } as { version: number; paused: boolean; active: any[] } | null,
  };
  const faults = { insert: false, reserveAckLost: false, save: false, saveAckLost: false, refund: false,
    conflicts: 0, rawConflict: false, sqlState: '40001', model: false };
  const trial = options.trial ? {
    userId: 'u1', startedAt: new Date(Date.now() - 60_000), timezone: 'UTC', status: 'active',
    endedAt: null, endReason: null, convertedAt: null, dayAtConversion: null, usageDays: [],
    analysesToday: 0, todayDate: null, source: 'signup', denyReason: null,
  } : null;
  let releaseModel!: () => void;
  const gate = new Promise<void>((resolve) => { releaseModel = resolve; });
  const adapter = { manageTrade: jest.fn(async () => {
    await gate;
    if (faults.model) throw new Error('synthetic model failure');
    return result;
  }) };
  function client(read: () => typeof data): any {
    return {
      user: { findUnique: jest.fn(async () => ({ id: 'u1', freeQuotaResetAt: null })) },
      analysis: {
        findFirst: jest.fn(async ({ where }: any) => where.userId !== 'u1' ? null : ({
          id: where.id, createdAt: new Date(), status: 'completed', recommendation: 'BUY',
          result: { analysis: { symbol: 'TEST', entry: 100, stopLoss: 90, takeProfit1: 110 } },
        })),
        count: jest.fn(async ({ where }: any) => read().analyses.filter((a) =>
          a.userId === where.userId && a.isDemo === where.isDemo &&
          (typeof where.status !== 'string' || a.status === where.status) &&
          (!where.status?.not || a.status !== where.status.not) &&
          (!where.status?.notIn || !where.status.notIn.includes(a.status)) &&
          (!where.recommendation?.in || where.recommendation.in.includes(a.recommendation)),
        ).length),
        findMany: jest.fn(async () => read().analyses),
        create: jest.fn(async ({ data: row }: any) => {
          const created = { ...row, id: 'new-analysis', createdAt: new Date() };
          read().analyses.push(created);
          return created;
        }),
      },
      userTicks: {
        findUnique: jest.fn(async () => ({ balance: read().balance })),
        updateMany: jest.fn(async ({ where, data: change }: any) => {
          if (read().balance < where.balance.gte) return { count: 0 };
          read().balance -= change.balance.decrement;
          return { count: 1 };
        }),
        upsert: jest.fn(async ({ update }: any) => { read().balance += update.balance.increment; }),
      },
      tickTransaction: {
        findFirst: jest.fn(async ({ where }: any) => read().ledger.find((t) =>
          t.userId === where.userId && t.type === where.type &&
          (where.amount === undefined || t.amount === where.amount) &&
          t.metadata?.tradeCheckId === where.metadata.equals) ?? null),
        create: jest.fn(async ({ data: row }: any) => {
        if (faults.refund && row.type === 'REFUND') throw new Error('synthetic refund failure');
        read().ledger.push(row);
      }) },
      $queryRawUnsafe: jest.fn(async (sql: string, ...args: any[]) => {
        if (sql.includes('"FeatureFlag"')) return read().control ? [{ value: JSON.stringify(read().control) }] : [];
        if (sql.includes('to_regclass')) return [{ ok: true }];
        if (sql.includes('"UserTrial"')) return trial ? [trial] : [];
        if (sql.includes('"Subscription"')) return [{ ok: false }];
        if (sql.includes('"TradeState"')) return [{ analysisId: args[0], status: 'in_trade', direction: 'BUY',
          symbol: 'TEST', timeframe: '1h', entryPrice: 100, plannedEntry: 100, stopLoss: 90, target: 110,
          pendingAt: null, closeReason: null, timeline: [] }];
        if (sql.includes('DELETE FROM "tickrify"."TradeCheck"')) {
          const c = read().checks.find((c) => c.id === args[0] && c.userId === args[1] && c.result === null);
          if (!c) return [];
          read().checks = read().checks.filter((row) => row !== c);
          return [c];
        }
        if (sql.includes('COUNT(*)') && sql.includes('"TradeCheck"')) {
          return [{ n: read().checks.filter((c) => c.analysisId === args[0]).length }];
        }
        if (sql.includes('"TradeCheck"') && sql.includes('"isFree" = true')) {
          return read().checks.filter((c) => c.userId === args[0] && c.isFree && c.createdAt > args[1])
            .map((c) => ({ createdAt: c.createdAt, pending: c.result === null }));
        }
        if (sql.includes('"TradeCheck"')) return read().checks.filter((c) => c.analysisId === args[0] && c.userId === args[1]);
        throw new Error(`Unexpected fixture query: ${sql}`);
      }),
      $executeRawUnsafe: jest.fn(async (sql: string, ...args: any[]) => {
        if (sql.includes('UPDATE "tickrify"."FeatureFlag"')) {
          read().control = JSON.parse(args[1]);
        } else if (sql.includes('INSERT INTO "tickrify"."TradeCheck"')) {
          if (faults.insert) throw new Error('synthetic reservation failure');
          read().checks.push({ id: args[0], analysisId: args[1], userId: args[2], isFree: args[3],
            cost: args[4], imageUrl: args[5], currentPrice: args[6], createdAt: new Date(),
            result: args.length > 7 ? JSON.parse(args[7]) : null });
        } else if (sql.includes('UPDATE "tickrify"."TradeCheck"')) {
          if (faults.save) throw new Error('synthetic save failure');
          const c = read().checks.find((c) => c.id === args[0] && c.userId === args[1] && c.result === null);
          if (!c) return 0;
          c.result = JSON.parse(args[2]);
          if (faults.saveAckLost) throw new Error('synthetic lost acknowledgement');
        }
        return 1;
      }),
    };
  }
  const prisma = client(() => data);
  let tail = Promise.resolve();
  prisma.$transaction = jest.fn(async (run: (tx: any) => Promise<unknown>, opts?: any) => {
    if (opts?.isolationLevel && faults.conflicts-- > 0) {
      throw new Prisma.PrismaClientKnownRequestError('synthetic transaction error', {
        code: faults.rawConflict ? 'P2010' : 'P2034', clientVersion: 'fixture',
        meta: faults.rawConflict ? { code: faults.sqlState } : undefined,
      });
    }
    const previous = tail;
    let unlock!: () => void;
    tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    const draft = structuredClone(data);
    try {
      const response = await run(client(() => draft));
      data = draft;
      if (opts?.isolationLevel && faults.reserveAckLost) throw new Error('synthetic lost reservation acknowledgement');
      return response;
    } finally { unlock(); }
  });
  const ticks = new TicksService(prisma);
  const service = new TradesService(prisma, adapter as any, ticks);
  (service as any).ready = true;
  const check = (paid = true, analysisId = 'a1') => service.check('u1', analysisId, { base64Image: image, currentPrice: 101, language: 'pt' }, paid, blocked);
  async function concurrent(count: number, paid = true, distinctTrades = false) {
    const settled = Promise.allSettled(Array.from({ length: count }, (_, n) => check(paid, distinctTrades ? `a${n}` : 'a1')));
    await new Promise(setImmediate);
    releaseModel();
    return settled;
  }
  return { service, adapter, prisma, faults, ticks, trial, check, concurrent, releaseModel, data: () => data };
}

describe('trade-check admission and compensation under concurrency', () => {
  it.each([false, true])('limits simultaneous paid checks to the available Tick (different trades: %s)', async (distinct) => {
    const f = fixture({ balance: 1 });
    const settled = await f.concurrent(8, true, distinct);
    expect(f.adapter.manageTrade).toHaveBeenCalledTimes(1);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(f.data().balance).toBe(0);
    expect(f.data().ledger.filter((t) => t.type === 'USAGE')).toHaveLength(1);
    expect(f.data().checks).toHaveLength(1);
  });

  it('reserves the last free slot across simultaneous checks on different trades', async () => {
    const f = fixture({ freeUsed: 9 });
    const settled = await f.concurrent(8, false, true);
    expect(f.adapter.manageTrade).toHaveBeenCalledTimes(1);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(f.data().ledger).toHaveLength(0);
    expect((await getFreeQuota(f.prisma, 'u1')).totalUsed).toBe(10);
  });

  it('enforces the existing ten-check cap before invoking AI', async () => {
    const f = fixture({ balance: 8, checks: 9 });
    await f.concurrent(8);
    expect(f.adapter.manageTrade).toHaveBeenCalledTimes(1);
    expect(f.data().checks).toHaveLength(10);
    expect(f.data().balance).toBe(7);
  });

  it('blocks on an in-flight trial check without prematurely ending the trial or exposing a null result', async () => {
    const f = fixture({ freeUsed: 2, trial: true });
    const pending = f.check(false);
    await new Promise(setImmediate);
    const quota = await getFreeQuota(f.prisma, 'u1');
    expect(quota).toMatchObject({ exhausted: true, settledExhausted: false, trial: { usedToday: 3, remainingToday: 0, endedSettled: false } });
    expect(await f.service.view('u1', 'a1')).toMatchObject({ checks: [], checksLeft: 9 });
    f.releaseModel();
    expect((await pending).view.checks).toHaveLength(1);
  });

  it('a pending legacy free check reserves the total quota without consuming an extra BUY/SELL signal', async () => {
    const f = fixture({ freeUsed: 9 });
    const pending = f.check(false);
    await new Promise(setImmediate);
    expect(await getFreeQuota(f.prisma, 'u1')).toMatchObject({ signalsUsed: 0, totalUsed: 10, exhausted: true, settledExhausted: false });
    f.releaseModel();
    await pending;
    expect((await getFreeQuota(f.prisma, 'u1')).settledExhausted).toBe(true);
  });

  it.each([false, true])('shares the last free slot with normal analysis in either request order (check first: %s)', async (checkFirst) => {
    const f = fixture({ freeUsed: 9 });
    const ai: any = { prisma: f.prisma, ticksService: f.ticks, trial: {}, DEMO_LIMIT_ERROR: 'demo limit', triggerRecoveryEmail: jest.fn() };
    const create = () => (AiService.prototype as any).enforceAccessAndCreate.call(ai, 'u1', 'quick', { imageUrl: image, status: 'pending' }, false);
    const settled = Promise.allSettled(checkFirst ? [f.check(false), create()] : [create(), f.check(false)]);
    await new Promise(setImmediate);
    f.releaseModel();
    expect((await settled).filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect((await getFreeQuota(f.prisma, 'u1')).totalUsed).toBe(10);
  });

  it.each([false, true])('settles the third trial day only on success, not on reservation (failure: %s)', async (failure) => {
    const f = fixture({ trial: true, freeUsed: 6 });
    f.trial!.startedAt = new Date(Date.now() - 3 * 86_400_000);
    f.data().analyses.forEach((a, n) => { a.createdAt = new Date(Date.now() - (n < 3 ? 2 : n < 5 ? 1 : 0) * 86_400_000); });
    f.faults.model = failure;
    const settled = Promise.allSettled([f.check(false)]);
    await new Promise(setImmediate);
    expect((await getFreeQuota(f.prisma, 'u1')).trial).toMatchObject({ dayIndex: 3, blocked: true, endedSettled: false });
    f.releaseModel();
    await settled;
    expect((await getFreeQuota(f.prisma, 'u1')).trial).toMatchObject({ blocked: !failure, endedSettled: !failure });
  });

  it('keeps successful management inputs, output and the one-Tick cost unchanged', async () => {
    const f = fixture({ balance: 2 });
    f.releaseModel();
    expect((await f.check()).result).toEqual(result);
    expect(f.adapter.manageTrade).toHaveBeenCalledWith(expect.stringContaining('data:image/png'), expect.objectContaining({
      direction: 'BUY', status: 'in_trade', symbol: 'TEST', plannedEntry: 100,
      stopLoss: 90, takeProfit1: 110, entryPrice: 100, currentPrice: 101, language: 'pt',
    }));
    expect(f.data().balance).toBe(1);
    expect(f.data().ledger).toEqual([expect.objectContaining({ amount: -1, type: 'USAGE',
      metadata: { analysisId: 'a1', kind: 'trade_check', tradeCheckId: f.data().checks[0].id } })]);
  });

  it.each(['balance', 'free', 'trade', 'image', 'storage', 'owner', 'closed'])('rejects %s before charging or calling AI', async (reason) => {
    const f = fixture({ balance: reason === 'balance' ? 0 : 1, freeUsed: reason === 'free' ? 10 : 0, checks: reason === 'trade' ? 10 : 0 });
    if (reason === 'storage') jest.spyOn(f.service as any, 'upload').mockRejectedValue(new Error('synthetic storage failure'));
    if (reason === 'closed') jest.spyOn(f.service as any, 'readState').mockResolvedValue({ status: 'closed' });
    const pending = f.service.check(reason === 'owner' ? 'u2' : 'u1', 'a1', { base64Image: reason === 'image' ? 'invalid' : image }, reason !== 'free', blocked);
    await expect(pending).rejects.toBeDefined();
    expect(f.adapter.manageTrade).not.toHaveBeenCalled();
    expect(f.data().ledger).toHaveLength(0);
  });

  it.each([false, true])('releases a failed model request without consuming quota or duplicating refunds (paid: %s)', async (paid) => {
    const f = fixture();
    f.faults.model = true;
    f.releaseModel();
    await expect(f.check(paid)).rejects.toThrow('synthetic model failure');
    expect(f.data().checks).toHaveLength(0);
    expect(f.data().balance).toBe(1);
    expect(f.data().ledger.filter((t) => t.type === 'REFUND')).toHaveLength(paid ? 1 : 0);
    if (paid) {
      const id = f.data().ledger[0].metadata.tradeCheckId;
      await Promise.all(Array.from({ length: 8 }, () => (f.service as any).releaseCheck('u1', id)));
      expect(f.data().balance).toBe(1);
      expect(f.data().ledger.filter((t) => t.type === 'REFUND')).toHaveLength(1);
      const refund = f.data().ledger.find((t) => t.type === 'REFUND')!;
      expect(refund.metadata).toEqual({ parentAnalysisId: 'a1', kind: 'trade_check', tradeCheckId: id });
      expect(refund.metadata).not.toHaveProperty('analysisId'); // Do not suppress the original analysis's refund.
    }
  });

  it('rolls back both the debit and reservation on insert failure, without calling AI', async () => {
    const f = fixture();
    f.faults.insert = true;
    await expect(f.check()).rejects.toThrow('synthetic reservation failure');
    expect(f.adapter.manageTrade).not.toHaveBeenCalled();
    expect(f.data()).toMatchObject({ balance: 1, checks: [], ledger: [] });
  });

  it('refunds a failed result write once', async () => {
    const f = fixture();
    f.faults.save = true;
    f.releaseModel();
    await expect(f.check()).rejects.toThrow('synthetic save failure');
    expect(f.data()).toMatchObject({ balance: 1, checks: [] });
    expect(f.data().ledger.map((t) => t.type)).toEqual(['USAGE', 'REFUND']);
  });

  it('compensates a committed reservation whose acknowledgement was lost, without invoking AI', async () => {
    const f = fixture();
    f.faults.reserveAckLost = true;
    await expect(f.check()).rejects.toThrow('synthetic lost reservation acknowledgement');
    expect(f.adapter.manageTrade).not.toHaveBeenCalled();
    expect(f.data()).toMatchObject({ balance: 1, checks: [] });
    expect(f.data().ledger.map((t) => t.type)).toEqual(['USAGE', 'REFUND']);
  });

  it('does not refund a result committed before its acknowledgement was lost', async () => {
    const f = fixture();
    f.faults.saveAckLost = true;
    f.releaseModel();
    await expect(f.check()).rejects.toThrow('synthetic lost acknowledgement');
    expect(f.data().balance).toBe(0);
    expect(f.data().checks[0].result).toEqual(result);
    expect(f.data().ledger.map((t) => t.type)).toEqual(['USAGE']);
  });

  it('retains an unconfirmed refund reservation and makes repeated recovery atomic', async () => {
    const f = fixture();
    f.faults.model = f.faults.refund = true;
    f.releaseModel();
    await expect(f.check()).rejects.toThrow('synthetic model failure');
    expect(f.data()).toMatchObject({ balance: 0, checks: [{ result: null }] });
    expect(f.data().ledger.map((t) => t.type)).toEqual(['USAGE']);
    f.faults.refund = false;
    const id = f.data().checks[0].id;
    await Promise.all(Array.from({ length: 8 }, () => (f.service as any).releaseCheck('u1', id)));
    expect(f.data()).toMatchObject({ balance: 1, checks: [] });
    expect(f.data().ledger.map((t) => t.type)).toEqual(['USAGE', 'REFUND']);
  });

  it.each([false, true])('refuses inconsistent recovery when debit is missing or refund already exists (refunded: %s)', async (refunded) => {
    const f = fixture();
    f.data().checks.push({ id: 'orphan', analysisId: 'a1', userId: 'u1', isFree: false,
      cost: 1, imageUrl: null, currentPrice: null, createdAt: new Date(), result: null });
    if (refunded) f.data().ledger.push(
      { userId: 'u1', amount: -1, type: 'USAGE', metadata: { tradeCheckId: 'orphan' } },
      { userId: 'u1', amount: 1, type: 'REFUND', metadata: { tradeCheckId: 'orphan' } });
    await expect((f.service as any).releaseCheck('u1', 'orphan')).rejects.toThrow('Inconsistent trade-check ledger');
    expect(f.data().balance).toBe(1);
    expect(f.data().checks).toHaveLength(1);
    expect(f.data().ledger).toHaveLength(refunded ? 2 : 0);
  });

  it('does not refund a successful check if response-view loading fails', async () => {
    const f = fixture();
    jest.spyOn(f.service, 'view').mockRejectedValue(new Error('synthetic view failure'));
    f.releaseModel();
    await expect(f.check()).rejects.toThrow('synthetic view failure');
    expect(f.data().balance).toBe(0);
    expect(f.data().checks[0].result).toEqual(result);
    expect(f.data().ledger.map((t) => t.type)).toEqual(['USAGE']);
  });

  it.each([false, true])('retries rolled-back model/raw serialization conflicts and calls AI once (raw: %s)', async (raw) => {
    const f = fixture();
    f.faults.conflicts = 2;
    f.faults.rawConflict = raw;
    f.releaseModel();
    await f.check();
    expect(f.prisma.$transaction.mock.calls.filter((call: any[]) => call[1]?.isolationLevel)).toHaveLength(3);
    expect(f.adapter.manageTrade).toHaveBeenCalledTimes(1);
    expect(f.data().ledger.map((t) => t.type)).toEqual(['USAGE']);
  });

  it('does not retry unrelated raw SQL failures', async () => {
    const f = fixture();
    f.faults.conflicts = 1;
    f.faults.rawConflict = true;
    f.faults.sqlState = '23505';
    await expect(f.check()).rejects.toMatchObject({ code: 'P2010' });
    expect(f.prisma.$transaction.mock.calls.filter((call: any[]) => call[1]?.isolationLevel)).toHaveLength(1);
    expect(f.adapter.manageTrade).not.toHaveBeenCalled();
    expect(f.data()).toMatchObject({ balance: 1, checks: [], ledger: [] });
  });

  it('fails closed after bounded serialization retries, without charging or invoking AI', async () => {
    const f = fixture();
    f.faults.conflicts = 5;
    await expect(f.check()).rejects.toMatchObject({ response: { code: 'trade_check_busy' }, status: 503 });
    expect(f.adapter.manageTrade).not.toHaveBeenCalled();
    expect(f.data()).toMatchObject({ balance: 1, checks: [], ledger: [] });
  });

  it.each([false, true])('pauses only check admission and fails closed without initialized control (missing: %s)', async (missing) => {
    const f = fixture();
    if (missing) f.data().control = null;
    else f.data().control!.paused = true;
    await expect(f.check()).rejects.toMatchObject({ status: 503, response: { code: 'trade_checks_paused' } });
    expect(f.adapter.manageTrade).not.toHaveBeenCalled();
    expect(f.data()).toMatchObject({ balance: 1, checks: [], ledger: [] });
  });
});
