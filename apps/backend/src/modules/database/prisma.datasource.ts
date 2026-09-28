import { isProductionRuntime } from '../../common/utils/runtime-env';

function withRequiredSslMode(value?: string): string | undefined {
  if (!value) {
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid PostgreSQL datasource URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Datasource URL must use postgres:// or postgresql://.');
  }

  const mode = String(url.searchParams.get('sslmode') || '').trim().toLowerCase();
  // `require` with libpq compatibility encrypts but does not authenticate the
  // server. Upgrade legacy URLs as well as the unconfigured default.
  const secureMode = !mode || mode === 'require' ? 'verify-full' : mode;
  if (isProductionRuntime() && secureMode !== 'verify-full') {
    throw new Error('PostgreSQL requires sslmode=verify-full in production.');
  }
  url.searchParams.set('sslmode', secureMode);
  return url.toString();
}

export function normalizePrismaDatabaseEnv(): {
  runtimeUrl?: string;
  directUrl?: string;
} {
  const runtimeUrl = withRequiredSslMode(process.env.DATABASE_URL);
  const directUrl = withRequiredSslMode(process.env.DIRECT_URL);

  if (!runtimeUrl && directUrl) {
    process.env.DATABASE_URL = directUrl;
  } else if (runtimeUrl) {
    process.env.DATABASE_URL = runtimeUrl;
  }

  if (!directUrl && runtimeUrl) {
    process.env.DIRECT_URL = runtimeUrl;
  } else if (directUrl) {
    process.env.DIRECT_URL = directUrl;
  }

  return {
    runtimeUrl: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
  };
}

export function resolvePrismaDatasourceUrl(): string {
  const { runtimeUrl, directUrl } = normalizePrismaDatabaseEnv();
  const datasourceUrl = runtimeUrl || directUrl;

  if (!datasourceUrl) {
    throw new Error('Missing DATABASE_URL/DIRECT_URL for Prisma runtime datasource.');
  }

  return datasourceUrl;
}
