// Synthetic child process for the opt-in PostgreSQL integration test only.
const path = require('node:path');
const url = new URL(process.env.TICKRIFY_PG_TEST_URL || '');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/tickrify_concurrency_test' || url.username !== 'tickrify_test') {
  throw new Error('Only the disposable loopback test database is allowed.');
}
process.env.DATABASE_URL = url.toString();
process.env.DIRECT_URL = url.toString();
const base = path.join(__dirname, '../dist/src/modules');
const { PrismaService } = require(path.join(base, 'database/prisma.service.js'));
const { TicksService } = require(path.join(base, 'ticks/ticks.service.js'));
const { TradesService } = require(path.join(base, 'ai/trades.service.js'));
const prisma = new PrismaService();
if (process.argv[5] === 'before-commit') {
  const transaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (run, options) => transaction(async (tx) => {
    const response = await run(tx);
    if (!options?.isolationLevel) return response;
    process.send({ event: 'reservation-uncommitted' });
    return new Promise(() => {});
  }, { ...options, timeout: 30_000 });
}
const adapter = { manageTrade: async () => {
  process.send({ event: 'model-started' });
  return new Promise(() => {}); // Parent sends SIGKILL at this point.
} };
const service = new TradesService(prisma, adapter, new TicksService(prisma));
service.ready = true; // No boot hooks or DDL.
service.check(process.argv[2], process.argv[3], { base64Image: process.argv[4] }, true, () => new Error('quota'))
  .catch((error) => { process.send({ event: 'failed', message: String(error.message) }); process.exitCode = 1; });
