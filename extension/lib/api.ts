// Mesmos tetos do site (apps/frontend/src/lib/api.ts), acoplados ao
// AI_ANALYZE_TIMEOUT_MS do backend. Nunca mudar um sem os outros (CLAUDE.md 3.2).
export const ANALYZE_TIMEOUT_MS = 150_000;
export const POLL_TIMEOUT_MS = 300_000;
const POLL_BASE_DELAY_MS = 1_500;
const POLL_DELAY_INCREMENT_MS = 500;
const POLL_MAX_DELAY_MS = 4_000;

export type ApiErrorKind = 'auth' | 'quota' | 'timeout' | 'network' | 'server';

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Usage = {
  plan: string;
  remaining?: number;
  total?: number | null;
  tickBalance?: number;
  canAnalyze: boolean;
  freeLocked?: boolean;
};

export type AnalysisLevels = {
  entry?: number | string | null;
  stopLoss?: number | string | null;
  takeProfit1?: number | string | null;
  takeProfit2?: number | string | null;
  entryType?: string | null;
  riskRewardTp1?: number | null;
  riskRewardTp2?: number | null;
  /** Preco no topo e na base da area do grafico, lidos do eixo (quando o motor manda). */
  priceAxis?: { top: number | null; bottom: number | null } | null;
  symbol?: string | null;
  timeframe?: string | null;
  executiveSummary?: string | null;
  riskFactorsList?: string[] | null;
  invalidationNote?: string | null;
  entryCondition?: string | null;
  alternativeScenario?: string | null;
};

export type Analysis = {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  recommendation?: string;
  errorCode?: string | null;
  fullResponse?: { recommendation?: string; analysis?: AnalysisLevels } | null;
};

export type AnalyzeContext = {
  platform: 'tradingview' | 'other';
  chartSymbol?: string;
  chartTimeframe?: string;
};

const QUOTA_CODES = ['free_quota_exhausted', 'DEMO_LIMIT_REACHED', 'INSUFFICIENT_TICKS'];

/** O backend manda o codigo em lugares diferentes conforme a rota; procura em todos. */
function errorFrom(status: number, body: unknown): ApiError {
  const text = JSON.stringify(body ?? '');
  if (status === 401) return new ApiError('auth', 'Sign in again', status);
  if (status === 402 || QUOTA_CODES.some((code) => text.includes(code))) {
    return new ApiError('quota', 'No analyses left', status);
  }
  return new ApiError('server', `Request failed (${status})`, status);
}

export function createApi(opts: { baseUrl: string; getToken: () => Promise<string | null> }) {
  async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
    const token = await opts.getToken();
    if (!token) throw new ApiError('auth', 'Not signed in');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw new ApiError('timeout', 'Request timed out');
      throw new ApiError('network', 'Network error');
    } finally {
      clearTimeout(timer);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw errorFrom(res.status, body);
    return body as T;
  }

  return {
    usage: () => request<Usage>('/api/ai/usage'),

    analyze(image: Blob, ctx: AnalyzeContext) {
      const form = new FormData();
      form.append('image', image, 'chart.jpg');
      form.append('analysisType', 'quick');
      // O painel e em ingles, entao o texto da IA tambem (senao a tela mistura idiomas).
      form.append('userLanguage', 'en');
      form.append('source', 'extension');
      form.append('platform', ctx.platform);
      if (ctx.chartSymbol) form.append('chartSymbol', ctx.chartSymbol);
      if (ctx.chartTimeframe) form.append('chartTimeframe', ctx.chartTimeframe);
      return request<Analysis>('/api/ai/analyze', { method: 'POST', body: form }, ANALYZE_TIMEOUT_MS);
    },

    getAnalysis: (id: string) => request<Analysis>(`/api/ai/analysis/${encodeURIComponent(id)}`),

    /** Escala do eixo para as linhas (uma leitura por analise, guardada no servidor). */
    priceAxis: (id: string) =>
      request<{ top: number | null; bottom: number | null }>(`/api/ai/analysis/${encodeURIComponent(id)}/price-axis`, {}, 45_000),

    async waitForAnalysis(id: string): Promise<Analysis> {
      const startedAt = Date.now();
      let attempts = 0;
      let analysis = await this.getAnalysis(id);
      while (analysis.status === 'pending' || analysis.status === 'processing') {
        attempts += 1;
        if (Date.now() - startedAt >= POLL_TIMEOUT_MS) throw new ApiError('timeout', 'The analysis took too long');
        const delay = Math.min(POLL_BASE_DELAY_MS + POLL_DELAY_INCREMENT_MS * attempts, POLL_MAX_DELAY_MS);
        await new Promise((resolve) => setTimeout(resolve, delay));
        analysis = await this.getAnalysis(id);
      }
      return analysis;
    },
  };
}

export type TickrifyApi = ReturnType<typeof createApi>;
