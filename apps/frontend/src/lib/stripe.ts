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

async function requestStripeApi<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string,
): Promise<T> {
  const baseUrl = getStripeApiBaseUrl();
  const targetUrl = `${baseUrl}${path}`;

  try {
    const response = await fetch(targetUrl, init);

    if (!response.ok) {
      const message = await readErrorMessage(response, fallbackMessage);
      throw new Error(message);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Não foi possível conectar ao backend de pagamentos (${targetUrl}). Verifique VITE_API_URL e CORS.`,
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
) {
  return requestStripeApi<{ sessionId: string; url: string }>(
    '/api/stripe/create-checkout-session',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ planType, billingCycle, currency }),
    },
    'Falha ao criar sessão de checkout.',
  );
}

