function withRequiredSslMode(value?: string): string | undefined {
  if (!value) {
    return value;
  }

  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      return value;
    }

    if (!url.searchParams.has('sslmode')) {
      url.searchParams.set('sslmode', 'require');
    }

    if (
      String(url.searchParams.get('sslmode') || '').toLowerCase() === 'require' &&
      !url.searchParams.has('uselibpqcompat')
    ) {
      url.searchParams.set('uselibpqcompat', 'true');
    }

    return url.toString();
  } catch {
    return value;
  }
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
