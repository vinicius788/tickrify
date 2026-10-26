import { ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';

/**
 * Pausa da demo na tabela FeatureFlag existente (linha `ops.demo.v1`, fora do
 * catalogo do /admin). Linha ausente ou invalida = demo fechada: a versao nova
 * so admite reservas depois de `open`, entao nunca escreve ao lado de uma
 * versao antiga ainda drenando.
 */
const KEY = 'ops.demo.v1';
type State = { version: 1; paused: boolean };

export const demoPausedError = () =>
  new ServiceUnavailableException({
    code: 'demo_paused',
    message: 'The free demo is temporarily paused. Please try again shortly.',
  });

function parse(value: string | undefined): State | null {
  try {
    const state = JSON.parse(value ?? '');
    return state?.version === 1 && typeof state.paused === 'boolean' ? state : null;
  } catch {
    return null;
  }
}

/** Dentro da transacao da reserva. O FOR SHARE faz a pausa esperar quem ja
 * passou daqui: depois que a pausa confirma, as reservas pendentes sao todas
 * as que faltam drenar. */
export async function assertDemoOpen(tx: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "tickrify"."FeatureFlag" WHERE "key" = ${KEY} FOR SHARE
  `;
  const state = parse(rows[0]?.value);
  if (!state || state.paused) throw demoPausedError();
}

async function lock(tx: Prisma.TransactionClient): Promise<State | null> {
  const rows = await tx.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "tickrify"."FeatureFlag" WHERE "key" = ${KEY} FOR UPDATE
  `;
  return rows[0] ? parse(rows[0].value) : null;
}

async function save(tx: Prisma.TransactionClient, paused: boolean): Promise<void> {
  await tx.$executeRaw`
    UPDATE "tickrify"."FeatureFlag" SET "value" = ${JSON.stringify({ version: 1, paused })}, "updatedAt" = NOW()
    WHERE "key" = ${KEY}
  `;
}

async function pendingCount(client: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<number> {
  const [row] = await client.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM "tickrify"."DemoUsage" WHERE "result" = 'null'::jsonb
  `;
  return row?.n ?? 0;
}

export async function pauseDemo(prisma: PrismaService): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "tickrify"."FeatureFlag" ("key", "value", "updatedAt")
      VALUES (${KEY}, ${JSON.stringify({ version: 1, paused: true })}, NOW())
      ON CONFLICT ("key") DO NOTHING
    `;
    await lock(tx);
    await save(tx, true);
  });
}

/** Recusa abrir com reserva pendente: cada uma precisa de conferencia antes. */
export async function openDemo(prisma: PrismaService): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (!(await lock(tx))) throw new Error('Pause the demo before opening it.');
    if (await pendingCount(tx)) throw new Error('Demo reservations are still pending.');
    await save(tx, false);
  });
}

export async function demoStatus(prisma: PrismaService) {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "tickrify"."FeatureFlag" WHERE "key" = ${KEY}
  `;
  const pending = await prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
    SELECT "id", "createdAt" FROM "tickrify"."DemoUsage" WHERE "result" = 'null'::jsonb ORDER BY "createdAt" LIMIT 100
  `;
  const state = parse(rows[0]?.value);
  return { initialized: Boolean(rows[0]), paused: state?.paused ?? true, pending };
}

/** So com a demo pausada e a execucao dona da reserva comprovadamente parada.
 * Nunca apaga resultado concluido. */
export async function releaseDemoReservation(prisma: PrismaService, id: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const state = await lock(tx);
    if (!state?.paused) throw new Error('Pause the demo before releasing a reservation.');
    const deleted = await tx.$executeRaw`
      DELETE FROM "tickrify"."DemoUsage" WHERE "id" = ${id} AND "result" = 'null'::jsonb
    `;
    return deleted === 1;
  });
}
