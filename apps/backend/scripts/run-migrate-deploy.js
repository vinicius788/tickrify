const { execSync } = require('child_process');

try {
  console.log('[migrate] Rodando prisma migrate deploy...');
  execSync('npx prisma migrate deploy --schema=./prisma/schema.prisma', {
    stdio: 'inherit',
    cwd: __dirname + '/..',
  });
  console.log('[migrate] Migrations concluídas com sucesso.');
  process.exit(0);
} catch (error) {
  console.error('[migrate] Falha nas migrations:', error.message);
  process.exit(1);
}
