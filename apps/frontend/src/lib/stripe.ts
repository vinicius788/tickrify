// Cliente Stripe para o frontend
import { API_BASE_URL } from './api';

export type BillingCycle = 'monthly' | 'yearly';
export type Currency = 'brl' | 'usd' | 'eur';
export type PlanType = 'starter' | 'pro' | 'elite';

// MOEDA ÚNICA: USD (29/07/2026).
//
// Existia aqui um `detectCurrency(locale)` que mandava navegador em pt-BR para
// BRL e eurozona para EUR. Parecia gentileza e era bug de receita: os price IDs
// BRL/EUR nunca foram atualizados nas três mudanças de preço ($12 → $19 → $29),
// então um visitante brasileiro assinava o plano de US$ 29 por R$ 57 (~US$ 10).
//
// Manter 18 objetos de preço (3 planos × 2 ciclos × 3 moedas) sincronizados à
// mão é o que criou o bug — e o recriaria no próximo reajuste. Com USD único
// sobra 1 preço para manter, e a Stripe converte para a moeda local do cliente
// no checkout via Adaptive Pricing, na cotação do dia. O tipo `Currency` segue
// com as três moedas porque assinaturas LEGADAS ainda resolvem por elas.

/**
 * @deprecated Sempre retorna 'usd'. Mantida como casca para não quebrar
 * importações antigas — inclusive o mock em `__tests__/DashboardPage.test.tsx`,
 * que declara `detectCurrency` e daria erro de tipo se o export sumisse.
 * Pode ser apagada junto com o mock quando o build local voltar a rodar.
 */
export function detectCurrency(_locale?: string): Currency {
  return 'usd';
}

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function getStripeApiBaseUrl() {
  let parsed: URL | null = null;
  try {
    parsed = new URL(API_BASE_URL);
  } catch {
    // API_BASE_URL always resolved to an absolute URL in api.ts
  }

  const frontendHost = typeof window !== 'undefined' ? window.location.hostname : '';
  if (parsed && frontendHost && !isLocalHostname(frontendHost) && isLocalHostname(parsed.hostname)) {
    throw new Error(
      'VITE_API_URL está apontando para localhost em produção. Configure a URL pública do backend.',
    );
  }

  return API_BASE_URL;
}

async function readErrorMessage(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as {
      message?: string | string[];
      error?: string;
      details?: string;
    } | null;

    const message = payload?.message || payload?.error || payload?.details;
    if (Array.isArray(message)) {
      const joined = message.map((item) => String(item)).join(', ').trim();
      if (joined) {
        return joined;
      }
    }

    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }

  const textBody = (await response.text().catch(() => '')).trim();
  if (textBody) {
    const isHtmlError = textBody.includes('<!doctype') || textBody.includes('<html');
    if (isHtmlError) {
      return `${fallbackMessage} Verifique se VITE_API_URL aponta para o backend.`;
    }
    return textBody.slice(0, 220);
  }

  return fallbackMessage;
}

// O backend hiberna no Render (plano free); o cold start pode levar até ~50s.
// Damos um timeout longo e, se o 1º toque falhar por conexão (típico de API
// ainda acordando), tentamos de novo uma vez após um respiro.
const CHECKOUT_TIMEOUT_MS = 45_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestStripeApi<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string,
): Promise<T> {
  const baseUrl = getStripeApiBaseUrl();
  const targetUrl = `${baseUrl}${path}`;

  const attempt = async (): Promise<Response> =>
    fetchWithTimeout(targetUrl, init, CHECKOUT_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await attempt();
    } catch (firstError) {
      // Cold start: 1ª chamada abortou/caiu. Espera o boot e tenta uma vez mais.
      if (firstError instanceof TypeError || (firstError as Error)?.name === 'AbortError') {
        await new Promise((r) => setTimeout(r, 3_000));
        response = await attempt();
      } else {
        throw firstError;
      }
    }

    if (!response.ok) {
      const message = await readErrorMessage(response, fallbackMessage);
      throw new Error(message);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof TypeError || (error as Error)?.name === 'AbortError') {
      throw new Error(
        'The payment service is waking up and took too long to respond. Please try again in a few seconds.',
      );
    }

    throw error;
  }
}

/**
 * Criar sessão de checkout
 */
export async function createCheckoutSession(
  planType: PlanType,
  token: string,
  billingCycle: BillingCycle = 'monthly',
  currency: Currency = 'usd',
  coupon?: 'EARLY35',
) {
  return requestStripeApi<{ sessionId: string; url: string }>(
    '/api/stripe/create-checkout-session',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ planType, billingCycle, currency, ...(coupon ? { coupon } : {}) }),
    },
    'Falha ao criar sessão de checkout.',
  );
}

