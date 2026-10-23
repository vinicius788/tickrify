import { TradesService } from './trades.service';

// B2 synthetic service fixtures: no real account/order/candle history or database.
const NOW = new Date('2026-10-22T12:00:00Z');
const pendingAt = new Date('2026-10-14T12:00:00Z');
function fixture(status = 'pending_order', at = pendingAt, timeline = [{ status: 'pending_order', at: at.toISOString() }]) {
  let stored: any = { analysisId: 'synthetic-analysis', status, direction: 'BUY', symbol: 'TEST', timeframe: '1h',
    entryPrice: null, plannedEntry: 100, stopLoss: 95, target: 110, pendingAt: at, closeReason: null, timeline };
  const analysis = { id: stored.analysisId, createdAt: at, status: 'completed', recommendation: 'BUY',
    result: { analysis: { symbol: 'TEST', timeframe: '1h', entry: 100, entryType: 'limit', stopLoss: 95, takeProfit1: 110 } } };
  const prisma = {
    analysis: { findFirst: jest.fn().mockImplementation(async () => analysis) },
    $queryRawUnsafe: jest.fn().mockImplementation(async (sql: string) => sql.includes('FROM "tickrify"."TradeState"') ? [stored] : []),
    $executeRawUnsafe: jest.fn().mockImplementation(async (sql: string, ...args: any[]) => {
      if (sql.includes('INSERT INTO "tickrify"."TradeState"')) {
        stored = { ...stored, status: args[2], closeReason: args[12], timeline: JSON.parse(args[13]) };
      }
      return 1;
    }),
  };
  const service = new TradesService(prisma as any, {} as any, {} as any);
  (service as any).ready = true; // No boot, DDL, network, model or real DB.
  return { service, prisma, analysis, stored: () => stored };
}

describe('B2 synthetic temporal state: expiration response', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('returns the same expiration event already persisted, on the very first view', async () => {
    const f = fixture();
    const original = JSON.stringify(f.stored());
    const previous = f.stored();
    const first = await f.service.view('synthetic-user', 'synthetic-analysis');
    expect(first.status).toBe('expired');
    expect(first.timeline).toEqual(f.stored().timeline);
    expect(first.timeline.at(-1)).toEqual({ status: 'expired', at: NOW.toISOString(), closeReason: 'cancelled' });
    expect(JSON.stringify(previous)).toBe(original);
    expect(f.prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    const verdictWrite = f.prisma.$executeRawUnsafe.mock.calls[1];
    expect(verdictWrite.slice(1)).toEqual(['synthetic-analysis', 'synthetic-user', 'no_fill', NOW]);
    const reload = await f.service.view('synthetic-user', 'synthetic-analysis');
    expect(first).toEqual(reload);
    expect(f.prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('returns the persisted 50-event cap, including expiration, without an extra database read', async () => {
    const timeline = Array.from({ length: 50 }, (_, i) => ({ status: 'pending_order', at: new Date(pendingAt.getTime() + i).toISOString() }));
    const f = fixture('pending_order', pendingAt, timeline);
    const view = await f.service.view('synthetic-user', 'synthetic-analysis');
    expect(view.timeline).toEqual(f.stored().timeline);
    expect(view.timeline).toHaveLength(50);
    expect(view.timeline.at(-1)?.status).toBe('expired');
    expect(f.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['pending_order', new Date(NOW.getTime() - 7 * 86400000 + 1)],
    ['in_trade', pendingAt],
    ['cancelled', pendingAt],
  ])('preserves %s without introducing expiration by price or a new expiry rule', async (status, at) => {
    const f = fixture(status, at);
    const view = await f.service.view('synthetic-user', 'synthetic-analysis');
    expect(view.status).toBe(status);
    expect(view.timeline).toEqual(f.stored().timeline);
    expect(f.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('keeps the existing administrative expiry boundary at exactly seven days', async () => {
    const f = fixture('pending_order', new Date(NOW.getTime() - 7 * 86400000));
    expect((await f.service.view('synthetic-user', 'synthetic-analysis')).status).toBe('expired');
  });

  it('does not treat a WAIT with retained levels as a pre-approved order', async () => {
    const f = fixture();
    f.analysis.recommendation = 'WAIT';
    await expect(f.service.view('synthetic-user', 'synthetic-analysis')).rejects.toMatchObject({ response: { code: 'not_a_trade' } });
    expect(f.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(f.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
