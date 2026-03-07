const { execSync } = require('child_process');
const path = require('path');

// Em monorepo, prisma fica na raiz (não no workspace)
const rootDir = path.resolve(__dirname, '../../..');
const backendDir = path.resolve(__dirname, '..');
const prismaBin = path.resolve(rootDir, 'node_modules/.bin/prisma');

try {
  console.log('[migrate] Rodando prisma migrate deploy...');
  execSync(
    `${prismaBin} migrate deploy --schema=./prisma/schema.prisma`,
    { stdio: 'inherit', cwd: backendDir }
  );
  console.log('[migrate] Concluído.');
  process.exit(0);
} catch (err) {
  console.error('[migrate] Falha:', err.message);
  process.exit(1);
}
