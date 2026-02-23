#!/usr/bin/env node
const { execSync } = require('child_process');

function withRequiredSslMode(rawUrl) {
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      return rawUrl;
    }
    if (!parsed.searchParams.has('sslmode')) {
      parsed.searchParams.set('sslmode', 'require');
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

const runtimeUrl = withRequiredSslMode(process.env.DATABASE_URL || process.env.DIRECT_URL);
const directUrl = withRequiredSslMode(process.env.DIRECT_URL || runtimeUrl);

if (!runtimeUrl) {
  console.error('DATABASE_URL or DIRECT_URL must be provided.');
  process.exit(1);
}

process.env.DATABASE_URL = runtimeUrl;
process.env.DIRECT_URL = directUrl;

execSync('npx prisma migrate deploy', {
  stdio: 'inherit',
  env: process.env,
});
