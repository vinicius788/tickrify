import { registrarMigalha } from './breadcrumbs';
// API Client for Tickrify Backend
import { useAuth } from '@clerk/clerk-react';
import { useCallback, useMemo } from 'react';
import type { TechnicalAttributionPayload } from './attribution';

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

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

// O backend roda no Render (plano free) e hiberna após ~15 min ocioso. O 1º
// request depois disso leva 15–50s (cold start) e pode estourar o timeout do
// checkout — foi o "clico no plano, demora e dá erro" relatado. Chamar isto
// quando a página de planos carrega acorda a API em background: quando o
// usuário clica em "Get Pro" segundos depois, ela já está de pé.
// Fire-and-forget e idempotente por sessão (não repete o ping).
let warmupStarted = false;
export function warmupPaymentsApi(): void {
  if (warmupStarted || typeof window === 'undefined') return;
  warmupStarted = true;
  try {
    void fetch(buildApiUrl('/api/health/live'), {
      method: 'GET',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {
      /* cold start pode falhar no 1º toque; o importante é ter iniciado o boot */
    });
  } catch {
    /* noop */
  }
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
  /**
   * Erro original, quando este APIError so classifica uma falha que nasceu
   * fora da API (rede, abort, token do Clerk). A telemetria le daqui o nome e
   * a mensagem reais ("Failed to fetch", "Load failed"...), que a mensagem
   * deste objeto esconderia.
   */
  cause?: unknown;

  constructor(message: string, status: number, code?: string, cause?: unknown) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Converte a falha de transporte do `fetch` em APIError com codigo.
 * TypeError = a requisicao nao chegou a ter resposta (rede, CORS, DNS);
 * AbortError = o AbortController cortou. Qualquer outro erro volta intacto.
 */
function classifyTransportError(error: unknown, path: string): unknown {
  // Pelo nome, nao por `instanceof Error`: DOMException nem sempre herda de
  // Error (jsdom e navegadores mais antigos), e o abort chegaria cru.
  if ((error as { name?: unknown } | null)?.name === 'AbortError') {
    return new APIError(
      `Timeout ao conectar no backend (${API_BASE_URL}) em ${path}. Verifique se a API está online e tente novamente.`,
      0,
      'timeout',
      error,
    );
  }
  if (error instanceof TypeError) {
    return new APIError(
      `Não foi possível conectar ao backend (${API_BASE_URL}). Verifique VITE_API_URL, CORS e status da API.`,
      0,
      'network_error',
      error,
    );
  }
  return error;
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
  // O backend devolve isto (ai.service.ts) desde a Onda 2.2, mas a interface
  // nunca foi atualizada: o tsc quebrava em DashboardPage.tsx:848 desde 29/07.
  outcome?: string | null;
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
      factorsPresent?: number;
      technicalAnalysis?: string;
      keyIndicators?: string;
      identifiedPatterns?: string;
      riskFactors?: string;
      executiveSummary?: string;
      invalidationLevel?: number | null;
      invalidationNote?: string | null;
      entryType?: 'market' | 'limit' | 'stop' | null;
      entryCondition?: string | null;
      partialExitStrategy?: string | null;
      alternativeScenario?: string | null;
      trendStrength?: 'strong' | 'moderate' | 'weak' | null;
      trendStrengthNote?: string | null;
      multiTimeframeAlignment?: string | null;
      marketStructure?: {
        bias?: Bias;
      };
    };
  };
  imageUrl?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnalysisPayload {
  imageFile?: File;
  base64Image?: string;
  promptOverride?: string;
  analysisType?: 'quick' | 'deep';
  userLanguage?: string;
  /** Gráficos de timeframe maior (top-down) — opcionais, base64. */
  htfBase64Images?: string[];
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
  /**
   * Contagem REAL de analises concluidas, de todos os tempos, vinda de um
   * count() no banco. Opcional porque um backend mais antigo nao devolve.
   * NAO confundir com `used`, que e o consumo do periodo.
   */
  analysesAllTime?: number;
  /**
   * Cota gratis (so plano free): 3 analises com sinal (BUY/SELL) ou 10 no total.
   * `total`/`used`/`remaining` acima falam dos SINAIS; o total de 10 vem aqui.
   * Opcionais porque um backend mais antigo nao devolve.
   */
  signalsUsed?: number;
  signalsLimit?: number;
  totalUsed?: number;
  totalLimit?: number;
}

/**
 * Espelha `StrategyProfile` do backend (`common/strategy/strategy-profile.ts`).
 * Os campos aqui são `string[]`/`string` propositalmente soltos (não os
 * literais exatos da whitelist): a validação de verdade mora no backend
 * (`sanitizeStrategyProfile`), que descarta em silêncio qualquer valor fora
 * da lista. Duplicar os literais aqui só criaria dois lugares para
 * divergirem sem nenhum ganho de segurança real.
 */
export interface StrategyProfileDto {
  timeframes: string[];
  sessions: string[];
  instruments: string[];
  setups: string[];
  direction: string;
  minRiskReward: number;
}

/** Recorte do que o painel consome de `GET /api/auth/me`. */
export interface UserProfile {
  id?: string;
  email?: string | null;
  acquisitionSource?: string | null;
}

class APIClient {
  private static readonly REQUEST_TIMEOUT_MS = 15000;
  private static readonly ANALYZE_TIMEOUT_MS = 150_000;
  // 5 min. ESTE NÚMERO ESTÁ ACOPLADO AO BACKEND — não mexa em um sem o outro.
  //
  // Era 180s, dimensionado para AI_ANALYZE_TIMEOUT_MS=55s (55 + 5 + 55 + 30 + 55).
  // Com modelo de raciocínio (GPT-5+) uma única tentativa passa de 55s, então o
  // backend sobe para ~120s — e aí 180s aqui deixaria de cobrir sequer duas
  // tentativas. O modo de falha é traiçoeiro: o worker CONCLUI a análise e grava
  // no histórico, mas a tela já desistiu e mostra erro. O usuário vê falha numa
  // análise que existe e que ele pagou.
  //
  // 300s cobre 2 tentativas de 120s com backoff. Três tentativas fariam o
  // usuário esperar 6,5 min, o que não é aceitável de qualquer forma.
  private static readonly POLL_TIMEOUT_MS = 300_000;
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

      // ⚠️ SEM `await` AQUI, DE PROPÓSITO — não "arrume" isto sem ler o parágrafo.
      //
      // Retornar a promise sem aguardar faz o `finally` limpar o timer
      // IMEDIATAMENTE, o que na prática deixa o AbortController inerte: o
      // timeout de 15s nunca dispara. Isso é um bug ADORMECIDO e conhecido
      // (anotado em 19/08/2026), mas acordá-lo agora quebraria produção: o
      // Render é plano free e HIBERNA, com cold start de 30–60s. Com o timeout
      // ativo, a primeira requisição depois da hibernação abortaria em 15s e o
      // usuário veria "Timeout ao conectar no backend" — justamente na primeira
      // impressão.
      //
      // Consertar de verdade exige, nesta ordem: subir REQUEST_TIMEOUT_MS acima
      // do cold start (ou assinar o plano pago do Render) e SÓ ENTÃO adicionar
      // o await. Enquanto isso, as migalhas são registradas por handlers
      // encadeados, que não alteram o fluxo de controle em nada.
      return fetchWithAuthRetry(
        buildApiUrl(path),
        {
          ...init,
          signal: controller.signal,
        },
        tokenProvider,
      )
        .then((resposta) => {
          // Migalha só em FALHA: registrar toda chamada bem-sucedida encheria o
          // anel de 30 posições com ruído e empurraria para fora justamente o
          // erro que interessa. Nada do corpo entra — só rota e status.
          if (!resposta.ok) {
            registrarMigalha('api', `${init.method ?? 'GET'} ${path} → ${resposta.status}`);
          }
          return resposta;
        })
        .catch((erro: unknown) => {
          registrarMigalha(
            'erro',
            `falha de rede em ${path}: ${erro instanceof Error ? erro.name : 'desconhecida'}`,
          );
          // Sem o `await` acima, o catch deste metodo nunca ve erro assincrono:
          // a classificacao tem de acontecer AQUI, senao TypeError de rede sobe
          // cru e o painel registra `analysis_failed { code: "unknown" }`.
          // Erro que nao e de transporte segue intacto.
          throw classifyTransportError(erro, path);
        });
    } catch (error) {
      const classified = classifyTransportError(error, path);
      throw classified instanceof APIError
        ? classified
        : new APIError(fallbackMessage, 0, undefined, error);
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

    if (payload.userLanguage) {
      formData.append('userLanguage', payload.userLanguage);
    }

    if (payload.htfBase64Images && payload.htfBase64Images.length > 0) {
      if (payload.htfBase64Images[0]) formData.append('htfBase64Image1', payload.htfBase64Images[0]);
      if (payload.htfBase64Images[1]) formData.append('htfBase64Image2', payload.htfBase64Images[1]);
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

  /**
   * Historico do usuario. `cursor` e o id da ULTIMA analise ja recebida; a
   * pagina seguinte comeca depois dela. Sem cursor, volta a primeira pagina.
   */
  async listAnalyses(
    token: string | null,
    limit = 20,
    getFreshToken?: FreshTokenGetter,
    cursor?: string | null,
  ): Promise<AIAnalysisResponse[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await this.request(
      `/api/ai/analyses?limit=${safeLimit}${cursorParam}`,
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

  /**
   * Chama GET /api/auth/me.
   *
   * ⚠️ MOTIVO DE EXISTIR (17/08/2026): este endpoint NUNCA era chamado pelo
   * frontend — busca por "auth/me" no `src/` inteiro devolvia ZERO resultados.
   * E ele e o unico gatilho de `backfillEmailAndWelcome` no backend. Resultado:
   * `User.email` ficava NULL para TODO mundo (20 de 20 contas conferidas em
   * producao) e o **e-mail de boas-vindas nunca foi enviado a ninguem** desde
   * que foi escrito, em julho. O backend estava certo; ninguem batia na porta.
   *
   * Best-effort: qualquer falha aqui e engolida por quem chama. Isto NAO pode
   * quebrar o carregamento do painel.
   */
  async syncUserProfile(
    token: string | null,
    getFreshToken?: FreshTokenGetter,
  ): Promise<UserProfile | null> {
    const response = await this.request(
      '/api/auth/me',
      {
        method: 'GET',
        headers: {
          ...this.getAuthHeader(token),
        },
      },
      'Failed to sync user profile',
      APIClient.REQUEST_TIMEOUT_MS,
      getFreshToken,
    );
    /* Passou a devolver o perfil para o painel saber se a pergunta de origem
     * ja foi respondida. Quem ignora o retorno (o useEffect do DashboardPage)
     * continua funcionando igual. */
    return (await response.json().catch(() => null)) as UserProfile | null;
  }

  /**
   * Origem declarada pela propria pessoa.
   *
   * Existe porque a atribuicao tecnica nao respondeu de onde vieram os tres
   * primeiros assinantes: o PostHog so ve quem aceita cookies, o
   * `$initial_utm_source` do projeto vem vazio, e UTM morre no primeiro
   * retorno direto. Uma pergunta de um clique nao tem nenhum desses furos.
   */
  async setAcquisitionSource(
    payload: { source: string; detail?: string },
    token: string | null,
    getFreshToken?: FreshTokenGetter,
  ): Promise<void> {
    await this.request(
      '/api/auth/acquisition-source',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(token),
        },
        body: JSON.stringify(payload),
      },
      'Failed to save acquisition source',
      APIClient.REQUEST_TIMEOUT_MS,
      getFreshToken,
    );
  }

  async setTechnicalAttribution(
    payload: TechnicalAttributionPayload,
    token: string | null,
    getFreshToken?: FreshTokenGetter,
  ): Promise<void> {
    await this.request(
      '/api/auth/technical-attribution',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(token),
        },
        body: JSON.stringify(payload),
      },
      'Failed to save technical attribution',
      APIClient.REQUEST_TIMEOUT_MS,
      getFreshToken,
    );
  }

  /** CompleteRegistration pela Conversions API (o backend confere conta nova e aceite). */
  async sendAdsSignup(
    payload: { adsConsent: boolean; fbp?: string; fbc?: string },
    token: string | null,
  ): Promise<void> {
    await this.request(
      '/api/auth/ads-signup',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(token),
        },
        body: JSON.stringify(payload),
      },
      'Failed to send signup signal',
      APIClient.REQUEST_TIMEOUT_MS,
    );
  }

  async setFavorite(
    analysisId: string,
    isFavorite: boolean,
    token: string | null,
    getFreshToken?: FreshTokenGetter,
  ): Promise<{ id: string; isFavorite: boolean }> {
    const response = await this.request(
      `/api/ai/analysis/${analysisId}/favorite`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(token),
        },
        body: JSON.stringify({ isFavorite }),
      },
      'Failed to set favorite',
      APIClient.REQUEST_TIMEOUT_MS,
      getFreshToken,
    );

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to set favorite');
    }

    return response.json();
  }

  async setOutcome(
    analysisId: string,
    payload: { outcome: string | null; pnlPercent?: number | null; pnlAmount?: number | null },
    token: string | null,
    getFreshToken?: FreshTokenGetter,
  ): Promise<{ id: string; outcome: string | null; pnlPercent: number | null; pnlAmount: number | null }> {
    const response = await this.request(
      `/api/ai/analysis/${analysisId}/outcome`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(token),
        },
        body: JSON.stringify(payload),
      },
      'Failed to set outcome',
      APIClient.REQUEST_TIMEOUT_MS,
      getFreshToken,
    );

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to set outcome');
    }

    return response.json();
  }

  async getStrategy(
    token: string | null,
    getFreshToken?: FreshTokenGetter,
  ): Promise<{ profile: StrategyProfileDto | null; paid: boolean }> {
    const response = await this.request(
      '/api/ai/strategy',
      {
        method: 'GET',
        headers: {
          ...this.getAuthHeader(token),
        },
      },
      'Failed to fetch strategy profile',
      APIClient.REQUEST_TIMEOUT_MS,
      getFreshToken,
    );

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to fetch strategy profile');
    }

    return response.json();
  }

  async saveStrategy(
    profile: StrategyProfileDto,
    token: string | null,
    getFreshToken?: FreshTokenGetter,
  ): Promise<{ profile: StrategyProfileDto | null }> {
    const response = await this.request(
      '/api/ai/strategy',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(token),
        },
        body: JSON.stringify(profile),
      },
      'Failed to save strategy profile',
      APIClient.REQUEST_TIMEOUT_MS,
      getFreshToken,
    );

    if (!response.ok) {
      throw await this.buildApiError(response, 'Failed to save strategy profile');
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

  // Token inicial de cada chamada. Se o Clerk lancar aqui, a requisicao nem sai
  // do navegador; sem esta conversao a falha chegava ao painel como "unknown".
  const getInitialToken = useCallback(async () => {
    try {
      return await getFreshToken();
    } catch (error) {
      throw new APIError('Could not get the session token', 0, 'auth_token_failed', error);
    }
  }, [getFreshToken]);

  const createAnalysis = useCallback(async (payload: CreateAnalysisPayload) => {
    const token = await getInitialToken();
    return apiClient.createAnalysis(payload, token, getFreshToken);
  }, [getFreshToken, getInitialToken]);

  const getAnalysis = useCallback(async (analysisId: string) => {
    const token = await getInitialToken();
    return apiClient.getAnalysis(analysisId, token, getFreshToken);
  }, [getFreshToken, getInitialToken]);

  const listAnalyses = useCallback(async (limit?: number, cursor?: string | null) => {
    const token = await getInitialToken();
    return apiClient.listAnalyses(token, limit, getFreshToken, cursor);
  }, [getFreshToken, getInitialToken]);

  const getAnalysisUsage = useCallback(async () => {
    const token = await getInitialToken();
    return apiClient.getAnalysisUsage(token, getFreshToken);
  }, [getFreshToken, getInitialToken]);

  const syncUserProfile = useCallback(async () => {
    const token = await getInitialToken();
    return apiClient.syncUserProfile(token, getFreshToken);
  }, [getFreshToken, getInitialToken]);

  const setAcquisitionSource = useCallback(async (payload: { source: string; detail?: string }) => {
    const token = await getInitialToken();
    return apiClient.setAcquisitionSource(payload, token, getFreshToken);
  }, [getFreshToken, getInitialToken]);

  const setTechnicalAttribution = useCallback(async (payload: TechnicalAttributionPayload) => {
    const token = await getInitialToken();
    return apiClient.setTechnicalAttribution(payload, token, getFreshToken);
  }, [getFreshToken, getInitialToken]);

  const setOutcome = useCallback(async (
    analysisId: string,
    payload: { outcome: string | null; pnlPercent?: number | null; pnlAmount?: number | null },
  ) => {
    const token = await getInitialToken();
    return apiClient.setOutcome(analysisId, payload, token, getFreshToken);
  }, [getFreshToken, getInitialToken]);

  const setFavorite = useCallback(async (analysisId: string, isFavorite: boolean) => {
    const token = await getInitialToken();
    return apiClient.setFavorite(analysisId, isFavorite, token, getFreshToken);
  }, [getFreshToken, getInitialToken]);

  const getStrategy = useCallback(async () => {
    const token = await getInitialToken();
    return apiClient.getStrategy(token, getFreshToken);
  }, [getFreshToken, getInitialToken]);

  const saveStrategy = useCallback(async (profile: StrategyProfileDto) => {
    const token = await getInitialToken();
    return apiClient.saveStrategy(profile, token, getFreshToken);
  }, [getFreshToken, getInitialToken]);

  const waitForAnalysisCompletion = useCallback(
    async (analysisId: string, initialAnalysis?: AIAnalysisResponse) => {
      const token = await getInitialToken();
      return apiClient.waitForAnalysisCompletion(
        analysisId,
        token,
        initialAnalysis,
        getFreshToken,
      );
    },
    [getFreshToken, getInitialToken],
  );

  return useMemo(() => ({
    createAnalysis,
    getAnalysis,
    listAnalyses,
    getAnalysisUsage,
    syncUserProfile,
    setAcquisitionSource,
    setTechnicalAttribution,
    setOutcome,
    setFavorite,
    getStrategy,
    saveStrategy,
    waitForAnalysisCompletion,
  }), [createAnalysis, getAnalysis, listAnalyses, getAnalysisUsage, syncUserProfile, setAcquisitionSource, setTechnicalAttribution, setOutcome, setFavorite, getStrategy, saveStrategy, waitForAnalysisCompletion]);
}
