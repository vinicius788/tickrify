const { execSync } = require('child_process');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
const prismaBin = path.resolve(backendDir, 'node_modules/.bin/prisma');

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
