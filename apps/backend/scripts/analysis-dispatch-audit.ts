#!/usr/bin/env ts-node
/** Read-only audit of old pending/processing analyses and their BullMQ jobs. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getAiQueue } from '../src/modules/ai/ai.queue';
import { resolvePrismaDatasourceUrl } from '../src/modules/database/prisma.datasource';
import { inspectAnalysisDispatch } from '../src/modules/ai/analysis-dispatch-audit';

class UsageError extends Error {}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function integerOption(name: string, fallback: number, maximum: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new UsageError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

async function main(): Promise<void> {
  const sinceRaw = option('--since');
  const isUtcIso = typeof sinceRaw === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(sinceRaw);
  const since = isUtcIso ? new Date(sinceRaw) : null;
  if (!since || !Number.isFinite(since.getTime()) || since.getTime() >= Date.now()) {
    throw new UsageError('--since requires a past ISO timestamp for the release with stable job IDs');
  }
  const minAgeMinutes = integerOption('--min-age-minutes', 10, 1440);
  const limit = integerOption('--limit', 100, 500);
  const cutoff = new Date(Date.now() - minAgeMinutes * 60_000);
  if (since >= cutoff) {
    throw new UsageError('--since must be earlier than the minimum-age cutoff');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: resolvePrismaDatasourceUrl() }),
  });
  const queue = getAiQueue();
  if (!queue) {
    await prisma.$disconnect();
    throw new Error('Redis queue is not configured');
  }

  try {
    const rows = await prisma.analysis.findMany({
      where: {
        status: { in: ['pending', 'processing'] },
        createdAt: { gte: since, lte: cutoff },
      },
      select: { id: true, status: true, isDemo: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    const findings = await inspectAnalysisDispatch(rows, async (analysisId) => {
      const job = await queue.getJob(analysisId);
      if (!job) return null;
      return { state: await job.getState(), analysisId: job.data?.analysisId };
    });
    const summary = {
      scanned: findings.length,
      present: findings.filter((finding) => finding.assessment === 'present').length,
      review: findings.filter((finding) => finding.assessment === 'review').length,
      lookupError: findings.filter((finding) => finding.assessment === 'lookup_error').length,
      truncated: rows.length === limit,
    };
    process.stdout.write(`${JSON.stringify({ since: since.toISOString(), cutoff: cutoff.toISOString(), summary })}\n`);
    for (const finding of findings) process.stdout.write(`${JSON.stringify(finding)}\n`);
  } finally {
    await Promise.allSettled([prisma.$disconnect(), queue.close()]);
  }
}

void main().catch((error: unknown) => {
  // Connection errors can contain credentials; keep stdout/stderr categorical.
  process.stderr.write(error instanceof UsageError
    ? `${error.message}\n`
    : 'Dispatch audit could not finish. Check DB/Redis connectivity.\n');
  process.exitCode = 1;
});
