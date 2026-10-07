import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Cliente minimo do NOWPayments (cobranca em cripto). Doc oficial lida em
 * 07/10/2026: invoice em `POST /v1/invoice`, leitura em `GET /v1/payment/:id`,
 * aviso (IPN) assinado em `x-nowpayments-sig` = HMAC-SHA512 do JSON com as
 * chaves ordenadas, com a "IPN secret" do painel deles.
 *
 * SEGURANCA: a API key e o segredo do IPN so vivem no ambiente (Render). Nada
 * daqui loga corpo de resposta nem cabecalho.
 */

const DEFAULT_API_URL = 'https://api.nowpayments.io/v1';
/** Producao e sandbox oficiais; qualquer outro valor cai no padrao (a API key nunca sai para host estranho). */
const ALLOWED_API_URLS = new Set([DEFAULT_API_URL, 'https://api-sandbox.nowpayments.io/v1']);
const TIMEOUT_MS = 15_000;

export function nowPaymentsConfig() {
  const apiUrl = String(process.env.NOWPAYMENTS_API_URL || '').trim().replace(/\/+$/, '');
  return {
    apiKey: String(process.env.NOWPAYMENTS_API_KEY || '').trim(),
    ipnSecret: String(process.env.NOWPAYMENTS_IPN_SECRET || '').trim(),
    apiUrl: ALLOWED_API_URLS.has(apiUrl) ? apiUrl : DEFAULT_API_URL,
  };
}

export function isNowPaymentsConfigured(): boolean {
  const { apiKey, ipnSecret } = nowPaymentsConfig();
  return Boolean(apiKey && ipnSecret);
}

/**
 * Ordena as chaves em todos os niveis. `arraysAsObjects` reproduz ao pe da
 * letra o exemplo em Node da doc (que transforma lista em objeto `{"0":..}`);
 * sem ele, a lista fica lista (como no exemplo em PHP). Aceitamos as duas
 * formas na verificacao: a doc mostra as duas e as duas exigem o segredo.
 */
export function sortDeep(value: unknown, arraysAsObjects = false): unknown {
  if (Array.isArray(value) && !arraysAsObjects) return value.map((item) => sortDeep(item, arraysAsObjects));
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortDeep((value as Record<string, unknown>)[key], arraysAsObjects);
        return acc;
      }, {});
  }
  return value;
}

export function signIpn(body: unknown, secret: string, arraysAsObjects = false): string {
  return createHmac('sha512', secret).update(JSON.stringify(sortDeep(body, arraysAsObjects))).digest('hex');
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Assinatura do aviso. Sem segredo configurado ou sem cabecalho, sempre falso. */
export function verifyIpnSignature(body: unknown, signature: string | undefined | null, secret: string): boolean {
  const received = String(signature || '').trim().toLowerCase();
  if (!secret || !/^[0-9a-f]{128}$/.test(received)) return false;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return sameHex(signIpn(body, secret), received) || sameHex(signIpn(body, secret, true), received);
}

export type NowInvoice = { id: string; invoice_url: string };

/** Pagamento como a API devolve. So os campos que a liberacao do passe usa. */
export type NowPayment = {
  payment_id: number | string;
  invoice_id?: number | string | null;
  payment_status: string;
  price_amount: number | string;
  price_currency: string;
  pay_currency?: string | null;
  actually_paid?: number | string | null;
  order_id?: string | null;
  parent_payment_id?: number | string | null;
};

export class NowPaymentsError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'NowPaymentsError';
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const { apiKey, apiUrl } = nowPaymentsConfig();
  if (!apiKey) throw new NowPaymentsError('NOWPayments nao configurado', null);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new NowPaymentsError(`NOWPayments inalcancavel (${(error as Error)?.name || 'erro'})`, null);
  }
  if (!response.ok) throw new NowPaymentsError(`NOWPayments respondeu ${response.status} em ${path.split('/')[1]}`, response.status);
  return (await response.json()) as T;
}

export async function createInvoice(input: {
  priceUsd: number;
  orderId: string;
  description: string;
  ipnCallbackUrl: string;
  successUrl: string;
  cancelUrl: string;
  partiallyPaidUrl: string;
}): Promise<NowInvoice> {
  const invoice = await request<{ id?: unknown; invoice_url?: unknown }>('POST', '/invoice', {
    price_amount: input.priceUsd,
    price_currency: 'usd',
    order_id: input.orderId,
    order_description: input.description,
    ipn_callback_url: input.ipnCallbackUrl,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    partially_paid_url: input.partiallyPaidUrl,
  });
  const url = typeof invoice.invoice_url === 'string' ? invoice.invoice_url : '';
  if (!invoice.id || !/^https:\/\//.test(url)) throw new NowPaymentsError('Invoice sem id ou sem link', null);
  return { id: String(invoice.id), invoice_url: url };
}

export async function getPayment(paymentId: string): Promise<NowPayment> {
  if (!/^\d{1,20}$/.test(paymentId)) throw new NowPaymentsError('payment_id invalido', null);
  return request<NowPayment>('GET', `/payment/${paymentId}`);
}
