import { buildApiUrl } from './api';

/**
 * Passe pre-pago em cripto (NOWPayments, 07/10/2026). Arquivo proprio, fora do
 * `stripe.ts`: e outro provedor, e o servidor decide preco e duracao (o corpo
 * so leva o tipo do passe).
 */
export type CryptoPass = 'week' | 'month';

export class CryptoCheckoutError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'CryptoCheckoutError';
  }
}

export async function createCryptoCheckout(pass: CryptoPass, token: string): Promise<{ url: string }> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl('/api/crypto/checkout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pass }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new CryptoCheckoutError('network', 'network_error');
  }

  const payload = (await response.json().catch(() => null)) as { url?: unknown; code?: unknown } | null;
  if (!response.ok) {
    throw new CryptoCheckoutError(`http_${response.status}`, typeof payload?.code === 'string' ? payload.code : undefined);
  }
  // Nunca redirecionar para algo que nao seja https.
  const url = typeof payload?.url === 'string' ? payload.url : '';
  if (!/^https:\/\//.test(url)) throw new CryptoCheckoutError('invalid_url', 'invalid_checkout_url');
  return { url };
}

/** Status de um pagamento da propria conta (a volta do NOWPayments traz `?order=`). */
export async function getCryptoPaymentStatus(orderId: string, token: string): Promise<{ status: string; active: boolean } | null> {
  if (!/^[a-z0-9]{10,40}$/i.test(orderId)) return null;
  try {
    const response = await fetch(buildApiUrl(`/api/crypto/payment/${orderId}`), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { status?: unknown; active?: unknown };
    return { status: String(payload.status ?? ''), active: payload.active === true };
  } catch {
    return null;
  }
}

/** Data curta no idioma da tela (ex.: "Oct 14"). */
export function formatPassDate(iso: string | null | undefined, language: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(language, { month: 'short', day: 'numeric' });
}
