import { isProductionRuntime } from './runtime-env';

function hasValue(name: string): boolean {
  return Boolean(String(process.env[name] || '').trim());
}

/**
 * Validates only startup-critical variables to avoid opaque framework errors.
 */
export function validateStartupEnv(): void {
  const missing: string[] = [];

  if (!hasValue('APP_ENV')) {
    missing.push('APP_ENV');
  }

  if (!hasValue('DATABASE_URL') && !hasValue('DIRECT_URL') && !hasValue('DIRECT_DATABASE_URL')) {
    missing.push('DATABASE_URL (or DIRECT_URL / DIRECT_DATABASE_URL)');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (isProductionRuntime()) {
    const hasCorsConfig = hasValue('FRONTEND_URL') || hasValue('CORS_ORIGINS');
    if (!hasCorsConfig) {
      throw new Error('Missing required environment variables: FRONTEND_URL or CORS_ORIGINS');
    }

    const hasAuthConfig = hasValue('CLERK_SECRET_KEY') || hasValue('CLERK_JWT_KEY');
    if (!hasAuthConfig) {
      throw new Error(
        'Missing required environment variables: CLERK_SECRET_KEY or CLERK_JWT_KEY',
      );
    }
  }
}
