// Synthetic child process, only for the disposable PostgreSQL demo test.
const path = require('node:path');
const url = new URL(process.env.TICKRIFY_DEMO_TEST_URL || '');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/tickrify_demo_concurrency_test' || url.username !== 'tickrify_demo_test') {
  throw new Error('Only the disposable loopback demo database is allowed.');
}
process.env.DATABASE_URL = url.toString();
process.env.DIRECT_URL = url.toString();
globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
const base = path.join(__dirname, '../dist/src/modules');
const { PrismaService } = require(path.join(base, 'database/prisma.service.js'));
const { DemoService } = require(path.join(base, 'demo/demo.service.js'));
const prisma = new PrismaService();
if (process.argv[2] === 'uncommitted') {
  const transaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (run, options) => transaction(async tx => {
    const result = await run(tx);
    process.send({ event: 'uncommitted' });
    await new Promise(() => {});
    return result;
  }, { ...options, timeout: 30_000 });
}
const client = new Proxy(prisma, {
  get(target, key) {
    if (key === 'promptConfig') return { findFirst: async () => null };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
const ai = { analyzeImage: async () => { process.send({ event: 'model-started' }); return new Promise(() => {}); } };
const service = new DemoService(client, ai);
service.tableReady = true; // No boot hooks or project migrations.
service.analyze({ fingerprint: 'synthetic-device', ip: '192.0.2.10', base64Image: process.argv[3], turnstileToken: 'synthetic-proof' })
  .catch(() => { process.send({ event: 'error' }); process.exitCode = 1; });
