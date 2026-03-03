import { randomUUID } from 'crypto';

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

export function attachRequestContext(req: any, res: any, next: () => void) {
  const incoming =
    req.headers?.['x-request-id'] ||
    req.headers?.['x-correlation-id'] ||
    req.headers?.['x-amzn-trace-id'];

  const requestId = sanitizeRequestId(incoming) || randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}

