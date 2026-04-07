// API Client for Tickrify Backend
import { useAuth } from '@clerk/clerk-react';
import { useCallback, useMemo } from 'react';

const DEV_API_FALLBACK = 'http://localhost:3001';

function resolveApiBaseUrl(): string {
  const rawApiUrl = String(import.meta.env.VITE_API_URL || '').trim();

  if (rawApiUrl) {
    return rawApiUrl.replace(/\/+$/, '');
  }

  if (import.meta.env.PROD) {
    throw new Error('VITE_API_URL is required in production.');
  }

  return DEV_API_FALLBACK;
}

export const API_BASE_URL = resolveApiBaseUrl();

function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

type FreshTokenGetter = () => Promise<string | null>;

async function resolveAuthHeaders(
  headersInit: HeadersInit | undefined,
  refreshToken?: FreshTokenGetter,
): Promise<Headers> {
  const headers = new Headers(headersInit || {});

  if (!refreshToken) {
    return headers;
  }

  try {
    const token = await refreshToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  } catch {
    // Mantém os headers originais se a renovação do token falhar.
  }

  return headers;
}

export async function fetchWithAuthRetry(
  url: string,
  options: RequestInit,
  refreshToken?: FreshTokenGetter,
): Promise<Response> {
  const runRequest = async () => {
    const headers = await resolveAuthHeaders(options.headers, refreshToken);
    return fetch(url, {
      ...options,
      headers,
    });
  };

  const response = await runRequest();

  if (response.status !== 401 || !refreshToken) {
    return response;
  }

  console.warn('[Auth] Token expired, refreshing...');
  return runRequest();
}

export type Recommendation =
  | 'BUY'
  | 'SELL'
  | 'WAIT'
  | 'HOLD'
  | 'COMPRA'
  | 'VENDA'
  | 'AGUARDAR';
export type Bias = 'bullish' | 'bearish' | 'neutral';

export class APIError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.code = code;
  }
}

export interface AIAnalysisResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  recommendation?: Recommendation;
  bias?: Bias;
  confidence?: number;
  symbol?: string | null;
  ticker?: string | null;
  asset?: string | null;
  timeframe?: string | null;
  period?: string | null;
  reasoning?: string;
  errorMessage?: string | null;
  errorCode?: string | null;
  drawing_plan?: {
    elements: Array<Record<string, unknown>>;
  } | null;
  original_image_url?: string | null;
  annotated_image_url?: string | null;
  drawing_failed?: boolean;
  fullResponse?: {
    recommendation: Recommendation;
    bias: Bias;
    confidence: number;
    reasoning: string;
    symbol?: string;
    ticker?: string;
    asset?: string;
    timeframe?: string;
    period?: string;
    drawing_plan?: {
      elements: Array<Record<string, unknown>>;
    } | null;
    original_image_url?: string | null;
    annotated_image_url?: string | null;
    drawing_failed?: boolean;
    analysis?: {
      symbol?: string;
      ticker?: string;
      asset?: string;
      timeframe?: string;
      period?: string;
      currentPrice?: number;
      entry?: number;
      stopLoss?: number;
      stopLossPercent?: number;
      takeProfit1?: number;
      takeProfit1Percent?: number;
      takeProfit2?: number;
      takeProfit2Percent?: number;
      riskRewardRatio?: string;
      confluenceScore?: number;
      technicalAnalysis?: string;
      keyIndicators?: string;
      identifiedPatterns?: string;
      riskFactors?: string;
      executiveSummary?: string;
      marketStructure?: {
        bias?: Bias;
      };
    };
  };
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnalysisPayload {
  imageFile?: File;
  base64Image?: string;
  promptOverride?: string;
  analysisType?: 'quick' | 'deep';
}

export interface AnalysisUsageResponse {
  plan: 'free' | 'pro';
  period: 'monthly';
  periodStart: string;
  total: number | null;
  used: number;
  remaining: number | null;
  isUnlimited: boolean;
  canAnalyze: boolean;
  tickBalance?: number;
}

