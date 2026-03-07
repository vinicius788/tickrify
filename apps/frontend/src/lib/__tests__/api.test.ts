import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError, apiClient } from '@/lib/api';

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
});
