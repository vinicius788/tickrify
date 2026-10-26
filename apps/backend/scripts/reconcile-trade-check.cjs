#!/usr/bin/env node
// Maintenance tool: no application bootstrap, migrations, model or automatic TTL.
const path = require('node:path');

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Inspect: node scripts/reconcile-trade-check.cjs [--check-id UUID]');
    console.log('Release ONLY after verifying execution stopped: --check-id UUID --apply --confirm-execution-stopped');
    return;
  }
  let checkId;
  let apply = false;
  let confirmed = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check-id') checkId = args[++i];
    else if (args[i] === '--apply') apply = true;
    else if (args[i] === '--confirm-execution-stopped') confirmed = true;
    else throw new Error('Invalid arguments');
  }
  if (checkId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(checkId)) throw new Error('Invalid check ID');
  if (apply && (!checkId || !confirmed)) throw new Error('Explicit check ID and stopped-execution confirmation required');
  if (confirmed && !apply) throw new Error('Confirmation requires --apply');
  const { PrismaService } = require(path.join(__dirname, '../dist/src/modules/database/prisma.service.js'));
  const { recoverTradeCheck } = require(path.join(__dirname, '../dist/src/modules/ai/trade-check-control.js'));
  const prisma = new PrismaService();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "userId", "isFree", "cost", "createdAt", "result" = 'null'::jsonb AS "pending"
         FROM "tickrify"."TradeCheck"
        WHERE ($1::text IS NULL AND "result" = 'null'::jsonb) OR "id" = $1::text
        ORDER BY "createdAt" LIMIT 100`, checkId ?? null,
    );
    if (!apply) {
      console.log(JSON.stringify({ mode: 'inspect', reservations: rows }));
    } else {
      const released = await recoverTradeCheck(prisma, checkId);
      console.log(JSON.stringify({ mode: 'apply', checkId, released }));
    }
  } finally { await prisma.$disconnect(); }
}

main().catch(() => {
  // Do not print connection errors that could contain datasource credentials.
  console.error('Trade-check reconciliation failed. Verify arguments and database availability. No release was confirmed.');
  process.exitCode = 1;
});
