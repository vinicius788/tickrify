// Cliente Stripe para o frontend
import { API_BASE_URL } from './api';
import { getAdsPayload, getReferralPayload } from './attribution';

export type BillingCycle = 'monthly' | 'yearly' | 'weekly';
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

/**
 * Erro do checkout com o `code` que o backend manda (ex.: `already_subscribed`,
 * `stripe_unavailable`). A tela decide o que fazer pelo codigo, nao pelo texto.
 */
export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

async function readError(
  response: Response,
  fallbackMessage: string,
): Promise<{ message: string; code?: string }> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as {
      message?: string | string[];
      error?: string;
      details?: string;
      code?: string;
    } | null;
    const code = typeof payload?.code === 'string' ? payload.code : undefined;

    const message = payload?.message || payload?.error || payload?.details;
    if (Array.isArray(message)) {
      const joined = message.map((item) => String(item)).join(', ').trim();
      if (joined) {
        return { message: joined, code };
      }
    }

    if (typeof message === 'string' && message.trim()) {
      return { message: message.trim(), code };
    }
  }

  const textBody = (await response.text().catch(() => '')).trim();
  if (textBody) {
    const isHtmlError = textBody.includes('<!doctype') || textBody.includes('<html');
    if (isHtmlError) {
      return { message: `${fallbackMessage} Verifique se VITE_API_URL aponta para o backend.` };
    }
    return { message: textBody.slice(0, 220) };
  }

  return { message: fallbackMessage };
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
      const { message, code } = await readError(response, fallbackMessage);
      throw new CheckoutError(message, code, response.status);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof TypeError || (error as Error)?.name === 'AbortError') {
      throw new CheckoutError(
        'The payment service is waking up and took too long to respond. Please try again in a few seconds.',
        'network_timeout',
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
  source?: 'pricing' | 'locked_value' | 'last_free_result',
) {
  const session = await requestStripeApi<{ sessionId: string; url: string }>(
    '/api/stripe/create-checkout-session',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        planType,
        billingCycle,
        currency,
        ...(coupon ? { coupon } : {}),
        ...(source ? { source } : {}),
        // Contexto do Meta (so com aceite de cookies). O servidor usa no
        // InitiateCheckout e guarda na sessao para o Purchase do webhook.
        ...getAdsPayload(),
        // Link/cupom de afiliado guardado: o servidor confere e decide o desconto.
        ...getReferralPayload(),
      }),
    },
    'Could not start checkout. Please try again.',
  );

  // Nunca redirecionar para "undefined" ou para uma URL que nao seja https:
  // resposta sem URL valida e erro, nao checkout.
  if (!isHttpsUrl(session?.url)) {
    throw new CheckoutError('Could not open checkout. Please try again.', 'invalid_checkout_url');
  }
  return session;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}


/**
 * Retorno da Stripe. Com `sessionId` (success_url) o servidor confirma se a
 * sessao e desta pessoa e se foi paga; so com `paid: true` o painel dispara o
 * Purchase do pixel. Com `outcome: 'canceled'` so registra o retorno.
 * Nunca lanca: e observabilidade e confirmacao, nao pode quebrar a tela.
 */
export async function getCheckoutStatus(
  token: string,
  params: { sessionId?: string | null; outcome: 'success' | 'canceled' },
): Promise<{ sessionId: string | null; paid: boolean; value: number | null; currency: string | null } | null> {
  try {
    const query = new URLSearchParams({ outcome: params.outcome });
    if (params.sessionId) query.set('session_id', params.sessionId);
    return await requestStripeApi(
      `/api/stripe/checkout-status?${query.toString()}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      'Could not confirm checkout.',
    );
  } catch {
    return null;
  }
}
