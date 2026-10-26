import { fork, spawn, ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { DemoService } from './demo.service';
import { PrismaService } from '../database/prisma.service';
import { AIAnalysisError } from '../ai/ai.adapter';
import { demoStatus, openDemo, pauseDemo } from './demo-control';

const integration = process.env.TICKRIFY_DEMO_PG_INTEGRATION === '1' ? describe : describe.skip;
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5h8AAAAASUVORK5CYII=';
const modelResult = { recommendation: 'HOLD', confidence: 50, analysis: {} };
const hash = (s: string) => createHash('sha256').update(`synthetic-demo-salt|${s}`).digest('hex');
const params = (fingerprint = 'synthetic-device', ip = '192.0.2.10') => ({
  fingerprint, ip, base64Image: image, turnstileToken: `synthetic-proof-${randomUUID()}`,
});
const outcome = (promise: Promise<unknown>) => promise.then(value => ({ value, error: null }), error => ({ value: null, error }));

integration('demo: disposable PostgreSQL admission, recovery and version coexistence', () => {
  jest.setTimeout(30_000);
  let prisma: PrismaService;
  let published: typeof DemoService;
  const children = new Set<ChildProcess>();
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    const url = new URL(process.env.TICKRIFY_DEMO_TEST_URL || '');
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/tickrify_demo_concurrency_test' || url.username !== 'tickrify_demo_test') {
      throw new Error('Only the disposable loopback demo database is allowed.');
    }
    process.env.DATABASE_URL = url.toString();
    process.env.DIRECT_URL = url.toString();
    prisma = new PrismaService();
    await prisma.$connect();
    const [db] = await prisma.$queryRawUnsafe<Array<{ name: string; role: string }>>('SELECT current_database()::text AS name, current_user::text AS role');
    expect(db).toEqual({ name: 'tickrify_demo_concurrency_test', role: 'tickrify_demo_test' });
    published = require(resolve(process.env.TICKRIFY_DEMO_PUBLISHED_DIST!, 'modules/demo/demo.service.js')).DemoService;
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS tickrify CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA tickrify');
    const boot = new DemoService(prisma, {} as any, {} as any);
    await boot.onModuleInit(); // Existing demo DDL only, in this disposable DB.
    expect((boot as any).tableReady).toBe(true);
    await prisma.$executeRawUnsafe(`CREATE TABLE tickrify."FeatureFlag" (
      "key" TEXT PRIMARY KEY, "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedById" TEXT)`);
  });

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.DEMO_HASH_SALT = 'synthetic-demo-salt';
    process.env.TURNSTILE_SECRET_KEY = 'synthetic-turnstile-secret';
    process.env.DEMO_IP_DAILY_CAP = '3';
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
    await prisma.$executeRawUnsafe('TRUNCATE tickrify."DemoUsage", tickrify."FeatureFlag"');
    await pauseDemo(prisma);
    await openDemo(prisma);
  });

  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) await stop(child);
    }
    children.clear();
    jest.restoreAllMocks();
  });
  afterAll(async () => { await prisma?.$disconnect(); process.env = originalEnv; });

  function fixture(options: { old?: boolean; execute?: (...args: any[]) => Promise<any>; transaction?: (...args: any[]) => Promise<any> } = {}) {
    const client = new Proxy(prisma, {
      get(target, key) {
        if (key === 'promptConfig') return { findFirst: jest.fn().mockResolvedValue(null) };
        if (key === '$executeRaw' && options.execute) return options.execute;
        if (key === '$transaction' && options.transaction) return options.transaction;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    let release!: () => void;
    const barrier = new Promise<void>(r => { release = r; });
    const ai = { analyzeImage: jest.fn(async () => { await barrier; return modelResult; }) };
    const prompt = { buildPromptByVersion: jest.fn().mockResolvedValue('synthetic prompt') };
    const Service = options.old ? published : DemoService;
    const service = new Service(client, ai as any, prompt as any);
    (service as any).tableReady = true;
    return { service, ai, prompt, release };
  }

  async function count() {
    const [r] = await prisma.$queryRawUnsafe<Array<{ n: number }>>('SELECT COUNT(*)::int AS n FROM tickrify."DemoUsage"');
    return r.n;
  }
  async function seed(fingerprint: string, ip = '192.0.2.10', result: unknown = { status: 'completed', recommendation: 'WAIT' }, hoursAgo = 0) {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO tickrify."DemoUsage" (id,"fingerprintHash","ipHash",result,"createdAt")
      VALUES ($1,$2,$3,$4::jsonb,NOW()-$5::int*INTERVAL '1 hour')`, id, hash(fingerprint), hash(ip), JSON.stringify(result), hoursAgo);
    return id;
  }
  async function waitFor(check: () => Promise<boolean> | boolean) {
    for (let i = 0; i < 300; i++) {
      if (await check()) return;
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('Synthetic barrier timed out');
  }

  it('16 simultaneous requests for the same fingerprint/IP start exactly one analysis', async () => {
    const f = fixture();
    const requests = Array.from({ length: 16 }, () => outcome(f.service.analyze(params())));
    await waitFor(() => f.ai.analyzeImage.mock.calls.length === 1);
    expect(await f.service.getFingerprintStatus('synthetic-device')).toEqual({ used: false, result: null });
    expect(await count()).toBe(1);
    f.release();
    const results = await Promise.all(requests);
    expect(f.ai.analyzeImage).toHaveBeenCalledTimes(1);
    expect(results.filter(r => r.error).every(r => r.error.status === 503)).toBe(true);
    expect(await f.service.getFingerprintStatus('synthetic-device')).toMatchObject({ used: true, result: { recovered: true } });
  });

  it('a fingerprint racing from 16 different IPs still starts only one analysis', async () => {
    const f = fixture();
    const requests = Array.from({ length: 16 }, (_, i) => outcome(f.service.analyze(params('synthetic-device', `192.0.2.${i + 1}`))));
    await waitFor(() => f.ai.analyzeImage.mock.calls.length === 1);
    f.release();
    await Promise.all(requests);
    expect(f.ai.analyzeImage).toHaveBeenCalledTimes(1);
    expect(await count()).toBe(1);
  });

  it.each([1, 3, 5])('16 fingerprints sharing an IP cannot exceed capacity %i', async cap => {
    process.env.DEMO_IP_DAILY_CAP = String(cap);
    const f = fixture();
    const requests = Array.from({ length: 16 }, (_, i) => outcome(f.service.analyze(params(`synthetic-device-${i}`))));
    await waitFor(() => f.ai.analyzeImage.mock.calls.length === cap);
    expect(await count()).toBe(cap);
    f.release();
    const results = await Promise.all(requests);
    expect(results.filter(r => !r.error)).toHaveLength(cap);
    expect(results.filter(r => r.error).every(r => r.error.status === 403)).toBe(true);
    expect(f.ai.analyzeImage).toHaveBeenCalledTimes(cap);
    expect(await count()).toBe(cap);
  });

  it('simultaneous requests dispute the last remaining IP slot atomically', async () => {
    await seed('used-fingerprint-1'); await seed('used-fingerprint-2');
    const f = fixture();
    const requests = Array.from({ length: 12 }, (_, i) => outcome(f.service.analyze(params(`last-slot-device-${i}`))));
    await waitFor(() => f.ai.analyzeImage.mock.calls.length === 1);
    f.release();
    await Promise.all(requests);
    expect(f.ai.analyzeImage).toHaveBeenCalledTimes(1);
    expect(await count()).toBe(3);
  });

  it('different IPs are independent while AI is running outside transactions', async () => {
    process.env.DEMO_IP_DAILY_CAP = '1';
    const f = fixture();
    const first = outcome(f.service.analyze(params('first-synthetic-device')));
    const second = outcome(f.service.analyze(params('second-synthetic-device', '192.0.2.11')));
    await waitFor(() => f.ai.analyzeImage.mock.calls.length === 2);
    f.release(); await Promise.all([first, second]);
    expect(await count()).toBe(2);
  });

  it.each(['non_chart_image', 'openai_timeout'])('a settled AI failure %s releases only its reservation and permits retry', async code => {
    const f = fixture(); f.release();
    f.ai.analyzeImage.mockRejectedValueOnce(new AIAnalysisError({ code: code as any, message: 'synthetic failure', retriable: false }));
    await expect(f.service.analyze(params())).rejects.toMatchObject({ status: code === 'non_chart_image' ? 400 : 503 });
    expect(await count()).toBe(0);
    await expect(f.service.analyze(params())).resolves.toMatchObject({ status: 'completed' });
    expect(await count()).toBe(1);
  });

  it('invalid images and prompt failures do not consume capacity or call AI', async () => {
    const f = fixture();
    await expect(f.service.analyze({ ...params(), base64Image: 'invalid' })).rejects.toMatchObject({ status: 400 });
    expect(await count()).toBe(0);
    f.prompt.buildPromptByVersion.mockRejectedValue(new Error('synthetic prompt unavailable'));
    await expect(f.service.analyze(params())).rejects.toMatchObject({ status: 503 });
    expect(f.ai.analyzeImage).not.toHaveBeenCalled();
    expect(await count()).toBe(0);
  });

  it('failed cleanup retains capacity instead of admitting a duplicate analysis', async () => {
    const f = fixture({ execute: async (...args) => {
      if (args[0].join('?').includes('DELETE')) throw new Error('synthetic database outage');
      return (prisma.$executeRaw as any)(...args);
    } });
    f.ai.analyzeImage.mockRejectedValue(new Error('synthetic provider failure'));
    await expect(f.service.analyze(params())).rejects.toMatchObject({ status: 503 });
    await expect(f.service.analyze(params())).rejects.toMatchObject({ status: 503 });
    expect(f.ai.analyzeImage).toHaveBeenCalledTimes(1);
    expect(await count()).toBe(1);
  });

  it('repeated cleanup cannot free a replacement reservation or delete a completed result', async () => {
    const stale = await seed('synthetic-device', undefined, null);
    const f = fixture();
    await (f.service as any).releaseReservation(stale);
    expect(await count()).toBe(0);
    const request = f.service.analyze(params());
    await waitFor(() => f.ai.analyzeImage.mock.calls.length === 1);
    const [current] = await prisma.$queryRawUnsafe<Array<{ id: string }>>('SELECT id FROM tickrify."DemoUsage"');
    expect(current.id).not.toBe(stale);
    await Promise.all(Array.from({ length: 12 }, () => (f.service as any).releaseReservation(stale)));
    expect(await count()).toBe(1);
    f.release(); await request;
    await (f.service as any).releaseReservation(current.id);
    expect(await f.service.getFingerprintStatus('synthetic-device')).toMatchObject({ used: true, result: { recovered: true } });
    expect(await count()).toBe(1);
  });

  it('an unconfirmed admission commit never starts AI or releases an unknown slot', async () => {
    const f = fixture({ transaction: async (...args) => {
      await (prisma.$transaction as any)(...args);
      throw new Error('synthetic lost commit acknowledgement');
    } });
    await expect(f.service.analyze(params())).rejects.toMatchObject({ status: 503 });
    expect(f.ai.analyzeImage).not.toHaveBeenCalled();
    expect(await count()).toBe(1);
    await expect(fixture().service.analyze(params())).rejects.toMatchObject({ status: 503 });
  });

  it.each([false, true])('an unconfirmed result write (committed=%s) cannot produce duplicate AI', async committed => {
    const f = fixture({ execute: async (...args) => {
      if (committed) await (prisma.$executeRaw as any)(...args);
      throw new Error('synthetic lost result acknowledgement');
    } }); f.release();
    await expect(f.service.analyze(params())).rejects.toMatchObject({ status: 503 });
    expect(await count()).toBe(1);
    const retry = fixture();
    if (committed) await expect(retry.service.analyze({ ...params(), base64Image: undefined })).resolves.toMatchObject({ recovered: true });
    else await expect(retry.service.analyze(params())).rejects.toMatchObject({ status: 503 });
    expect(retry.ai.analyzeImage).not.toHaveBeenCalled();
  });

  it('recoverable results last 24h from completion, not from admission', async () => {
    const f = fixture(); const call = f.service.analyze(params());
    await waitFor(() => f.ai.analyzeImage.mock.calls.length === 1);
    await prisma.$executeRawUnsafe('UPDATE tickrify."DemoUsage" SET "createdAt"=NOW()-INTERVAL \'25 hours\'');
    f.release(); await call;
    await expect(f.service.analyze({ ...params(), base64Image: undefined })).resolves.toMatchObject({ recovered: true });
    expect(f.ai.analyzeImage).toHaveBeenCalledTimes(1);
  });

  it('expired results are not returned or regenerated; legacy SQL NULL remains used', async () => {
    await seed('expired-fingerprint', undefined, { status: 'completed' }, 25);
    const f = fixture();
    await expect(f.service.analyze(params('expired-fingerprint'))).rejects.toMatchObject({ status: 403 });
    await prisma.$executeRawUnsafe('UPDATE tickrify."DemoUsage" SET result=NULL');
    expect(await f.service.getFingerprintStatus('expired-fingerprint')).toEqual({ used: true, result: null });
    await expect(f.service.analyze(params('expired-fingerprint'))).rejects.toMatchObject({ status: 403 });
    expect(f.ai.analyzeImage).not.toHaveBeenCalled();
  });

  it('old completed IP usage expires, but a pending reservation cannot expire automatically', async () => {
    process.env.DEMO_IP_DAILY_CAP = '1';
    await seed('expired-fingerprint', undefined, { status: 'completed' }, 25);
    const f = fixture(); f.release();
    await expect(f.service.analyze(params())).resolves.toMatchObject({ status: 'completed' });
    await prisma.$executeRawUnsafe('TRUNCATE tickrify."DemoUsage"');
    await seed('stale-pending-fingerprint', undefined, null, 25);
    await expect(f.service.analyze(params())).rejects.toMatchObject({ status: 403 });
    expect(f.ai.analyzeImage).toHaveBeenCalledTimes(1);
  });

  async function stop(child: ChildProcess) {
    const exited = new Promise<void>(r => child.once('exit', () => r()));
    child.kill('SIGKILL'); await exited;
  }
  async function crashAt(event: string) {
    const child = fork(resolve(__dirname, '../../../test/demo-crash.cjs'), [event, image], {
      env: { ...process.env, DATABASE_URL: process.env.TICKRIFY_DEMO_TEST_URL }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    }); children.add(child);
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Crash fixture did not reach the requested barrier')), 10_000);
      child.on('message', (m: any) => {
        if (m.event === event) { clearTimeout(timer); done(); }
        else if (m.event === 'error') { clearTimeout(timer); reject(new Error('Crash fixture failed')); }
      });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Crash fixture exited prematurely')); });
    });
    await stop(child);
  }

  it('SIGKILL before the reservation commit rolls back both fingerprint and IP capacity', async () => {
    await crashAt('uncommitted');
    await waitFor(async () => await count() === 0);
    const f = fixture(); f.release();
    await expect(f.service.analyze(params())).resolves.toMatchObject({ status: 'completed' });
  });

  it('SIGKILL during AI keeps the durable reservation; restart cannot duplicate the call', async () => {
    await crashAt('model-started');
    expect(await count()).toBe(1);
    const f = fixture();
    await expect(f.service.analyze(params())).rejects.toMatchObject({ status: 503 });
    expect(f.ai.analyzeImage).not.toHaveBeenCalled();
  });

  it('negative rollout evidence: an old request already in AI can race the new fingerprint reservation', async () => {
    const old = fixture({ old: true }); const newer = fixture();
    const first = outcome(old.service.analyze(params()));
    await waitFor(() => old.ai.analyzeImage.mock.calls.length === 1);
    expect(await count()).toBe(0);
    const second = outcome(newer.service.analyze(params()));
    await waitFor(() => newer.ai.analyzeImage.mock.calls.length === 1);
    old.release(); newer.release(); await Promise.all([first, second]);
    expect(old.ai.analyzeImage.mock.calls.length + newer.ai.analyzeImage.mock.calls.length).toBe(2);
    expect(await count()).toBe(1);
  });

  it('negative rollout evidence: old/new requests can both spend the last IP slot', async () => {
    await seed('used-fingerprint-1'); await seed('used-fingerprint-2');
    const old = fixture({ old: true }); const newer = fixture();
    const first = outcome(old.service.analyze(params('old-device-fingerprint')));
    await waitFor(() => old.ai.analyzeImage.mock.calls.length === 1);
    const second = outcome(newer.service.analyze(params('new-device-fingerprint')));
    await waitFor(() => newer.ai.analyzeImage.mock.calls.length === 1);
    old.release(); newer.release(); await Promise.all([first, second]);
    expect(await count()).toBe(4); // Configured cap is 3: coexistence is unsafe.
  });

  it('negative rollback evidence: the old reader reports pending as already consumed', async () => {
    await seed('synthetic-device', undefined, null);
    expect(await fixture().service.getFingerprintStatus('synthetic-device')).toEqual({ used: false, result: null });
    expect(await fixture({ old: true }).service.getFingerprintStatus('synthetic-device')).toEqual({ used: true, result: null });
  });
  const pausedCode = (error: any) => error?.getResponse?.()?.code;

  it('fails closed without the control row: no reservation and no AI', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE tickrify."FeatureFlag"');
    const f = fixture();
    const { error } = await outcome(f.service.analyze(params()));
    expect(error?.status).toBe(503);
    expect(pausedCode(error)).toBe('demo_paused');
    expect(f.ai.analyzeImage).not.toHaveBeenCalled();
    expect(await count()).toBe(0);
  });

  it('a pause waits for an admission inside its transaction, then drains it before reopening', async () => {
    let hold!: () => void;
    const held = new Promise<void>(r => { hold = r; });
    let inside = false;
    const transaction = prisma.$transaction.bind(prisma) as any;
    const f = fixture({ transaction: (run: any, options: any) => transaction(async (tx: any) => {
      const out = await run(tx); inside = true; await held; return out;
    }, { ...options, timeout: 20_000 }) });
    const request = outcome(f.service.analyze(params()));
    await waitFor(() => inside);
    let paused = false;
    const pause = pauseDemo(prisma).then(() => { paused = true; });
    await new Promise(r => setTimeout(r, 300));
    expect(paused).toBe(false);
    hold();
    await pause;
    expect((await demoStatus(prisma)).pending).toHaveLength(1);
    const blocked = fixture();
    const denied = await outcome(blocked.service.analyze(params('other-device', '192.0.2.99')));
    expect(pausedCode(denied.error)).toBe('demo_paused');
    expect(blocked.ai.analyzeImage).not.toHaveBeenCalled();
    await expect(openDemo(prisma)).rejects.toThrow('pending');
    await waitFor(() => f.ai.analyzeImage.mock.calls.length === 1);
    f.release();
    expect((await request).error).toBeNull();
    expect((await demoStatus(prisma)).pending).toHaveLength(0);
    await openDemo(prisma);
    const reopened = fixture();
    const next = outcome(reopened.service.analyze(params('third-device', '192.0.2.98')));
    await waitFor(() => reopened.ai.analyzeImage.mock.calls.length === 1);
    reopened.release();
    expect((await next).error).toBeNull();
  });

  function cli(args: string[]) {
    return new Promise<{ code: number | null; output: any }>((done, reject) => {
      const child = spawn(process.execPath, [resolve(__dirname, '../../../scripts/demo-control.cjs'), ...args], {
        env: { PATH: process.env.PATH, NODE_ENV: 'test', APP_ENV: 'test',
          DATABASE_URL: process.env.TICKRIFY_DEMO_TEST_URL, DIRECT_URL: process.env.TICKRIFY_DEMO_TEST_URL },
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk.toString(); });
      child.stderr.resume();
      child.once('error', reject);
      child.once('close', code => done({ code, output: output ? JSON.parse(output) : null }));
    });
  }

  it('the CLI releases only a pending reservation, only while paused, and never a result', async () => {
    const pending = await seed('stuck-device', undefined, null);
    const completed = await seed('done-device');
    expect((await cli(['release', '--id', pending, '--confirm-execution-stopped'])).code).toBe(1);
    expect((await cli(['release', '--id', pending])).code).toBe(1);
    expect((await cli(['pause'])).output).toMatchObject({ paused: true, pending: [{ id: pending }] });
    expect((await cli(['open'])).code).toBe(1);
    const results = await Promise.all([1, 2].map(() => cli(['release', '--id', pending, '--confirm-execution-stopped'])));
    expect(results.map(r => r.output.released).sort()).toEqual([false, true]);
    expect((await cli(['release', '--id', completed, '--confirm-execution-stopped'])).output.released).toBe(false);
    expect(await count()).toBe(1);
    expect((await cli(['open'])).output).toMatchObject({ paused: false, pending: [] });
  });
});
