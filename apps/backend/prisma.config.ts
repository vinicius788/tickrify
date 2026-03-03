import { defineConfig } from 'prisma/config';

function loadDotenvIfAvailable() {
  try {
    // Optional: in CI/serverless installs this module may be temporarily unavailable.
    // prisma generate should still work using platform env vars.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config();
  } catch {
    // no-op
  }
}

function isGenerateCommand(): boolean {
  return process.argv.some((value) => String(value).toLowerCase() === 'generate');
}

loadDotenvIfAvailable();

function resolveMigrationsDbUrl() {
  const raw = process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!raw) {
    if (isGenerateCommand()) {
      return withRequiredSslMode('postgresql://postgres:postgres@localhost:5432/postgres');
    }

    throw new Error(
      'Missing DB env. Set MIGRATIONS_DATABASE_URL (recommended) or DATABASE_URL.',
    );
  }

  const url = raw.trim();

  if (url.startsWith('"') || url.startsWith("'")) {
    throw new Error(
      'DB URL starts with quotes. In env vars, do NOT include quotes in the value.',
    );
  }

  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      `Invalid DB URL scheme: ${url.slice(0, 20)}... Must start with postgresql:// or postgres://`,
    );
  }

  return withRequiredSslMode(url);
}

function withRequiredSslMode(value: string): string {
  try {
    const parsed = new URL(value);
    if (['postgres:', 'postgresql:'].includes(parsed.protocol) && !parsed.searchParams.has('sslmode')) {
      parsed.searchParams.set('sslmode', 'require');
    }

    if (
      String(parsed.searchParams.get('sslmode') || '').toLowerCase() === 'require' &&
      !parsed.searchParams.has('uselibpqcompat')
    ) {
      parsed.searchParams.set('uselibpqcompat', 'true');
    }

    return parsed.toString();
  } catch {
    return value;
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: resolveMigrationsDbUrl() },
});
