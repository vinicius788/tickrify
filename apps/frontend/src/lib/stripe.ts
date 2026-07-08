// Cliente Stripe para o frontend
import { API_BASE_URL } from './api';

export type BillingCycle = 'monthly' | 'yearly';
export type Currency = 'brl' | 'usd' | 'eur';
export type PlanType = 'starter' | 'pro' | 'elite';

// Site is global/English-first → USD is the default. BRL only for Brazilian
// locale; EUR only for eurozone locales. Everything else (US, UK, CA, AU, …) → USD.
const EURO_LOCALE_PREFIXES = ['de', 'fr', 'es', 'it', 'nl', 'fi', 'el', 'et', 'lv', 'lt', 'sk', 'sl', 'ga', 'mt'];

export function detectCurrency(locale: string): Currency {
  const normalized = String(locale || '').toLowerCase();
  if (normalized === 'pt-br' || normalized === 'pt') return 'brl';
  if (normalized === 'pt-pt') return 'eur';
  if (EURO_LOCALE_PREFIXES.some((l) => normalized === l || normalized.startsWith(`${l}-`))) return 'eur';
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

