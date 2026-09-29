import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DemoService, EXAMPLE_ANALYSIS_AUDIT_ACTION, EXAMPLE_CHART_SHA256 } from './demo.service';

describe('Demo security gates', () => {
  const originalEnv = { ...process.env };
  let service: DemoService;
  let prisma: any;
  let ai: any;
  let fetchMock: jest.SpyInstance;
  const params = {
    base64Image: 'data:image/png;base64,iVBORw0KGgo=',
    fingerprint: 'audit-fingerprint',
    turnstileToken: 'test-only-token',
    ip: '192.0.2.10',
  };

  beforeEach(async () => {
    process.env = {
      NODE_ENV: 'production', APP_ENV: 'production',
      TURNSTILE_SECRET_KEY: 'test-only-secret', DEMO_HASH_SALT: 'test-only-salt',
    };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ success: true }),
    } as Response);
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0n }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      promptConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    ai = { analyzeImage: jest.fn().mockResolvedValue({ recommendation: 'HOLD', confidence: 50, analysis: {} }) };
    service = new DemoService(prisma, ai, { buildPromptByVersion: jest.fn().mockResolvedValue('test prompt') } as any);
    await service.onModuleInit();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function expectBlocked(status: number, input = params) {
    await expect(service.analyze(input)).rejects.toMatchObject({ status });
    expect(ai.analyzeImage).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  }

  it('missing verifier secret disables the demo before any cost', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    await expectBlocked(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing client token is rejected', async () => {
    await expectBlocked(403, { ...params, turnstileToken: '' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, undefined, 'true'])('requires boolean success=true, received %s', async (success) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success }) });
    await expectBlocked(403);
  });

  it('HTTP error is rejected even if the body claims success', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ success: true }) });
    await expectBlocked(503);
  });

  it('network outage does not authorize paid processing and clears the timer', async () => {
    jest.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('simulated network failure'));
    await expectBlocked(503);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('malformed provider JSON fails closed', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } });
    await expectBlocked(503);
  });

  it('provider timeout aborts the request and blocks the analysis', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const blocked = expectBlocked(503);
    await jest.advanceTimersByTimeAsync(8_000);
    await blocked;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('missing hash secrets never falls back to a public constant', async () => {
    delete process.env.DEMO_HASH_SALT;
    await expectBlocked(503);
  });

  it('valid challenge reaches AI and records usage only on completion', async () => {
    await expect(service.analyze(params)).resolves.toMatchObject({ status: 'completed' });
    expect(ai.analyzeImage).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(ai.analyzeImage.mock.invocationCallOrder[0]).toBeLessThan(prisma.$executeRaw.mock.invocationCallOrder[0]);
  });
});

describe('Example chart for signed-in users', () => {
  // O arquivo REAL que o frontend envia: se alguem trocar a imagem sem trocar
  // EXAMPLE_CHART_SHA256, este teste quebra antes do botao parar em producao.
  const examplePng = readFileSync(
    resolve(__dirname, '../../../../frontend/src/assets/demo-example-chart.png'),
  );
  const file = (buffer: Buffer) => ({ buffer, mimetype: 'image/png', size: buffer.length, originalname: 'chart.png' }) as any;
  let service: DemoService;
  let prisma: any;
  let ai: any;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    prisma = {
      adminAudit: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      promptConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    ai = { analyzeImage: jest.fn().mockResolvedValue({ recommendation: 'HOLD', confidence: 50, analysis: {} }) };
    service = new DemoService(prisma, ai, { buildPromptByVersion: jest.fn().mockResolvedValue('test prompt') } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('the bundled example chart matches the pinned hash', () => {
    expect(createHash('sha256').update(examplePng).digest('hex')).toBe(EXAMPLE_CHART_SHA256);
  });

  it('any other image is refused before any AI cost', async () => {
    const other = Buffer.concat([examplePng, Buffer.from([0])]);
    await expect(service.analyzeExampleForUser({ userId: 'u1', file: file(other) })).rejects.toMatchObject({
      status: 400,
      response: { code: 'not_example_chart' },
    });
    expect(ai.analyzeImage).not.toHaveBeenCalled();
    expect(prisma.adminAudit.create).not.toHaveBeenCalled();
  });

  it('runs once per account', async () => {
    prisma.adminAudit.findFirst.mockResolvedValue({ id: 'audit-1' });
    await expect(service.analyzeExampleForUser({ userId: 'u1', file: file(examplePng) })).rejects.toMatchObject({
      status: 403,
      response: { code: 'example_used' },
    });
    expect(ai.analyzeImage).not.toHaveBeenCalled();
  });

  it('records the use only after the analysis completes', async () => {
    await expect(service.analyzeExampleForUser({ userId: 'u1', file: file(examplePng) })).resolves.toMatchObject({
      status: 'completed',
      recommendation: 'WAIT',
    });
    expect(prisma.adminAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: EXAMPLE_ANALYSIS_AUDIT_ACTION, targetUserId: 'u1' }),
    });
    expect(ai.analyzeImage.mock.invocationCallOrder[0]).toBeLessThan(prisma.adminAudit.create.mock.invocationCallOrder[0]);
  });

  it('a provider failure does not burn the one example', async () => {
    ai.analyzeImage.mockRejectedValue(new Error('provider down'));
    await expect(service.analyzeExampleForUser({ userId: 'u1', file: file(examplePng) })).rejects.toMatchObject({ status: 503 });
    expect(prisma.adminAudit.create).not.toHaveBeenCalled();
  });
});
