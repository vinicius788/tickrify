// API Client for Tickrify Backend
import { useAuth } from '@clerk/clerk-react';

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

export type Recommendation = 'BUY' | 'SELL' | 'WAIT';
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
  timeframe?: string | null;
  reasoning?: string;
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
    drawing_plan?: {
      elements: Array<Record<string, unknown>>;
    } | null;
    original_image_url?: string | null;
    annotated_image_url?: string | null;
    drawing_failed?: boolean;
    analysis?: {
      symbol?: string;
      timeframe?: string;
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
}

class APIClient {
  private getAuthHeader(token: string | null): HeadersInit {
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  private async buildApiError(response: Response, fallbackMessage: string): Promise<APIError> {
    const error = await response.json().catch(() => ({}));
    const message = error.message || fallbackMessage;
    const code = error.code || error.error || undefined;
    return new APIError(message, response.status, code);
  }

  async createAnalysis(
    payload: CreateAnalysisPayload,
    token: string | null,
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

    const response = await fetch(buildApiUrl('/api/analyze-chart'), {
      method: 'POST',
      headers: {
        ...this.getAuthHeader(token),
      },
      body: formData,
    });

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to create analysis');
    }

    return response.json();
  }

  async getAnalysis(
    analysisId: string,
    token: string | null,
  ): Promise<AIAnalysisResponse> {
    const response = await fetch(buildApiUrl(`/api/analyses/${analysisId}`), {
      method: 'GET',
      headers: {
        ...this.getAuthHeader(token),
      },
    });

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to get analysis');
    }

    return response.json();
  }

  async listAnalyses(
    token: string | null,
    limit = 20,
  ): Promise<AIAnalysisResponse[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
    const response = await fetch(buildApiUrl(`/api/ai/analyses?limit=${safeLimit}`), {
      method: 'GET',
      headers: {
        ...this.getAuthHeader(token),
      },
    });

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to list analyses');
    }

    return response.json();
  }
}

export const apiClient = new APIClient();

// React Hook for API calls with auth
export function useAPIClient() {
  const { getToken } = useAuth();

  return {
    createAnalysis: async (payload: CreateAnalysisPayload) => {
      const token = await getToken();
      return apiClient.createAnalysis(payload, token);
    },
    getAnalysis: async (analysisId: string) => {
      const token = await getToken();
      return apiClient.getAnalysis(analysisId, token);
    },
    listAnalyses: async (limit?: number) => {
      const token = await getToken();
      return apiClient.listAnalyses(token, limit);
    },
  };
}
