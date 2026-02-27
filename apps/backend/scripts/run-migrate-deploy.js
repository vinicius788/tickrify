#!/usr/bin/env node
const { execSync } = require('child_process');

console.log(
  'DB URL scheme:',
  process.env.MIGRATIONS_DATABASE_URL?.split(':')[0] ??
    process.env.DIRECT_DATABASE_URL?.split(':')[0] ??
    process.env.DATABASE_URL?.split(':')[0],
);

execSync('npx prisma migrate deploy --config ./prisma.config.ts', {
  stdio: 'inherit',
  env: process.env,
});