class APIClient {
  private static readonly REQUEST_TIMEOUT_MS = 15000;
  private static readonly ANALYZE_TIMEOUT_MS = 120000;
  private static readonly POLL_TIMEOUT_MS = 120000;
  private static readonly POLL_MAX_ATTEMPTS = 90;
  // Polling rápido: começa em 800ms, cresce 200ms por tentativa, cap de 3s
  // Antes: 2000ms * attempts (chegava a 10s entre polls — responsável por até 30s de lag)
  // Agora: análise concluída em 15s é detectada em ~15s (não em 22-30s)
  private static readonly POLL_BASE_DELAY_MS = 800;
  private static readonly POLL_DELAY_INCREMENT_MS = 200;
  private static readonly POLL_MAX_DELAY_MS = 3000;

  private getAuthHeader(token: string | null): HeadersInit {
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  private async getRuntimeFreshToken(): Promise<string | null> {
    try {
      if (typeof window === 'undefined') {
        return null;
      }

      const clerk = (
        window as {
          Clerk?: {
            session?: {
              getToken?: (options?: { skipCache?: boolean }) => Promise<string | null>;
            };
          };
        }
      ).Clerk;

      return clerk?.session?.getToken?.({ skipCache: true }) ?? null;
    } catch {
      return null;
    }
  }

  private async request(
    path: string,
    init: RequestInit,
    fallbackMessage: string,
    timeoutMs = APIClient.REQUEST_TIMEOUT_MS,
    getFreshToken?: FreshTokenGetter,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const tokenProvider = getFreshToken ?? (() => this.getRuntimeFreshToken());

      return fetchWithAuthRetry(
        buildApiUrl(path),
        {
          ...init,
          signal: controller.signal,
        },
        tokenProvider,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new APIError(
          `Timeout ao conectar no backend (${API_BASE_URL}) em ${path}. Verifique se a API está online e tente novamente.`,
          0,
          'timeout',
        );
      }
      if (error instanceof TypeError) {
        throw new APIError(
          `Não foi possível conectar ao backend (${API_BASE_URL}). Verifique VITE_API_URL, CORS e status da API.`,
          0,
          'network_error',
        );
      }
      throw new APIError(fallbackMessage, 0);
    } finally {
      clearTimeout(timer);
    }
  }

  private async buildApiError(response: Response, fallbackMessage: string): Promise<APIError> {
    const error = await response.json().catch(() => ({}));
    const rawMessage = error.message || fallbackMessage;
    const message =
      typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
    const code = error.code || error.error || undefined;
    return new APIError(message, response.status, code);
  }

  async createAnalysis(
    payload: CreateAnalysisPayload,
    token: string | null,
    getFreshToken?: FreshTokenGetter,
  ): Promise<AIAnalysisResponse> {
    const formData = new FormData();

    if (payload.imageFile) {
      formData.append('image', payload.imageFile);
    }

    if (payload.base64Image) {
      formData.append('base64Image', payload.base64Image);
    }

    if (payload.promptOverride) {
      formData.append('promptOverride', payload.promptOverride);
    }

    if (payload.analysisType) {
      formData.append('analysisType', payload.analysisType);
    }

    const response = await this.request(
      '/api/ai/analyze',
      {
        method: 'POST',
        headers: {
          ...this.getAuthHeader(token),
        },
        body: formData,
      },
      'Failed to create analysis',
      APIClient.ANALYZE_TIMEOUT_MS,
      getFreshToken,
    );

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to create analysis');
    }

