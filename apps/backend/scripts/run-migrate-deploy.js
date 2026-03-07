const { execSync } = require('child_process');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');

// Chamar prisma via node diretamente (evita problema de symlink no Docker)
const prismaEntry = path.resolve(
  backendDir,
  '../../node_modules/prisma/build/index.js'
);

try {
  console.log('[migrate] Rodando prisma migrate deploy...');
  execSync(
    `node ${prismaEntry} migrate deploy --schema=./prisma/schema.prisma`,
    { stdio: 'inherit', cwd: backendDir }
  );
  console.log('[migrate] Concluído.');
  process.exit(0);
} catch (err) {
  console.error('[migrate] Falha:', err.message);
  process.exit(1);
}
