// Cliente da demo anônima (/api/demo/*) — endpoints públicos, sem auth.
// Mantido fora do api.ts para não misturar com o cliente autenticado.
import { buildApiUrl, type PriceLocation, type SignalState, type WatchPlan, type WatchReach } from './api';

export interface DemoAnalysisResult {
  status: 'completed';
  recommendation: 'BUY' | 'SELL' | 'WAIT';
  /** Estado do copiloto; leitura guardada antes dele nao tem. */
  signalState?: SignalState;
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
  /** Modo leitura: forca da tendencia, linha da leitura, plano, alcance e onde o preco esta. */
  trendStrength?: 'strong' | 'moderate' | 'weak' | null;
  readLine?: string;
  watchPlan?: WatchPlan | null;
  watchReach?: WatchReach | null;
  location?: PriceLocation | null;
  /** Origem dos niveis; leitura de antes do v11 nao tem. */
  dataMode?: 'real_data' | 'print' | null;
  reasoning: string;
  disclaimer: string;
  disclaimerCode?: string;
  reasoningCode?: string | null;
  demoRemaining: number;
  /** A mesma leitura devolvida de novo (a conexao tinha caido antes de chegar). */
  recovered?: boolean;
}

export type DemoErrorCode =
  | 'demo_limit_reached'
  | 'bot_check_failed'
  | 'non_chart_image'
  | 'invalid_image'
  | 'analysis_failed'
  | 'demo_unavailable'
  | 'rate_limited'
  | 'network_error';

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
      code === 'demo_unavailable'
    ) {
      return code;
    }
  } catch {
    /* corpo não-JSON → genérico */
  }
  return 'analysis_failed';
}

/**
 * Este device JÁ usou a análise grátis (decidido pelo servidor)? E, nas
 * ultimas 24h, a leitura que ele recebeu (05/10/2026: no celular a resposta
 * se perdia quando a pessoa trocava de app durante a espera).
 */
export type DemoStatus = {
  used: boolean;
  /** A analise deste aparelho esta rodando. null = o servidor nao disse (versao antiga ou falha de rede). */
  pending: boolean | null;
  result: DemoAnalysisResult | null;
};

export async function fetchDemoStatus(fingerprint: string): Promise<DemoStatus> {
  try {
    const res = await fetch(
      buildApiUrl(`/api/demo/status?fingerprint=${encodeURIComponent(fingerprint)}`),
      { method: 'GET', cache: 'no-store' },
    );
    if (!res.ok) return { used: false, pending: null, result: null };
    const data = (await res.json()) as { used?: boolean; pending?: boolean; result?: DemoAnalysisResult | null };
    const result = data?.result && data.result.status === 'completed' ? data.result : null;
    return { used: data?.used === true, pending: typeof data?.pending === 'boolean' ? data.pending : null, result };
  } catch {
    // Rede/cold start: não bloquear a UI — o servidor ainda barra na hora do analyze.
    return { used: false, pending: null, result: null };
  }
}

/**
 * A conexao caiu no meio do envio (10/11/2026: 95 de 150 falhas da demo em 45
 * dias, quase todas no celular). O servidor pode ter recebido e seguir
 * analisando: espera a leitura aparecer no `status` em vez de mostrar erro.
 * `arrived: false` = o servidor confirmou duas vezes que nao ha analise deste
 * aparelho (nem rodando, nem pronta): o envio nao chegou e pode ser repetido.
 */
export async function waitForDemoResult(
  fingerprint: string,
  options: { everyMs?: number; maxMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ result: DemoAnalysisResult | null; arrived: boolean }> {
  const everyMs = options.everyMs ?? 4_000;
  const maxMs = options.maxMs ?? 90_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let absent = 0;
  for (let waited = 0; waited < maxMs; waited += everyMs) {
    await sleep(everyMs);
    const status = await fetchDemoStatus(fingerprint);
    if (status.result) return { result: status.result, arrived: true };
    // So conta como "nao chegou" quando o servidor responde e diz que nada roda.
    absent = status.pending === false && !status.used ? absent + 1 : 0;
    if (absent >= 2) return { result: null, arrived: false };
  }
  return { result: null, arrived: true };
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
 * A leitura da demo do /try sobrevive ao cadastro (05/10/2026). Antes, criar a
 * conta pelo CTA da demo levava ao painel e a analise que a pessoa acabou de
 * ver sumia. Fica so neste aparelho (sem backend): o painel mostra enquanto a
 * conta ainda nao tem analise propria.
 */
const DEMO_RESULT_KEY = 'tickrify_demo_result';
const DEMO_RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SavedDemoResult = Pick<
  DemoAnalysisResult,
  'recommendation' | 'signalState' | 'symbol' | 'timeframe' | 'entry' | 'stopLoss' | 'takeProfit1' | 'riskReward'
> & { savedAt: number };

export function saveDemoResult(result: DemoAnalysisResult, now = Date.now()): void {
  const saved: SavedDemoResult = {
    recommendation: result.recommendation,
    signalState: result.signalState,
    symbol: result.symbol,
    timeframe: result.timeframe,
    entry: result.entry,
    stopLoss: result.stopLoss,
    takeProfit1: result.takeProfit1,
    riskReward: result.riskReward,
    savedAt: now,
  };
  try {
    localStorage.setItem(DEMO_RESULT_KEY, JSON.stringify(saved));
  } catch {
    /* modo privado: a demo continua funcionando, so nao atravessa o cadastro */
  }
}

export function loadSavedDemoResult(now = Date.now()): SavedDemoResult | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEMO_RESULT_KEY) || 'null') as SavedDemoResult | null;
    if (!parsed || typeof parsed.savedAt !== 'number' || now - parsed.savedAt > DEMO_RESULT_TTL_MS) return null;
    if (!['BUY', 'SELL', 'WAIT'].includes(parsed.recommendation)) return null;
    return parsed;
  } catch {
    return null;
  }
}