    return response.json();
  }

  async getAnalysis(
    analysisId: string,
    token: string | null,
    getFreshToken?: FreshTokenGetter,
  ): Promise<AIAnalysisResponse> {
    const response = await this.request(
      `/api/ai/analysis/${analysisId}`,
      {
        method: 'GET',
        headers: {
          ...this.getAuthHeader(token),
        },
      },
      'Failed to get analysis',
      APIClient.REQUEST_TIMEOUT_MS,
      getFreshToken,
    );

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to get analysis');
    }

    return response.json();
  }

  async listAnalyses(
    token: string | null,
    limit = 20,
    getFreshToken?: FreshTokenGetter,
  ): Promise<AIAnalysisResponse[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
    const response = await this.request(
      `/api/ai/analyses?limit=${safeLimit}`,
      {
        method: 'GET',
        headers: {
          ...this.getAuthHeader(token),
        },
      },
      'Failed to list analyses',
      APIClient.REQUEST_TIMEOUT_MS,
      getFreshToken,
    );

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to list analyses');
    }

    return response.json();
  }

  async getAnalysisUsage(
    token: string | null,
    getFreshToken?: FreshTokenGetter,
  ): Promise<AnalysisUsageResponse> {
    const response = await this.request(
      '/api/ai/usage',
      {
        method: 'GET',
        headers: {
          ...this.getAuthHeader(token),
        },
      },
      'Failed to fetch analysis usage',
      APIClient.REQUEST_TIMEOUT_MS,
      getFreshToken,
    );

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to fetch analysis usage');
    }

    return response.json();
  }

  async waitForAnalysisCompletion(
    analysisId: string,
    token: string | null,
    initialAnalysis?: AIAnalysisResponse,
    getFreshToken?: FreshTokenGetter,
  ): Promise<AIAnalysisResponse> {
    let analysis =
      initialAnalysis ?? (await this.getAnalysis(analysisId, token, getFreshToken));
    const startedAt = Date.now();
    let attempts = 0;

    while (analysis.status === 'pending' || analysis.status === 'processing') {
      attempts += 1;
      const elapsedMs = Date.now() - startedAt;

      if (attempts > APIClient.POLL_MAX_ATTEMPTS || elapsedMs >= APIClient.POLL_TIMEOUT_MS) {
        throw new APIError(
          'A análise demorou mais que o esperado. Tente novamente em instantes.',
          408,
          'analysis_timeout',
        );
      }

      const delayMs = Math.min(
        APIClient.POLL_BASE_DELAY_MS + APIClient.POLL_DELAY_INCREMENT_MS * attempts,
        APIClient.POLL_MAX_DELAY_MS,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      analysis = await this.getAnalysis(analysisId, token, getFreshToken);
    }

    return analysis;
  }
}

export const apiClient = new APIClient();

// React Hook for API calls with auth
export function useAPIClient() {
  const { getToken } = useAuth();
  const getFreshToken = useCallback(() => getToken({ skipCache: true }), [getToken]);

  const createAnalysis = useCallback(async (payload: CreateAnalysisPayload) => {
    const token = await getFreshToken();
    return apiClient.createAnalysis(payload, token, getFreshToken);
  }, [getFreshToken]);

  const getAnalysis = useCallback(async (analysisId: string) => {
    const token = await getFreshToken();
    return apiClient.getAnalysis(analysisId, token, getFreshToken);
  }, [getFreshToken]);

  const listAnalyses = useCallback(async (limit?: number) => {
    const token = await getFreshToken();
    return apiClient.listAnalyses(token, limit, getFreshToken);
  }, [getFreshToken]);

  const getAnalysisUsage = useCallback(async () => {
    const token = await getFreshToken();
    return apiClient.getAnalysisUsage(token, getFreshToken);
  }, [getFreshToken]);

  const waitForAnalysisCompletion = useCallback(
    async (analysisId: string, initialAnalysis?: AIAnalysisResponse) => {
      const token = await getFreshToken();
      return apiClient.waitForAnalysisCompletion(
        analysisId,
        token,
        initialAnalysis,
        getFreshToken,
      );
    },
    [getFreshToken],
  );

  return useMemo(() => ({
    createAnalysis,
    getAnalysis,
    listAnalyses,
    getAnalysisUsage,
    waitForAnalysisCompletion,
  }), [createAnalysis, getAnalysis, listAnalyses, getAnalysisUsage, waitForAnalysisCompletion]);
}
