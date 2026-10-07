import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../api';

// Objeto simples em vez de `Response`: ler o corpo de um Response de verdade no
// Node passa por I/O, e o relogio falso do teste de espera andaria antes da hora.
function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('createApi', () => {
  afterEach(() => vi.restoreAllMocks());

  it('manda o token do Clerk e os campos da extensao no analyze', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(201, { id: 'an_1', status: 'pending' }));
    const api = createApi({ baseUrl: 'https://api.test', getToken: async () => 'tok_1' });

    const created = await api.analyze(new Blob(['x'], { type: 'image/jpeg' }), {
      platform: 'tradingview',
      chartSymbol: 'FX:EURJPY',
      chartTimeframe: '5m',
    });

    expect(created).toEqual({ id: 'an_1', status: 'pending' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/ai/analyze');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok_1');
    const form = init?.body as FormData;
    expect(form.get('source')).toBe('extension');
    expect(form.get('analysisType')).toBe('quick');
    expect(form.get('platform')).toBe('tradingview');
    expect(form.get('chartSymbol')).toBe('FX:EURJPY');
    expect(form.get('chartTimeframe')).toBe('5m');
    expect(form.get('userLanguage')).toBe('en');
    expect(form.get('image')).toBeInstanceOf(Blob);
  });

  it('nao manda campo vazio (o backend recusaria string vazia no regex)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(201, { id: 'an_1', status: 'pending' }));
    const api = createApi({ baseUrl: 'https://api.test', getToken: async () => 'tok_1' });
    await api.analyze(new Blob(['x']), { platform: 'other' });
    const form = fetchMock.mock.calls[0]![1]?.body as FormData;
    expect(form.has('chartSymbol')).toBe(false);
    expect(form.has('chartTimeframe')).toBe(false);
  });

  it('cota esgotada vira erro do tipo quota (402, limite gratis e sem ticks)', async () => {
    const api = createApi({ baseUrl: 'https://api.test', getToken: async () => 'tok_1' });
    for (const res of [
      jsonResponse(402, { code: 'free_quota_exhausted', message: 'x' }),
      jsonResponse(403, { message: { code: 'DEMO_LIMIT_REACHED', message: 'x' } }),
      jsonResponse(400, { message: '{"code":"INSUFFICIENT_TICKS","message":"Ticks insuficientes"}' }),
    ]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(res);
      await expect(api.analyze(new Blob(['x']), { platform: 'other' })).rejects.toMatchObject({ kind: 'quota' });
    }
  });

  it('401 vira erro de login; sem token nem chama a API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(401, {}));
    const api = createApi({ baseUrl: 'https://api.test', getToken: async () => 'tok_1' });
    await expect(api.usage()).rejects.toMatchObject({ kind: 'auth' });

    const noToken = createApi({ baseUrl: 'https://api.test', getToken: async () => null });
    fetchMock.mockClear();
    await expect(noToken.usage()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pede a escala do eixo pela rota propria da analise', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { top: 189.37, bottom: 173.85 }));
    const api = createApi({ baseUrl: 'https://api.test', getToken: async () => 'tok_1' });
    await expect(api.priceAxis('an_1')).resolves.toEqual({ top: 189.37, bottom: 173.85 });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.test/api/ai/analysis/an_1/price-axis');
  });

  it('espera a analise ficar pronta e desiste no teto de tempo do site (300 s)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(200, { id: 'an_1', status: 'processing' }))
        .mockResolvedValueOnce(jsonResponse(200, { id: 'an_1', status: 'completed', recommendation: 'BUY' }));
      const api = createApi({ baseUrl: 'https://api.test', getToken: async () => 'tok_1' });
      const done = api.waitForAnalysis('an_1');
      await vi.runAllTimersAsync();
      await expect(done).resolves.toMatchObject({ status: 'completed' });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => jsonResponse(200, { id: 'an_2', status: 'processing' }));
      const stuck = api.waitForAnalysis('an_2');
      const assertion = expect(stuck).rejects.toMatchObject({ kind: 'timeout' });
      // A espera entre consultas chega a 4 s: o teto e notado na consulta seguinte.
      await vi.advanceTimersByTimeAsync(310_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
