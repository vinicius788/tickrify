import { isProductionRuntime } from './runtime-env';

function hasValue(name: string): boolean {
  return Boolean(String(process.env[name] || '').trim());
}

/**
 * Validates only startup-critical variables to avoid opaque framework errors.
 */
export function validateStartupEnv(): void {
  const missing: string[] = [];

  if (!hasValue('DATABASE_URL') && !hasValue('DIRECT_URL')) {
    missing.push('DATABASE_URL (or DIRECT_URL)');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (isProductionRuntime()) {
    const hasCorsConfig = hasValue('FRONTEND_URL') || hasValue('CORS_ORIGINS');
    if (!hasCorsConfig) {
      throw new Error('Missing required environment variables: FRONTEND_URL or CORS_ORIGINS');
    }
  }
}
