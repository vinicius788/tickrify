#!/usr/bin/env node
const { execSync } = require('child_process');

execSync('node scripts/check-db-url.js', {
  stdio: 'inherit',
  env: process.env,
});

execSync('npx prisma migrate deploy --config ./prisma.config.ts', {
  stdio: 'inherit',
  env: process.env,
});
