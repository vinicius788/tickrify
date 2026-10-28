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
      $queryRaw: jest.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
        const query = sql.join('?');
        if (query.includes('FeatureFlag')) return [{ value: '{"version":1,"paused":false}' }];
        if (query.includes('COUNT(*)')) return [{ count: 0n }];
        if (query.includes('INSERT INTO')) return [{ id: values[0] }];
        return [];
      }),
      $executeRaw: jest.fn().mockResolvedValue(1),
      promptConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prisma.$transaction = jest.fn(async (run: (tx: any) => Promise<unknown>) => run(prisma));
    ai = { analyzeImage: jest.fn().mockResolvedValue({ recommendation: 'HOLD', confidence: 50, analysis: {} }) };
    service = new DemoService(prisma, ai);
    await service.onModuleInit();
    prisma.$queryRaw.mockClear(); // Boot warning only; requests start from zero.
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

  it('valid challenge reserves before AI and confirms usage only on completion', async () => {
    await expect(service.analyze(params)).resolves.toMatchObject({ status: 'completed' });
    expect(ai.analyzeImage).toHaveBeenCalledTimes(1);
    const admission = prisma.$queryRaw.mock.calls.findIndex((call: any[]) => call[0].join('?').includes('INSERT INTO'));
    expect(prisma.$queryRaw.mock.invocationCallOrder[admission]).toBeLessThan(ai.analyzeImage.mock.invocationCallOrder[0]);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(ai.analyzeImage.mock.invocationCallOrder[0]).toBeLessThan(prisma.$executeRaw.mock.invocationCallOrder[0]);
  });

  it('guarda a leitura junto com o uso (ja sanitizada)', async () => {
    await service.analyze(params);
    const insert = prisma.$executeRaw.mock.calls[0];
    expect(insert[0].join('?')).toContain('UPDATE');
    expect(insert[0].join('?')).toContain('"result"');
    expect(JSON.parse(insert[1])).toMatchObject({ status: 'completed', recommendation: 'WAIT' });
  });

  it('conexao caiu e a pessoa tentou de novo: recebe a MESMA leitura, sem IA nova e sem gastar de novo', async () => {
    const guardada = { status: 'completed', recommendation: 'BUY', symbol: 'XAUUSD' };
    prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ id: 'u1', result: guardada, createdAt: new Date() }]);
    await expect(service.analyze(params)).resolves.toEqual({ ...guardada, recovered: true });
    expect(ai.analyzeImage).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('leitura com mais de 24h (ou uso antigo sem leitura) continua sendo limite', async () => {
    const velha = new Date(Date.now() - 25 * 60 * 60 * 1000);
    prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ id: 'u1', result: { status: 'completed' }, createdAt: velha }]);
    await expect(service.analyze(params)).rejects.toMatchObject({ status: 403 });
    prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ id: 'u1', result: null, createdAt: new Date() }]);
    await expect(service.analyze(params)).rejects.toMatchObject({ status: 403 });
    expect(ai.analyzeImage).not.toHaveBeenCalled();
  });

  it('a recuperacao nunca pula a verificacao anti-robo', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: false }) } as Response);
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ id: 'u1', result: { status: 'completed' }, createdAt: new Date() }]);
    await expect(service.analyze(params)).rejects.toMatchObject({ status: 403 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('status devolve a leitura das ultimas 24h deste device', async () => {
    prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ id: 'u1', result: { recommendation: 'SELL' }, createdAt: new Date() }]);
    await expect(service.getFingerprintStatus('fp')).resolves.toEqual({ used: true, result: { recommendation: 'SELL', recovered: true } });
    prisma.$queryRaw = jest.fn().mockResolvedValueOnce([]);
    await expect(service.getFingerprintStatus('fp')).resolves.toEqual({ used: false, result: null });
  });
});
