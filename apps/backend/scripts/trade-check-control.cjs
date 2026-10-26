#!/usr/bin/env node
const path = require('node:path');
async function main() {
  const [command = 'status', ...flags] = process.argv.slice(2);
  if (!['status', 'pause', 'open'].includes(command) || flags.some((f) => f !== '--confirm-bootstrap-retired')) throw new Error('Invalid command');
  if (command === 'open' && !flags.includes('--confirm-bootstrap-retired')) throw new Error('Verify retirement of the bootstrap version first');
  if (command !== 'open' && flags.length) throw new Error('Unexpected confirmation');
  const { PrismaService } = require(path.join(__dirname, '../dist/src/modules/database/prisma.service.js'));
  const { tradeCheckStatus, pauseTradeChecks, openTradeChecks } = require(path.join(__dirname, '../dist/src/modules/ai/trade-check-control.js'));
  const prisma = new PrismaService();
  try {
    if (command === 'pause') await pauseTradeChecks(prisma);
    if (command === 'open') await openTradeChecks(prisma);
    console.log(JSON.stringify(await tradeCheckStatus(prisma)));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Trade-check control failed; no operation was confirmed.'); process.exitCode = 1; });
