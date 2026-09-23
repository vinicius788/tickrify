import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { APIError, apiClient, fetchWithAuthRetry, useAPIClient } from '@/lib/api';

const mockGetToken = vi.fn();
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('apiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createAnalysis envia request e retorna payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'analysis-1',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const result = await apiClient.createAnalysis(
      {
        base64Image: 'data:image/png;base64,AAAA',
      },
      'valid-token',
    );

    expect(result.id).toBe('analysis-1');
    expect(result.status).toBe('pending');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai/analyze'),
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('getAnalysis lança APIError quando backend retorna erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            message: 'Unauthorized',
            code: 'unauthorized',
          },
          401,
        ),
      ),
    );

    await expect(apiClient.getAnalysis('analysis-1', 'bad-token')).rejects.toBeInstanceOf(APIError);
  });

  it('fetchWithAuthRetry renova token e repete a chamada uma vez após 401', async () => {
    const getToken = vi
      .fn()
      .mockResolvedValueOnce('expired-token')
      .mockResolvedValueOnce('fresh-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithAuthRetry(
      'https://api.tickrify.test/api/ai/analyze',
      {
        method: 'POST',
        headers: {
          'X-Test': '1',
        },
      },
      getToken,
    );

    expect(response.ok).toBe(true);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Headers;
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Headers;

    expect(firstHeaders.get('Authorization')).toBe('Bearer expired-token');
    expect(secondHeaders.get('Authorization')).toBe('Bearer fresh-token');
  });

  it('getAnalysisUsage retorna uso da conta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          plan: 'free',
          period: 'monthly',
          periodStart: '2026-03-01T00:00:00.000Z',
          total: 3,
          used: 1,
          remaining: 2,
          isUnlimited: false,
          canAnalyze: true,
        }),
      ),
    );

    const usage = await apiClient.getAnalysisUsage('valid-token');

    expect(usage.plan).toBe('free');
    expect(usage.used).toBe(1);
    expect(usage.remaining).toBe(2);
  });

  // Caso real de 22/09/2026: falha de rede no navegador chegava ao painel como
  // TypeError cru e virava `analysis_failed { code: "unknown" }`.
  it('TypeError do fetch vira APIError network_error, com o erro original em cause', async () => {
    const original = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(original));

    const error = await apiClient
      .createAnalysis({ base64Image: 'data:image/png;base64,AAAA' }, 'valid-token')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).code).toBe('network_error');
    expect((error as APIError).status).toBe(0);
    expect((error as APIError).cause).toBe(original);
  });

  it('AbortError do fetch vira APIError timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError')),
    );

    const error = await apiClient.getAnalysis('analysis-1', 'valid-token').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).code).toBe('timeout');
  });

  it('erro que nao e de transporte segue intacto', async () => {
    const original = new RangeError('outra coisa');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(original));

    await expect(apiClient.getAnalysis('analysis-1', 'valid-token')).rejects.toBe(original);
  });

  it('falha ao obter o token do Clerk vira APIError auth_token_failed, sem chamar a API', async () => {
    const original = new Error('ClerkJS: session not loaded');
    mockGetToken.mockRejectedValueOnce(original);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAPIClient());
    const error = await result.current
      .createAnalysis({ base64Image: 'data:image/png;base64,AAAA' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).code).toBe('auth_token_failed');
    expect((error as APIError).cause).toBe(original);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
