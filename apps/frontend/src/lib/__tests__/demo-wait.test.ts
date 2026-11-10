import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDemoStatus, waitForDemoResult } from '@/lib/demo-api';

vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));

const fetchMock = vi.fn();
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
const done = { status: 'completed', recommendation: 'BUY' };
const sleep = vi.fn(async () => undefined);
const wait = () => waitForDemoResult('fp', { everyMs: 4_000, maxMs: 20_000, sleep });

describe('demo: conexao caiu no meio do envio', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sleep.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('servidor ainda analisando: espera e devolve a leitura quando ela aparece', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ used: false, pending: true, result: null }))
      .mockResolvedValueOnce(json({ used: false, pending: true, result: null }))
      .mockResolvedValueOnce(json({ used: true, pending: false, result: done }));
    expect(await wait()).toEqual({ result: done, arrived: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('servidor confirma duas vezes que nada roda: o envio nao chegou e pode repetir', async () => {
    fetchMock.mockResolvedValue(json({ used: false, pending: false, result: null }));
    expect(await wait()).toEqual({ result: null, arrived: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('servidor antigo (sem o campo) ou rede fora: nunca manda repetir, espera ate o fim', async () => {
    fetchMock.mockResolvedValueOnce(json({ used: false, result: null })).mockRejectedValue(new Error('rede'));
    expect(await wait()).toEqual({ result: null, arrived: true });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('uma resposta "rodando" no meio zera a contagem de ausencia', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ used: false, pending: false, result: null }))
      .mockResolvedValueOnce(json({ used: false, pending: true, result: null }))
      .mockResolvedValueOnce(json({ used: true, pending: false, result: done }));
    expect((await wait()).result).toEqual(done);
  });

  it('fetchDemoStatus normaliza o campo pending', async () => {
    fetchMock.mockResolvedValueOnce(json({ used: true, pending: false, result: done }));
    expect(await fetchDemoStatus('fp')).toEqual({ used: true, pending: false, result: done });
    fetchMock.mockResolvedValueOnce(json({}, false));
    expect(await fetchDemoStatus('fp')).toEqual({ used: false, pending: null, result: null });
  });
});
