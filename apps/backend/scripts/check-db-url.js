#!/usr/bin/env node

require('dotenv/config');
const dns = require('dns/promises');

function pickDatabaseUrl() {
  const migrationsUrl = normalizeDbUrl(process.env.MIGRATIONS_DATABASE_URL);
  if (migrationsUrl) {
    return {
      source: 'MIGRATIONS_DATABASE_URL',
      value: migrationsUrl,
    };
  }

  const directUrl = normalizeDbUrl(process.env.DIRECT_URL);
  if (directUrl) {
    return {
      source: 'DIRECT_URL',
      value: directUrl,
    };
  }

  const directDatabaseUrl = normalizeDbUrl(process.env.DIRECT_DATABASE_URL);
  if (directDatabaseUrl) {
    return {
      source: 'DIRECT_DATABASE_URL',
      value: directDatabaseUrl,
    };
  }

  const databaseUrl = normalizeDbUrl(process.env.DATABASE_URL);
  if (databaseUrl) {
    return {
      source: 'DATABASE_URL',
      value: databaseUrl,
    };
  }

  throw new Error(
    [
      'Nenhuma URL de banco foi encontrada.',
      'Defina MIGRATIONS_DATABASE_URL (preferencial), DIRECT_URL/DIRECT_DATABASE_URL, ou DATABASE_URL.',
      'Veja DEPLOY.md para instruções de conexão.',
    ].join(' '),
  );
}

function normalizeDbUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  // Ignore unresolved interpolation placeholders like ${DATABASE_URL}.
  if (normalized.startsWith('${') || normalized.startsWith('$')) {
    return '';
  }

  return normalized;
}

function isPlaceholderUrl(url) {
  const normalized = url.toLowerCase();
  return (
    normalized.includes('user:password@') ||
    normalized.includes('your_') ||
    normalized.includes('<') ||
    normalized.includes('example')
  );
}

function maskUrl(url) {
  const parsed = new URL(url);
  if (parsed.username) {
    parsed.username = '***';
  }
  if (parsed.password) {
    parsed.password = '***';
  }
  return `${parsed.protocol}//${parsed.username ? '***:***@' : ''}${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
}

async function main() {
  const { source, value } = pickDatabaseUrl();

  if (isPlaceholderUrl(value)) {
    throw new Error(
      [
        `A variável ${source} parece usar placeholder.`,
        'Cole a connection string real do painel Supabase/Render.',
        'Veja DEPLOY.md.',
      ].join(' '),
    );
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      [
        `A variável ${source} não é uma URL válida.`,
        'Cole a connection string completa (postgresql://...).',
        'Veja DEPLOY.md.',
      ].join(' '),
    );
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(
      [
        `Protocolo inválido em ${source}: ${parsed.protocol}`,
        'Use postgresql://...',
        'Veja DEPLOY.md.',
      ].join(' '),
    );
  }

  const hostname = parsed.hostname;
  const port = parsed.port || '5432';
  if (!hostname) {
    throw new Error(`A variável ${source} não possui hostname válido.`);
  }

  console.log(`[db-check] Variável usada: ${source}`);
  console.log(`[db-check] Destino: ${hostname}:${port}`);
  console.log(`[db-check] URL (masked): ${maskUrl(value)}`);

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    console.log('[db-check] Host local detectado. Pulando validação DNS.');
    return;
  }

  try {
    await dns.lookup(hostname);
  } catch (error) {
    const err = error;
    throw new Error(
      [
        'DB host não resolve. Cole a connection string do painel Supabase/Render. Veja DEPLOY.md.',
        `Hostname: ${hostname}`,
        `Código DNS: ${err?.code || 'UNKNOWN'}`,
      ].join(' '),
    );
  }
}

main().catch((error) => {
  console.error(`[db-check] ERRO: ${error.message}`);
  process.exit(1);
});
