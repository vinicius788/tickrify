import { isProductionRuntime } from './runtime-env';

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

export function resolveAllowedOrigins(): string[] {
  const fromFrontendUrl = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL]
    : [];
  const fromCorsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const localOrigins =
    isProductionRuntime()
      ? []
      : [
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:5175',
          'http://localhost:5176',
        ];

  return Array.from(
    new Set([...fromFrontendUrl, ...fromCorsOrigins, ...localOrigins].map(normalizeOrigin)),
  );
}

export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  const productionRuntime = isProductionRuntime();

  return allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin === '*') {
      return !productionRuntime;
    }

    if (allowedOrigin.startsWith('*.')) {
      const suffix = allowedOrigin.slice(1); // keeps the leading "."
      return normalizedOrigin.endsWith(suffix);
    }

    return normalizedOrigin === normalizeOrigin(allowedOrigin);
  });
}
