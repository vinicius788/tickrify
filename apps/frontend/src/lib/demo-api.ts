// Cliente da demo anônima (/api/demo/*) — endpoints públicos, sem auth.
// Mantido fora do api.ts para não misturar com o cliente autenticado.
import { buildApiUrl } from './api';

/** Marca no aparelho que a conta ja rodou o exemplo (TryPage grava, DashboardPage le). */
export const EXAMPLE_USED_KEY = 'tickrify_example_used';

export interface DemoAnalysisResult {
  status: 'completed';
  recommendation: 'BUY' | 'SELL' | 'WAIT';
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  symbol: string;
  timeframe: string;
  currentPrice: number | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward: string | null;
  reasoning: string;
  disclaimer: string;
  demoRemaining: number;
}

export type DemoErrorCode =
  | 'demo_limit_reached'
  | 'bot_check_failed'
  | 'non_chart_image'
  | 'invalid_image'
  | 'analysis_failed'
  | 'demo_unavailable'
  | 'rate_limited'
  | 'network_error'
  // So na rota do exemplo para quem tem conta (/api/demo/example):
  | 'not_example_chart'
  | 'example_used';

export class DemoApiError extends Error {
  readonly code: DemoErrorCode;
  constructor(code: DemoErrorCode, message: string) {
    super(message);
    this.name = 'DemoApiError';
    this.code = code;
  }
}

async function parseErrorCode(response: Response): Promise<DemoErrorCode> {
  if (response.status === 429) return 'rate_limited';
  try {
    const data = (await response.json()) as { code?: string; message?: string };
    const code = String(data?.code || '');
    if (
      code === 'demo_limit_reached' ||
      code === 'bot_check_failed' ||
      code === 'non_chart_image' ||
      code === 'invalid_image' ||
      code === 'demo_unavailable' ||
      code === 'not_example_chart' ||
      code === 'example_used'
    ) {
      return code;
    }
  } catch {
    /* corpo não-JSON → genérico */
  }
  return 'analysis_failed';
}

/** true se este device JÁ usou a análise grátis (decidido pelo servidor). */
export async function fetchDemoStatus(fingerprint: string): Promise<boolean> {
  try {
    const res = await fetch(
      buildApiUrl(`/api/demo/status?fingerprint=${encodeURIComponent(fingerprint)}`),
      { method: 'GET', cache: 'no-store' },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { used?: boolean };
    return data?.used === true;
  } catch {
    // Rede/cold start: não bloquear a UI — o servidor ainda barra na hora do analyze.
    return false;
  }
}

export async function requestDemoAnalysis(params: {
  image: Blob;
  fingerprint: string;
  turnstileToken?: string | null;
  userLanguage?: string;
}): Promise<DemoAnalysisResult> {
  const form = new FormData();
  form.append('image', params.image, 'chart.png');
  form.append('fingerprint', params.fingerprint);
  if (params.turnstileToken) form.append('turnstileToken', params.turnstileToken);
  if (params.userLanguage) form.append('userLanguage', params.userLanguage);

  let response: Response;
  try {
    response = await fetch(buildApiUrl('/api/demo/analyze'), {
      method: 'POST',
      body: form,
    });
  } catch {
    throw new DemoApiError('network_error', 'Network error. Please try again.');
  }

  if (!response.ok) {
    const code = await parseErrorCode(response);
    throw new DemoApiError(code, 'Demo analysis request failed.');
  }

  return (await response.json()) as DemoAnalysisResult;
}

/**
 * Grafico de exemplo para quem JA tem conta (botao do painel). Autenticado,
 * sem fingerprint nem Turnstile; o servidor confere que a imagem e o exemplo e
 * libera uma vez por conta, sem gastar a cota gratis.
 */
export async function requestExampleAnalysis(params: {
  image: Blob;
  token: string;
  userLanguage?: string;
}): Promise<DemoAnalysisResult> {
  const form = new FormData();
  form.append('image', params.image, 'chart.png');
  if (params.userLanguage) form.append('userLanguage', params.userLanguage);

  let response: Response;
  try {
    response = await fetch(buildApiUrl('/api/demo/example'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.token}` },
      body: form,
    });
  } catch {
    throw new DemoApiError('network_error', 'Network error. Please try again.');
  }

  if (!response.ok) {
    const code = await parseErrorCode(response);
    throw new DemoApiError(code, 'Example analysis request failed.');
  }

  return (await response.json()) as DemoAnalysisResult;
}
