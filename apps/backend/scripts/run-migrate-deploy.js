const { execSync } = require('child_process');

try {
  console.log('[migrate] Rodando prisma migrate deploy...');
  execSync(
    'npx prisma migrate deploy --schema=./prisma/schema.prisma',
    { stdio: 'inherit', cwd: __dirname + '/..' }
  );
  console.log('[migrate] Concluído.');
  process.exit(0);
} catch (err) {
  console.error('[migrate] Falha:', err.message);
  process.exit(1);
}
