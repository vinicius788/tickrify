import { fork, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TicksService } from '../ticks/ticks.service';
import { getFreeQuota } from '../../common/free-quota';
import { AiService } from './ai.service';
import { TradesService } from './trades.service';
import { pauseTradeChecks, openTradeChecks, tradeCheckStatus, recoverTradeCheck } from './trade-check-control';

// Explicit opt-in. Never consume DATABASE_URL from a developer or deployment.
const integration = process.env.TICKRIFY_PG_INTEGRATION === '1' ? describe : describe.skip;
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5h8AAAAASUVORK5CYII=';
const modelResult = { situation: 'on_track', action: 'hold', decidedByPrice: false, needsCurrentPrice: false };
const quotaError = () => new HttpException({ code: 'free_quota_exhausted' }, 402);

integration('isolated PostgreSQL: real admission, refunds and crash recovery', () => {
  jest.setTimeout(60_000);
  let prisma: any;
  let userId: string;
  let analysisId: string;
  let openingBalance = 1;
  const pids = new Set<number>();

  beforeAll(async () => {
    const url = new URL(process.env.TICKRIFY_PG_TEST_URL || '');
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/tickrify_concurrency_test' || url.username !== 'tickrify_test') {
      throw new Error('Refusing any database except the disposable loopback fixture.');
    }
    process.env.DATABASE_URL = url.toString();
    process.env.DIRECT_URL = url.toString();
    prisma = new PrismaService();
    await prisma.$connect();
    const [db] = await prisma.$queryRawUnsafe('SELECT current_database()::text AS name, current_user::text AS role');
    expect(db).toEqual({ name: 'tickrify_concurrency_test', role: 'tickrify_test' });
    // Fixture DDL from the existing generated client's metadata, not project
    // migrations or application boot hooks. This DB was created for this test.
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS tickrify CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA tickrify');
    await prisma.$executeRawUnsafe(`CREATE TYPE tickrify."TickTxType" AS ENUM ('PURCHASE','USAGE','REFUND','BONUS')`);
    const types: Record<string, string> = { String: 'TEXT', Int: 'INTEGER', Float: 'DOUBLE PRECISION',
      Boolean: 'BOOLEAN', DateTime: 'TIMESTAMP(3)', Json: 'JSONB', TickTxType: 'tickrify."TickTxType"' };
    for (const model of Prisma.dmmf.datamodel.models.filter((m) => ['User', 'Analysis', 'UserTicks', 'TickTransaction', 'Subscription', 'FeatureFlag'].includes(m.name))) {
      const columns = model.fields.filter((f) => f.kind !== 'object').map((field) => {
        let column = `"${field.dbName || field.name}" ${types[field.type]}${field.isRequired ? ' NOT NULL' : ''}`;
        if (field.isId) column += ' PRIMARY KEY';
        if (field.isUnique) column += ' UNIQUE';
        const value = field.default;
        if (typeof value === 'string') column += ` DEFAULT '${value.replace(/'/g, "''")}'`;
        else if (typeof value === 'number' || typeof value === 'boolean') column += ` DEFAULT ${value}`;
        else if (value && typeof value === 'object' && 'name' in value && value.name === 'now') column += ' DEFAULT CURRENT_TIMESTAMP';
        return column;
      });
      await prisma.$executeRawUnsafe(`CREATE TABLE tickrify."${model.dbName || model.name}" (${columns.join(',')})`);
    }
    await prisma.$executeRawUnsafe(`CREATE TABLE tickrify."TradeState" (
      "analysisId" TEXT PRIMARY KEY REFERENCES tickrify."Analysis"("id"), "userId" TEXT REFERENCES tickrify."User"("id"),
      "status" TEXT, "direction" TEXT, "symbol" TEXT, "timeframe" TEXT, "entryPrice" DOUBLE PRECISION,
      "plannedEntry" DOUBLE PRECISION, "stopLoss" DOUBLE PRECISION, "target" DOUBLE PRECISION,
      "pendingAt" TIMESTAMP(3), "closeReason" TEXT, "timeline" JSONB DEFAULT '[]')`);
    await prisma.$executeRawUnsafe(`CREATE TABLE tickrify."TradeCheck" (
      "id" TEXT PRIMARY KEY, "analysisId" TEXT NOT NULL REFERENCES tickrify."Analysis"("id"),
      "userId" TEXT NOT NULL REFERENCES tickrify."User"("id"), "isFree" BOOLEAN NOT NULL DEFAULT false,
      "cost" INTEGER NOT NULL DEFAULT 0, "imageUrl" TEXT, "currentPrice" DOUBLE PRECISION,
      "result" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await prisma.$executeRawUnsafe('CREATE INDEX ON tickrify."TradeCheck" ("analysisId", "createdAt")');
    await prisma.$executeRawUnsafe('CREATE INDEX ON tickrify."TradeCheck" ("userId", "isFree", "createdAt")');
    await prisma.$executeRawUnsafe(`ALTER TABLE tickrify.tick_transactions ADD FOREIGN KEY ("userId") REFERENCES tickrify.user_ticks("userId")`);
    await prisma.$executeRawUnsafe(`CREATE TABLE tickrify."UserTrial" (
      "userId" TEXT PRIMARY KEY, "startedAt" TIMESTAMP(3), "timezone" TEXT, "status" TEXT DEFAULT 'active',
      "endedAt" TIMESTAMP(3), "endReason" TEXT, "convertedAt" TIMESTAMP(3), "dayAtConversion" INTEGER,
      "usageDays" JSONB DEFAULT '[]', "analysesToday" INTEGER DEFAULT 0, "todayDate" TEXT,
      "source" TEXT DEFAULT 'signup', "denyReason" TEXT)`);
    const transaction = prisma.$transaction.bind(prisma);
    prisma.$transaction = (run: any, options: any) => Array.isArray(run) ? transaction(run, options) : transaction(async (tx: any) => {
      const [row] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
      pids.add(row.pid);
      return run(tx);
    }, options);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE tickrify."FeatureFlag", tickrify."TradeCheck", tickrify."TradeState", tickrify."UserTrial", tickrify.tick_transactions, tickrify.user_ticks, tickrify."Analysis", tickrify."Subscription", tickrify."User" CASCADE');
    userId = randomUUID();
    openingBalance = 1;
    await prisma.user.create({ data: { id: userId, clerkUserId: `synthetic-${userId}` } });
    analysisId = await addTrade();
    await prisma.userTicks.create({ data: { userId, balance: 1 } });
    await pauseTradeChecks(prisma);
    await openTradeChecks(prisma);
  });

  afterAll(async () => { await prisma?.$disconnect(); });

  async function addTrade() {
    const row = await prisma.analysis.create({ data: { userId, status: 'completed', recommendation: 'BUY',
      result: { analysis: { symbol: 'TEST', entry: 100, stopLoss: 90, takeProfit1: 110 } } } });
    await prisma.$executeRawUnsafe(`INSERT INTO tickrify."TradeState" ("analysisId","userId","status","direction") VALUES ($1,$2,'in_trade','BUY')`, row.id, userId);
    return row.id;
  }
  async function freeUsed(count: number) {
    await prisma.analysis.createMany({ data: Array.from({ length: count }, () => ({ userId, isDemo: true, status: 'completed', recommendation: 'WAIT' })) });
  }
  function fixture(client = prisma) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = { manageTrade: jest.fn(async () => { await gate; return modelResult; }) };
    const service = new TradesService(client, adapter as any, new TicksService(client));
    (service as any).ready = true;
    const check = (paid = true, id = analysisId) => service.check(userId, id, { base64Image: image }, paid, quotaError);
    return { service, adapter, release, check };
  }
  async function waitFor(test: () => Promise<boolean>) {
    for (let i = 0; i < 200; i++) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Fixture barrier timed out');
  }
  async function balances() {
    const balance = (await prisma.userTicks.findUnique({ where: { userId } })).balance;
    const ledger = await prisma.tickTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const checks = await prisma.$queryRawUnsafe('SELECT * FROM tickrify."TradeCheck" WHERE "userId"=$1', userId);
    expect(balance).toBe(openingBalance + ledger.reduce((sum: number, tx: any) => sum + tx.amount, 0));
    return { balance, ledger, checks };
  }
  async function runCli(name: string, args: string[], compat = false) {
    return new Promise<{ code: number | null; output: any }>((resolve, reject) => {
      const script = compat ? resolvePath(process.env.TICKRIFY_COMPAT_BACKEND_DIST!, '../scripts', name) : resolvePath(__dirname, '../../../scripts', name);
      const child = spawn(process.execPath, [script, ...args], {
        env: { PATH: process.env.PATH, NODE_ENV: 'test', APP_ENV: 'test',
          DATABASE_URL: process.env.TICKRIFY_PG_TEST_URL, DIRECT_URL: process.env.TICKRIFY_PG_TEST_URL },
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk.toString(); });
      child.stderr.resume();
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, output: output ? JSON.parse(output) : null }));
    });
  }
  const recovery = (args: string[], compat = false) => runCli('reconcile-trade-check.cjs', args, compat);
  const control = (args: string[], compat = false) => runCli('trade-check-control.cjs', args, compat);

  it.each([true, false])('admits only one of sixteen requests for the last Tick/free slot (paid=%s)', async (paid) => {
    if (!paid) await freeUsed(9);
    const ids = await Promise.all(Array.from({ length: 16 }, () => addTrade()));
    const f = fixture();
    const work = Promise.allSettled(ids.map((id) => f.check(paid, id)));
    try {
      await waitFor(async () => f.adapter.manageTrade.mock.calls.length === 1);
      // Let every competing admission finish while the winning AI is in flight.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(f.adapter.manageTrade).toHaveBeenCalledTimes(1);
    } finally { f.release(); }
    const settled = await work;
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const item of settled) if (item.status === 'rejected') expect([402, 503]).toContain(item.reason.status);
    expect(f.adapter.manageTrade).toHaveBeenCalledTimes(1);
    const state = await balances();
    expect(state.checks).toHaveLength(1);
    expect(state.balance).toBe(paid ? 0 : 1);
    if (!paid) expect((await getFreeQuota(prisma, userId)).totalUsed).toBe(10);
    expect(pids.size).toBeGreaterThan(1);
  });

  it('allows only the final check out of ten, even with enough Ticks', async () => {
    await prisma.userTicks.update({ where: { userId }, data: { balance: 20 } });
    for (let i = 0; i < 9; i++) await prisma.$executeRawUnsafe(`INSERT INTO tickrify."TradeCheck" ("id","analysisId","userId","result") VALUES ($1,$2,$3,$4::jsonb)`, randomUUID(), analysisId, userId, JSON.stringify(modelResult));
    const f = fixture();
    const work = Promise.allSettled(Array.from({ length: 16 }, () => f.check()));
    await waitFor(async () => f.adapter.manageTrade.mock.calls.length === 1);
    f.release();
    const settled = await work;
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const item of settled) if (item.status === 'rejected') expect([429, 503]).toContain(item.reason.status);
    expect(f.adapter.manageTrade).toHaveBeenCalledTimes(1);
    expect((await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM tickrify."TradeCheck"'))[0].n).toBe(10);
    expect((await prisma.userTicks.findUnique({ where: { userId } })).balance).toBe(19);
  });

  it('admits exactly two requests for the last two Ticks, without negative balance', async () => {
    openingBalance = 2;
    await prisma.userTicks.update({ where: { userId }, data: { balance: 2 } });
    const f = fixture();
    const work = Promise.allSettled(Array.from({ length: 16 }, () => f.check()));
    try { await waitFor(async () => f.adapter.manageTrade.mock.calls.length === 2); }
    finally { f.release(); }
    expect((await work).filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(f.adapter.manageTrade).toHaveBeenCalledTimes(2);
    expect((await balances()).balance).toBe(0);
    expect((await balances()).ledger).toHaveLength(2);
  });

  it.each([false, true])('shares the final free slot with normal analysis (check first: %s)', async (checkFirst) => {
    await freeUsed(9);
    const f = fixture();
    const ai: any = { prisma, ticksService: new TicksService(prisma), trial: {}, DEMO_LIMIT_ERROR: 'quota', triggerRecoveryEmail: jest.fn() };
    const create = () => (AiService.prototype as any).enforceAccessAndCreate.call(ai, userId, 'quick', { imageUrl: image, status: 'pending' }, false);
    const work = Promise.allSettled(checkFirst ? [f.check(false), create()] : [create(), f.check(false)]);
    f.release();
    const settled = await work;
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const item of settled) if (item.status === 'rejected') expect([402, 403, 503]).toContain(item.reason.status);
    expect((await getFreeQuota(prisma, userId)).totalUsed).toBe(10);
  });

  it('refunds model failure, and twelve concurrent recovery attempts cannot mint extra Ticks', async () => {
    const f = fixture();
    f.adapter.manageTrade.mockRejectedValue(new Error('synthetic model failure'));
    await expect(f.check()).rejects.toThrow('synthetic model failure');
    let state = await balances();
    const id = state.ledger.find((tx: any) => tx.type === 'USAGE').metadata.tradeCheckId;
    await Promise.all(Array.from({ length: 12 }, () => (f.service as any).releaseCheck(userId, id)));
    state = await balances();
    expect(state.balance).toBe(1);
    expect(state.checks).toHaveLength(0);
    expect(state.ledger.filter((tx: any) => tx.type === 'REFUND')).toHaveLength(1);
  });

  it('rolls back a failed refund, then explicit concurrent reconciliation restores only one Tick', async () => {
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION tickrify.reject_refund() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."type" = 'REFUND' THEN RAISE EXCEPTION 'synthetic refund unavailable'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER reject_refund BEFORE INSERT ON tickrify.tick_transactions FOR EACH ROW EXECUTE FUNCTION tickrify.reject_refund()');
    const f = fixture();
    f.adapter.manageTrade.mockRejectedValue(new Error('synthetic model failure'));
    try {
      await expect(f.check()).rejects.toThrow('synthetic model failure');
      const state = await balances();
      expect(state.balance).toBe(0);
      expect(state.checks).toHaveLength(1);
      expect(state.ledger.map((tx: any) => tx.type)).toEqual(['USAGE']);
    } finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_refund ON tickrify.tick_transactions'); }
    const id = (await balances()).checks[0].id;
    await pauseTradeChecks(prisma);
    const args = ['--check-id', id, '--apply', '--confirm-execution-stopped'];
    const responses = await Promise.all([recovery(args), recovery(args)]);
    expect(responses.map((r) => r.code)).toEqual([0, 0]);
    expect(responses.filter((r) => r.output.released)).toHaveLength(1);
    expect((await balances()).balance).toBe(1);
    expect((await balances()).ledger.filter((tx: any) => tx.type === 'REFUND')).toHaveLength(1);
  });

  it('refuses to mint credit for a pending legacy/corrupt record without a matching debit', async () => {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO tickrify."TradeCheck" ("id","analysisId","userId","cost","result") VALUES ($1,$2,$3,1,'null')`, id, analysisId, userId);
    await pauseTradeChecks(prisma);
    const response = await recovery(['--check-id', id, '--apply', '--confirm-execution-stopped']);
    expect(response.code).toBe(1);
    const state = await balances();
    expect(state.balance).toBe(1);
    expect(state.ledger).toHaveLength(0);
    expect(state.checks).toHaveLength(1);
  });

  it('does not credit a result committed before the acknowledgement was lost', async () => {
    const execute = prisma.$executeRawUnsafe.bind(prisma);
    const fault = async (sql: string, ...args: any[]) => {
      const count = await execute(sql, ...args);
      if (sql.includes('UPDATE "tickrify"."TradeCheck" SET "result"')) throw new Error('synthetic acknowledgement lost');
      return count;
    };
    // Do not overwrite a Prisma client's method: transaction proxies would
    // inherit the bound root method and incorrectly issue writes outside TX.
    const facade = new Proxy(prisma, { get(target, key) {
      if (key === '$executeRawUnsafe') return fault;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const f = fixture(facade);
    f.release();
    await expect(f.check()).rejects.toThrow('synthetic acknowledgement lost');
    const state = await balances();
    expect(state.balance).toBe(0);
    expect(state.checks[0].result).toEqual(modelResult);
    await pauseTradeChecks(prisma);
    const response = await recovery(['--check-id', state.checks[0].id, '--apply', '--confirm-execution-stopped']);
    expect(response).toMatchObject({ code: 0, output: { released: false } });
    expect((await balances()).ledger.map((tx: any) => tx.type)).toEqual(['USAGE']);
  });

  it('inspects an active reservation without releasing it and never refunds a completed result', async () => {
    const f = fixture();
    const work = f.check();
    await waitFor(async () => f.adapter.manageTrade.mock.calls.length === 1);
    const state = await balances();
    expect(state.balance).toBe(0);
    expect(state.checks[0].result).toBeNull();
    expect((await recovery(['--check-id', state.checks[0].id])).output.mode).toBe('inspect');
    expect((await balances()).balance).toBe(0);
    expect((await f.service.view(userId, analysisId)).checks).toHaveLength(0);
    f.release();
    await work;
    await Promise.all(Array.from({ length: 12 }, () => (f.service as any).releaseCheck(userId, state.checks[0].id)));
    expect((await balances()).balance).toBe(0);
  });

  const legacy = process.env.TICKRIFY_PUBLISHED_BACKEND_DIST ? it : it.skip;
  const rollout = process.env.TICKRIFY_COMPAT_BACKEND_DIST ? it : it.skip;
  function compatibleService(adapter: any) {
    const { TradesService: Compat } = require(resolvePath(process.env.TICKRIFY_COMPAT_BACKEND_DIST!, 'src/modules/ai/trades.service.js'));
    const service = new Compat(prisma, adapter, new TicksService(prisma));
    service.ready = true;
    return service;
  }

  rollout('drains only checks while normal paid analysis and synthetic payment credit remain functional', async () => {
    openingBalance = 2;
    await prisma.userTicks.update({ where: { userId }, data: { balance: 2 } });
    const f = fixture();
    const work = f.check();
    await waitFor(async () => f.adapter.manageTrade.mock.calls.length === 1);
    await pauseTradeChecks(prisma);
    expect((await tradeCheckStatus(prisma)).active).toHaveLength(1);
    await expect(openTradeChecks(prisma)).rejects.toThrow('not drained');
    const denied = await Promise.allSettled(Array.from({ length: 16 }, () => f.check()));
    expect(denied.every((r) => r.status === 'rejected' && r.reason.status === 503)).toBe(true);
    const ai: any = { prisma, ticksService: new TicksService(prisma) };
    const normal = await (AiService.prototype as any).enforceAccessAndCreate.call(ai, userId, 'quick', { imageUrl: image, status: 'pending' }, true);
    expect(normal.isDemo).toBe(false);
    await new TicksService(prisma).addTicks(userId, 3, 'synthetic payment credit', 'pi_rollout_fixture');
    f.release();
    await work;
    expect(await tradeCheckStatus(prisma)).toMatchObject({ paused: true, active: [], pending: 0 });
    expect((await balances()).balance).toBe(3);
    expect(f.adapter.manageTrade).toHaveBeenCalledTimes(1);
  });

  rollout('executes the exact pause/status/open commands from the rollback artifact, requiring retirement confirmation', async () => {
    expect((await control(['pause'], true)).output).toMatchObject({ paused: true, active: [], pending: 0 });
    expect((await control(['status'], true)).output.paused).toBe(true);
    expect((await control(['open'], true)).code).toBe(1);
    expect((await tradeCheckStatus(prisma)).paused).toBe(true);
    expect((await control(['open', '--confirm-bootstrap-retired'], true)).output.paused).toBe(false);
    const f = fixture();
    await expect(compatibleService(f.adapter).check(userId, analysisId, { base64Image: image }, true, quotaError)).rejects.toMatchObject({ status: 503 });
    f.release();
    await f.check();
    expect((await balances()).balance).toBe(0);
    expect((await control(['pause'], true)).output).toMatchObject({ paused: true, active: [], pending: 0 });
    expect(f.adapter.manageTrade).toHaveBeenCalledTimes(1);
  });

  rollout('keeps phase A closed even after open; phase B alone invokes AI, then pauses for rollback', async () => {
    const f = fixture();
    const a = compatibleService(f.adapter);
    const denied = await Promise.allSettled(Array.from({ length: 16 }, () => a.check(userId, analysisId, { base64Image: image }, true, quotaError)));
    expect(denied.every((r) => r.status === 'rejected' && r.reason.status === 503)).toBe(true);
    expect(f.adapter.manageTrade).not.toHaveBeenCalled();
    const b = f.check();
    await waitFor(async () => f.adapter.manageTrade.mock.calls.length === 1);
    await expect(a.check(userId, analysisId, { base64Image: image }, true, quotaError)).rejects.toMatchObject({ status: 503 });
    await pauseTradeChecks(prisma);
    f.release();
    await b;
    expect(await tradeCheckStatus(prisma)).toMatchObject({ paused: true, active: [], pending: 0 });
    expect((await a.view(userId, analysisId)).checks[0].result).toEqual(modelResult);
    await expect(a.check(userId, analysisId, { base64Image: image }, true, quotaError)).rejects.toMatchObject({ status: 503 });
    expect((await balances()).balance).toBe(0);
    expect(f.adapter.manageTrade).toHaveBeenCalledTimes(1);
  });

  legacy('proves bootstrap 26d45be bypasses pause and is invisible to the new drain status', async () => {
    await pauseTradeChecks(prisma);
    const f = fixture();
    const old = publishedService(f.adapter);
    const work = old.check(userId, analysisId, { base64Image: image }, true, quotaError);
    try {
      await waitFor(async () => f.adapter.manageTrade.mock.calls.length === 1);
      expect(await tradeCheckStatus(prisma)).toMatchObject({ paused: true, active: [], pending: 0 });
      // This is an explicit bootstrap limitation, never treated as "drained".
    } finally { f.release(); await work; }
  });

  rollout('recovers the active ticket and its monetary reservation atomically after an interrupted request', async () => {
    // A confirmed stopped process may leave an admission ticket without a
    // reservation. Recovery must not create credit for that pre-debit case.
    await pauseTradeChecks(prisma);
    const id = randomUUID();
    const row = await prisma.featureFlag.findUnique({ where: { key: 'ops.trade_checks.v1' } });
    const state = JSON.parse(row.value);
    state.active.push({ id, userId, instance: 'stopped-synthetic-process', startedAt: new Date().toISOString() });
    await prisma.featureFlag.update({ where: { key: row.key }, data: { value: JSON.stringify(state) } });
    await expect(openTradeChecks(prisma)).rejects.toThrow('not drained');
    await Promise.all(Array.from({ length: 12 }, () => recoverTradeCheck(prisma, id)));
    expect(await tradeCheckStatus(prisma)).toMatchObject({ paused: true, active: [], pending: 0 });
    expect((await balances()).balance).toBe(1);
    expect((await balances()).ledger).toHaveLength(0);
  });
  function publishedService(adapter: any) {
    const { TradesService: Published } = require(resolvePath(process.env.TICKRIFY_PUBLISHED_BACKEND_DIST!, 'src/modules/ai/trades.service.js'));
    const service = new Published(prisma, adapter, new TicksService(prisma));
    service.ready = true;
    return service;
  }

  legacy('proves the old API exposes pending JSON null while the corrected API hides it', async () => {
    const f = fixture();
    const work = f.check();
    try {
      await waitFor(async () => f.adapter.manageTrade.mock.calls.length === 1);
      const old = publishedService(f.adapter);
      expect((await old.view(userId, analysisId)).checks[0].result).toBeNull();
      expect((await f.service.view(userId, analysisId)).checks).toHaveLength(0);
      if (process.env.TICKRIFY_COMPAT_BACKEND_DIST) {
        const { TradesService: Compat } = require(resolvePath(process.env.TICKRIFY_COMPAT_BACKEND_DIST, 'src/modules/ai/trades.service.js'));
        const compat = new Compat(prisma, f.adapter, new TicksService(prisma));
        compat.ready = true;
        expect((await compat.view(userId, analysisId)).checks).toHaveLength(0);
      }
    } finally { f.release(); await work; }
    expect((await publishedService(f.adapter).view(userId, analysisId)).checks[0].result).toEqual(modelResult);
  });

  legacy('proves an overlapping old writer can call AI beyond the balance despite the new reservation', async () => {
    const f = fixture();
    const old = publishedService(f.adapter);
    let arrivals = 0;
    let releaseUploads!: () => void;
    const uploads = new Promise<void>((resolve) => { releaseUploads = resolve; });
    for (const service of [old, f.service]) jest.spyOn(service as any, 'upload').mockImplementation(async () => {
      if (++arrivals === 2) releaseUploads();
      await uploads;
      return image;
    });
    const work = Promise.allSettled([old.check(userId, analysisId, { base64Image: image }, true, quotaError), f.check()]);
    try {
      await waitFor(async () => f.adapter.manageTrade.mock.calls.length === 2);
      expect(f.adapter.manageTrade).toHaveBeenCalledTimes(2); // Incompatibility reproduced, not a passing mixed rollout.
    } finally { f.release(); await work; }
    expect((await balances()).balance).toBe(0);
  });

  legacy('proves the old quota reader ends the trial prematurely on a pending final-day check', async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO tickrify."UserTrial" ("userId","startedAt","timezone") VALUES ($1,$2,'UTC')`, userId, new Date(Date.now() - 3 * 86400000));
    await prisma.analysis.createMany({ data: Array.from({ length: 6 }, (_, n) => ({ userId, isDemo: true,
      status: 'completed', recommendation: 'WAIT', createdAt: new Date(Date.now() - (n < 3 ? 2 : n < 5 ? 1 : 0) * 86400000) })) });
    const f = fixture();
    const work = f.check(false);
    try {
      await waitFor(async () => f.adapter.manageTrade.mock.calls.length === 1);
      const { getFreeQuota: oldQuota } = require(resolvePath(process.env.TICKRIFY_PUBLISHED_BACKEND_DIST!, 'src/common/free-quota.js'));
      expect((await oldQuota(prisma, userId)).trial.endedSettled).toBe(true);
      expect((await getFreeQuota(prisma, userId)).trial).toMatchObject({ blocked: true, endedSettled: false });
      if (process.env.TICKRIFY_COMPAT_BACKEND_DIST) {
        const { getFreeQuota: compatQuota } = require(resolvePath(process.env.TICKRIFY_COMPAT_BACKEND_DIST, 'src/common/free-quota.js'));
        expect((await compatQuota(prisma, userId)).trial).toMatchObject({ blocked: true, endedSettled: false });
      }
    } finally { f.release(); await work; }
  });

  it.each(['before-commit', 'model-started'])('handles SIGKILL at %s without extra credits', async (phase) => {
    const child = fork(resolvePath(__dirname, '../../../test/trade-check-crash.cjs'), [userId, analysisId, image, phase], {
      execPath: process.execPath, env: { PATH: process.env.PATH, NODE_ENV: 'test', APP_ENV: 'test', TICKRIFY_PG_TEST_URL: process.env.TICKRIFY_PG_TEST_URL },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let errors = '';
    child.stderr?.on('data', (chunk) => { errors += chunk.toString(); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`child did not reach synthetic AI: ${errors}`)), 15_000);
        child.once('message', (message: any) => { clearTimeout(timer);
          message.event === (phase === 'before-commit' ? 'reservation-uncommitted' : 'model-started') ? resolve() : reject(new Error(JSON.stringify(message))); });
        child.once('exit', () => { clearTimeout(timer); reject(new Error(`child exited: ${errors}`)); });
      });
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
      if (phase === 'before-commit') {
        await waitFor(async () => (await balances()).balance === 1);
        expect((await balances()).checks).toHaveLength(0);
        expect((await balances()).ledger).toHaveLength(0);
        await pauseTradeChecks(prisma);
        const status = await tradeCheckStatus(prisma);
        expect(status.active).toHaveLength(1);
        expect((await recovery(['--check-id', status.active[0].id, '--apply', '--confirm-execution-stopped'], Boolean(process.env.TICKRIFY_COMPAT_BACKEND_DIST))).code).toBe(0);
        expect((await tradeCheckStatus(prisma)).active).toHaveLength(0);
        return;
      }
      const state = await balances();
      expect(state.balance).toBe(0);
      expect(state.checks[0].result).toBeNull();
      const f = fixture();
      await expect(f.check()).rejects.toMatchObject({ status: 402 });
      expect(f.adapter.manageTrade).not.toHaveBeenCalled();
      const id = state.checks[0].id;
      await pauseTradeChecks(prisma);
      if (process.env.TICKRIFY_COMPAT_BACKEND_DIST) {
        await expect(compatibleService(f.adapter).check(userId, analysisId, { base64Image: image }, true, quotaError)).rejects.toMatchObject({ status: 503 });
      }
      expect((await recovery(['--check-id', id])).output).toMatchObject({ mode: 'inspect', reservations: [{ pending: true }] });
      expect((await balances()).balance).toBe(0);
      expect((await recovery(['--check-id', id, '--apply'])).code).toBe(1);
      expect((await balances()).balance).toBe(0);
      const responses = await Promise.all(Array.from({ length: 2 }, () => recovery(['--check-id', id, '--apply', '--confirm-execution-stopped'], Boolean(process.env.TICKRIFY_COMPAT_BACKEND_DIST))));
      expect(responses.map((r) => r.code)).toEqual([0, 0]);
      expect(responses.filter((r) => r.output.released)).toHaveLength(1);
      await Promise.all(Array.from({ length: 12 }, () => (f.service as any).releaseCheck(userId, id)));
      expect((await balances()).balance).toBe(1);
      expect((await balances()).ledger.filter((tx: any) => tx.type === 'REFUND')).toHaveLength(1);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  });
});
