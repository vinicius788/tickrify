import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { isIP } from 'net';

function sanitizeRequestId(candidate?: string): string | null {
  const value = String(candidate || '').trim();
  if (!value) {
    return null;
  }

  // Keep request-id predictable and avoid header injection.
  if (!/^[a-zA-Z0-9._-]{8,128}$/.test(value)) {
    return null;
  }

  return value;
}

type ClientIpRequest = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
};

function validIp(candidate: unknown): string | null {
  const value = String(candidate || '').trim().replace(/^::ffff:/i, '');
  return value && isIP(value) ? value : null;
}

/**
 * IP real de quem chamou. A API fica atras da Cloudflare do Render, que
 * sobrescreve `cf-connecting-ip` em toda requisicao (o cliente nao forja). Sem
 * o cabecalho (local, testes), vale o `req.ip` do trust proxy. Serve ao PostHog
 * e ao limite do trial; o rate limit continua no `req.ip` (app-throttler.guard).
 */
export function resolveClientIp(req: ClientIpRequest): string | null {
  const edge = req.headers?.['cf-connecting-ip'];
  return validIp(Array.isArray(edge) ? edge[0] : edge) ?? validIp(req.ip);
}

const clientIpStore = new AsyncLocalStorage<string | null>();

/** IP da requisicao ou do job em andamento. null = sem usuario na ponta (webhook, varreduras). */
export function currentClientIp(): string | null {
  return clientIpStore.getStore() ?? null;
}

/** Roda `fn` com o IP do usuario original (job da fila, criado numa requisicao dele). */
export function runWithClientIp<T>(ip: string | null | undefined, fn: () => T): T {
  return clientIpStore.run(validIp(ip), fn);
}

export function attachRequestContext(req: any, res: any, next: () => void) {
  const incoming =
    req.headers?.['x-request-id'] ||
    req.headers?.['x-correlation-id'] ||
    req.headers?.['x-amzn-trace-id'];

  const requestId = sanitizeRequestId(incoming) || randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  // O webhook da Stripe vem do servidor deles: nunca e o IP do usuario.
  const fromStripe = Boolean(req.headers?.['stripe-signature']);
  clientIpStore.run(fromStripe ? null : resolveClientIp(req), next);
}
