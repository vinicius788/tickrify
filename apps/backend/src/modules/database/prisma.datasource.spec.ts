import { createRequire } from 'node:module';
import { normalizePrismaDatabaseEnv, resolvePrismaDatasourceUrl } from './prisma.datasource';

// Resolve the actual driver's parser, rather than a different hoisted version.
const adapterRequire = createRequire(require.resolve('@prisma/adapter-pg'));
const pgRequire = createRequire(adapterRequire.resolve('pg'));
const { parse } = pgRequire('pg-connection-string');

describe('PostgreSQL TLS defaults', () => {
  const originalEnv = { ...process.env };
  const url = 'postgresql://audit:test-only@db.invalid/audit';

  beforeEach(() => {
    process.env = { NODE_ENV: 'production', APP_ENV: 'production', DATABASE_URL: url };
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it.each(['', '?sslmode=require', '?sslmode=require&uselibpqcompat=true', '?sslmode=verify-full'])(
  'verifies server identity with configuration %s', (suffix) => {
    process.env.DATABASE_URL = url + suffix;
    const resolved = resolvePrismaDatasourceUrl();
    expect(new URL(resolved).searchParams.get('sslmode')).toBe('verify-full');
    const tls = parse(resolved).ssl;
    expect(tls).toEqual(expect.any(Object));
    expect(tls.rejectUnauthorized).not.toBe(false);
    expect(tls.checkServerIdentity).toBeUndefined();
  });

  it.each(['disable', 'no-verify', 'prefer', 'verify-ca', 'typo'])(
  'rejects unsafe or unknown TLS mode %s in production', (mode) => {
    process.env.DATABASE_URL = `${url}?sslmode=${mode}`;
    expect(resolvePrismaDatasourceUrl).toThrow('sslmode=verify-full');
  });

  it('allows explicitly disabled TLS for local development', () => {
    process.env.APP_ENV = 'development';
    process.env.DATABASE_URL = `${url}?sslmode=disable`;
    expect(parse(resolvePrismaDatasourceUrl()).ssl).toBe(false);
  });

  it('normalizes the direct URL fallback and preserves unrelated parameters', () => {
    delete process.env.DATABASE_URL;
    process.env.DIRECT_URL = `${url}?schema=tickrify&connection_limit=5`;
    const { runtimeUrl, directUrl } = normalizePrismaDatabaseEnv();
    expect(runtimeUrl).toBe(directUrl);
    expect(new URL(runtimeUrl!).searchParams.get('schema')).toBe('tickrify');
    expect(new URL(runtimeUrl!).searchParams.get('connection_limit')).toBe('5');
    expect(parse(runtimeUrl).ssl.rejectUnauthorized).not.toBe(false);
  });

  it.each(['not-a-url-containing-a-secret', 'https://audit:secret@db.invalid'])(
  'rejects invalid datasource URLs without echoing credentials', (value) => {
    process.env.DATABASE_URL = value;
    expect(resolvePrismaDatasourceUrl).toThrow(/datasource URL|Datasource URL/);
    try { resolvePrismaDatasourceUrl(); } catch (error) {
      expect(String(error)).not.toContain(value);
    }
  });
});
