#!/usr/bin/env node
// Maintenance tool: no application bootstrap, migrations, model or automatic TTL.
const path = require('node:path');

async function main() {
  const [command = 'status', ...args] = process.argv.slice(2);
  if (!['status', 'pause', 'open', 'release'].includes(command)) throw new Error('Invalid command');
  let id;
  if (command === 'release') {
    if (args.length !== 3 || args[0] !== '--id' || args[2] !== '--confirm-execution-stopped') throw new Error('Usage: release --id UUID --confirm-execution-stopped');
    id = args[1];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid reservation ID');
  } else if (args.length) throw new Error('Unexpected arguments');
  const { PrismaService } = require(path.join(__dirname, '../dist/src/modules/database/prisma.service.js'));
  const control = require(path.join(__dirname, '../dist/src/modules/demo/demo-control.js'));
  const prisma = new PrismaService();
  try {
    if (command === 'pause') await control.pauseDemo(prisma);
    if (command === 'open') await control.openDemo(prisma);
    const released = command === 'release' ? await control.releaseDemoReservation(prisma, id) : undefined;
    console.log(JSON.stringify({ ...(await control.demoStatus(prisma)), ...(id ? { id, released } : {}) }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Demo control failed; no operation was confirmed.'); process.exitCode = 1; });
