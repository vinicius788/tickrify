import { Logger } from '@nestjs/common';
import { DemoService } from './demo.service';

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
