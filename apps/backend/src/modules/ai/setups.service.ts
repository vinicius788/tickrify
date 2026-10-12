import { randomUUID } from 'crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { captureServer } from '../../common/analytics/posthog';
import { trackUserActivity } from '../../common/analytics/user-activity';
import { normalizeRecommendation, normalizeSymbol } from '../../common/utils/analysis-normalizer';
import { TICK_COSTS, type AnalysisType } from '../ticks/tick-packages';

/**
 * Setups acompanhados (12/10/2026).
 *
 * Por que existe: o maior buraco do funil e quem para depois da 1a analise, e
 * metade desses tomou WAIT. O WAIT ja diz "Wait for ..." (`entryCondition`),
 * mas nao havia caminho para voltar quando a condicao acontecesse. Seguir um
 * setup guarda esse caminho; atualizar e o fluxo NORMAL de nova analise com o
 * `setupId` junto (mesma cobranca, mesma cota, mesmas travas).
 *
 * Regras que nao se dobram:
 * - Acompanhar nao e entrar: nada aqui toca `userVerdict`, resultado, valor,
 *   diario, /usage nem as consultas publicas. So a tabela TrackedSetup e a
 *   coluna `Analysis.setupId`.
 * - O motor nunca le o `setupId`: prompt, modelo e conteudo da analise iguais.
 * - Deixar de acompanhar e arquivar so mudam o status; nada e apagado.
 * - Tudo por SQL: os campos entram no schema.prisma so depois de a coluna
 *   existir em producao (regra de 05/10, ver a migracao 20261012120000).
 */
export const SETUP_STATUSES = ['tracking', 'untracked', 'archived'] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];

/** Teto de setups acompanhados ao mesmo tempo, por pessoa. */
export const MAX_TRACKING_SETUPS = 20;

const BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."TrackedSetup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rootAnalysisId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'tracking',
    "symbol" TEXT,
    "timeframe" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAnalysisAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "TrackedSetup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrackedSetup_status_check" CHECK ("status" IN ('tracking', 'untracked', 'archived')),
    CONSTRAINT "TrackedSetup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  // Tabela nova e vazia: o indice unico sai junto, e e ele que faz "seguir
  // duas vezes" virar um setup so.
  `CREATE UNIQUE INDEX IF NOT EXISTS "TrackedSetup_rootAnalysisId_key" ON "tickrify"."TrackedSetup"("rootAnalysisId")`,
  `CREATE INDEX IF NOT EXISTS "TrackedSetup_userId_status_lastAnalysisAt_idx" ON "tickrify"."TrackedSetup"("userId", "status", "lastAnalysisAt")`,
  // Coluna nula sem default: so metadado, nao reescreve a tabela. O indice em
  // Analysis NAO sai daqui (trava escrita na tabela mais usada); e SQL manual.
  `ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "setupId" TEXT`,
];

export type SetupSummary = {
  id: string;
  status: SetupStatus;
  symbol: string | null;
  timeframe: string | null;
  rootAnalysisId: string;
  createdAt: Date;
  lastAnalysisAt: Date;
};

/** O que a tela mostra de cada versao. Precos so em BUY/SELL; no WAIT, a condicao. */
export type SetupVersion = {
  analysisId: string;
  version: number;
  createdAt: Date;
  recommendation: 'BUY' | 'SELL' | 'WAIT';
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  entryCondition: string | null;
};

type SetupRow = SetupSummary & { userId: string };

type RawPrisma = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | 'user'>;

// Funcao, nao constante: o worker importa este arquivo e nada pode rodar no import.
const setupColumns = () => Prisma.sql`"id", "userId", "status", "symbol", "timeframe", "rootAnalysisId", "createdAt", "lastAnalysisAt"`;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Simbolo, tempo grafico, precos e condicao de espera, lidos do resultado salvo. */
export function readPlan(result: unknown, recommendation: string | null) {
  const root = record(result);
  const analysis = record(root.analysis);
  const price = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
  const text = (value: unknown, max: number) => {
    const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
    return clean || null;
  };
  const rec = normalizeRecommendation(recommendation ?? root.recommendation);
  const trade = rec === 'BUY' || rec === 'SELL';
  const symbol = normalizeSymbol(analysis.symbol ?? analysis.ticker ?? root.symbol);
  return {
    recommendation: rec,
    symbol: symbol === 'N/A' ? null : symbol.slice(0, 32),
    timeframe: text(analysis.timeframe ?? analysis.period ?? root.timeframe, 16),
    // Card de niveis so em BUY/SELL (mesma regra da tela do resultado): no WAIT
    // os precos seriam de um trade que a IA manda nao fazer.
    entry: trade ? price(analysis.entry) : null,
    stopLoss: trade ? price(analysis.stopLoss) : null,
    takeProfit1: trade ? price(analysis.takeProfit1) : null,
    takeProfit2: trade ? price(analysis.takeProfit2) : null,
    entryCondition: trade ? null : text(analysis.entryCondition, 400),
  };
}

function toSummary(row: SetupRow): SetupSummary {
  return {
    id: row.id,
    status: row.status,
    symbol: row.symbol,
    timeframe: row.timeframe,
    rootAnalysisId: row.rootAnalysisId,
    createdAt: row.createdAt,
    lastAnalysisAt: row.lastAnalysisAt,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const days = (from: Date, to: Date) => Math.round(((to.getTime() - from.getTime()) / DAY_MS) * 10) / 10;

/**
 * Uma versao do setup terminou (fila E caminho sincrono chamam isto depois de
 * gravar `completed`). Atualiza `lastAnalysisAt` e, se nao for a raiz, emite
 * `setup_update_completed`. Best-effort: nunca derruba a analise.
 */
export async function recordSetupVersion(
  prisma: RawPrisma,
  input: { analysisId: string; userId: string; setupId: string; analysisType: AnalysisType; isDemo: boolean },
  log: (message: string) => void = () => undefined,
): Promise<void> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; createdAt: Date; recommendation: string | null }>>`
      SELECT a."id", a."createdAt", a."recommendation"
      FROM "tickrify"."Analysis" a
      WHERE a."setupId" = ${input.setupId} AND a."userId" = ${input.userId} AND a."status" = 'completed'
      ORDER BY a."createdAt" ASC, a."id" ASC
    `;
    const index = rows.findIndex((row) => row.id === input.analysisId);
    if (index < 0) return;
    const current = rows[index];
    await prisma.$executeRaw`
      UPDATE "tickrify"."TrackedSetup"
      SET "lastAnalysisAt" = GREATEST("lastAnalysisAt", ${current.createdAt}), "updatedAt" = NOW()
      WHERE "id" = ${input.setupId} AND "userId" = ${input.userId}
    `;
    if (index === 0) return;
    await trackUserActivity(
      prisma,
      input.userId,
      'setup_update_completed',
      {
        setupId: input.setupId,
        analysisId: input.analysisId,
        version: index + 1,
        daysSinceRoot: days(rows[0].createdAt, current.createdAt),
        daysSinceLast: days(rows[index - 1].createdAt, current.createdAt),
        analysisType: input.analysisType,
        ticksCost: input.isDemo ? 0 : input.analysisType === 'deep' ? TICK_COSTS.ANALYSIS_DEEP : TICK_COSTS.ANALYSIS_QUICK,
        recommendation: normalizeRecommendation(current.recommendation),
      },
      { dedupeKey: `setup_update_completed:${input.analysisId}`, timestamp: current.createdAt },
    );
  } catch (error) {
    log(`[setups] Versao nao registrada (${input.analysisId}): ${error instanceof Error ? error.message : error}`);
  }
}

@Injectable()
export class SetupsService implements OnModuleInit {
  private readonly logger = new Logger(SetupsService.name);
  private ready = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const sql of BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.ready = true;
      this.logger.log('[setups] Tabela e coluna prontas.');
    } catch (error) {
      this.ready = false;
      this.logger.warn(`[setups] Indisponivel (setups desligados): ${error instanceof Error ? error.message : error}`);
    }
  }

  private assertReady() {
    if (!this.ready) {
      throw new ServiceUnavailableException({ code: 'setups_unavailable', message: 'Setups are temporarily unavailable.' });
    }
  }

  private async findOwned(userId: string, setupId: string, db: RawPrisma = this.prisma): Promise<SetupRow | null> {
    const rows = await db.$queryRaw<SetupRow[]>`
      SELECT ${setupColumns()} FROM "tickrify"."TrackedSetup"
      WHERE "id" = ${setupId} AND "userId" = ${userId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /** Um setup por vez por pessoa entra na contagem do teto (dois cliques paralelos nao passam de 20). */
  private async withUserLock<T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`setups:${userId}`}))`;
      return fn(tx);
    });
  }

  private async assertUnderLimit(tx: Prisma.TransactionClient, userId: string) {
    const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS "n" FROM "tickrify"."TrackedSetup"
      WHERE "userId" = ${userId} AND "status" = 'tracking'
    `;
    if (Number(n) >= MAX_TRACKING_SETUPS) {
      throw new ConflictException({
        code: 'setup_limit',
        message: `You follow ${MAX_TRACKING_SETUPS} setups. Archive one to follow this.`,
      });
    }
  }

  /**
   * Seguir a partir de uma analise concluida da propria conta (BUY, SELL ou
   * WAIT). Idempotente: a analise que ja e de um setup devolve esse setup (e o
   * volta a acompanhar se tinha sido largado); seguir duas vezes e um setup so.
   */
  async follow(user: { id: string; clerkUserId?: string }, analysisId: string): Promise<{ setup: SetupSummary }> {
    this.assertReady();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; status: string; createdAt: Date; recommendation: string | null; result: unknown; setupId: string | null }>
    >`
      SELECT "id", "status", "createdAt", "recommendation", "result", "setupId"
      FROM "tickrify"."Analysis"
      WHERE "id" = ${analysisId} AND "userId" = ${user.id}
      LIMIT 1
    `;
    const analysis = rows[0];
    if (!analysis || analysis.status !== 'completed') throw new NotFoundException({ code: 'analysis_not_found' });
    const plan = readPlan(analysis.result, analysis.recommendation);

    const { setup, changed } = await this.withUserLock(user.id, async (tx) => {
      const existing =
        (analysis.setupId ? await this.findOwned(user.id, analysis.setupId, tx) : null) ??
        (
          await tx.$queryRaw<SetupRow[]>`
            SELECT ${setupColumns()} FROM "tickrify"."TrackedSetup"
            WHERE "rootAnalysisId" = ${analysisId} AND "userId" = ${user.id}
            LIMIT 1
          `
        )[0] ??
        null;
      if (existing) {
        if (existing.status === 'tracking') return { setup: existing, changed: false };
        await this.assertUnderLimit(tx, user.id);
        await tx.$executeRaw`
          UPDATE "tickrify"."TrackedSetup"
          SET "status" = 'tracking', "archivedAt" = NULL, "updatedAt" = NOW()
          WHERE "id" = ${existing.id} AND "userId" = ${user.id}
        `;
        return { setup: { ...existing, status: 'tracking' as const }, changed: true };
      }

      await this.assertUnderLimit(tx, user.id);
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "tickrify"."TrackedSetup"
          ("id", "userId", "rootAnalysisId", "status", "symbol", "timeframe", "createdAt", "updatedAt", "lastAnalysisAt")
        VALUES (${id}, ${user.id}, ${analysisId}, 'tracking', ${plan.symbol}, ${plan.timeframe}, NOW(), NOW(), ${analysis.createdAt})
        ON CONFLICT ("rootAnalysisId") DO NOTHING
      `;
      await tx.$executeRaw`
        UPDATE "tickrify"."Analysis" SET "setupId" = ${id}
        WHERE "id" = ${analysisId} AND "userId" = ${user.id} AND "setupId" IS NULL
      `;
      const created = await this.findOwned(user.id, id, tx);
      if (!created) throw new ConflictException({ code: 'setup_conflict' });
      return { setup: created, changed: true };
    });

    if (changed && user.clerkUserId) {
      captureServer(user.clerkUserId, 'setup_followed', {
        setupId: setup.id,
        rootAnalysisId: setup.rootAnalysisId,
        recommendation: plan.recommendation,
        symbol: plan.symbol,
        timeframe: plan.timeframe,
      });
    }
    return { setup: toSummary(setup) };
  }

  /** Deixar de acompanhar ou arquivar. So muda o status; versoes e analises ficam. */
  async setStatus(
    user: { id: string; clerkUserId?: string },
    setupId: string,
    status: 'untracked' | 'archived',
  ): Promise<{ setup: SetupSummary }> {
    this.assertReady();
    const existing = await this.findOwned(user.id, setupId);
    if (!existing) throw new NotFoundException({ code: 'setup_not_found' });
    if (existing.status === status) return { setup: toSummary(existing) };
    await this.prisma.$executeRaw`
      UPDATE "tickrify"."TrackedSetup"
      SET "status" = ${status}, "archivedAt" = ${status === 'archived' ? new Date() : null}, "updatedAt" = NOW()
      WHERE "id" = ${setupId} AND "userId" = ${user.id}
    `;
    if (user.clerkUserId) {
      captureServer(user.clerkUserId, status === 'archived' ? 'setup_archived' : 'setup_unfollowed', { setupId });
    }
    return { setup: toSummary({ ...existing, status }) };
  }

  /**
   * Setups acompanhados, do mais recente para o mais antigo, com a ultima
   * versao concluida de cada um. Cursor = id do ultimo setup recebido; cursor
   * que nao e da pessoa (ou ja largado) encerra a lista.
   */
  async list(userId: string, cursor: string | null, limit = 20) {
    this.assertReady();
    const take = Math.max(1, Math.min(50, Math.floor(limit) || 20));
    let after = Prisma.empty;
    if (cursor) {
      const anchor = await this.findOwned(userId, cursor);
      if (!anchor || anchor.status !== 'tracking') return { items: [], nextCursor: null };
      after = Prisma.sql`AND (s."lastAnalysisAt", s."id") < (${anchor.lastAnalysisAt}, ${anchor.id})`;
    }
    const rows = await this.prisma.$queryRaw<
      Array<SetupRow & { versions: number; latestAnalysisId: string | null; latestAt: Date | null; latestRecommendation: string | null; latestResult: unknown }>
    >`
      SELECT s."id", s."userId", s."status", s."symbol", s."timeframe", s."rootAnalysisId", s."createdAt", s."lastAnalysisAt",
        l."id" AS "latestAnalysisId", l."createdAt" AS "latestAt", l."recommendation" AS "latestRecommendation", l."result" AS "latestResult",
        (SELECT COUNT(*)::int FROM "tickrify"."Analysis" v
          WHERE v."setupId" = s."id" AND v."userId" = s."userId" AND v."status" = 'completed') AS "versions"
      FROM "tickrify"."TrackedSetup" s
      LEFT JOIN LATERAL (
        SELECT a."id", a."createdAt", a."recommendation", a."result"
        FROM "tickrify"."Analysis" a
        WHERE a."setupId" = s."id" AND a."userId" = s."userId" AND a."status" = 'completed'
        ORDER BY a."createdAt" DESC, a."id" DESC
        LIMIT 1
      ) l ON TRUE
      WHERE s."userId" = ${userId} AND s."status" = 'tracking' ${after}
      ORDER BY s."lastAnalysisAt" DESC, s."id" DESC
      LIMIT ${take + 1}
    `;
    const page = rows.slice(0, take);
    return {
      items: page.map((row) => {
        const plan = readPlan(row.latestResult, row.latestRecommendation);
        return {
          ...toSummary(row),
          versions: Number(row.versions) || 0,
          latest: row.latestAnalysisId
            ? {
                analysisId: row.latestAnalysisId,
                createdAt: row.latestAt,
                recommendation: plan.recommendation,
                entryCondition: plan.entryCondition,
              }
            : null,
        };
      }),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  /**
   * Um setup com as versoes (mais nova primeiro), numeradas na ordem em que
   * aconteceram. `readableIds` (gratis esgotado) limita as versoes as analises
   * que continuam abertas para leitura.
   */
  async get(
    userId: string,
    setupId: string,
    options: { cursor?: string | null; limit?: number; readableIds?: string[] | null } = {},
  ): Promise<{ setup: SetupSummary; versions: SetupVersion[]; nextCursor: string | null }> {
    this.assertReady();
    const setup = await this.findOwned(userId, setupId);
    if (!setup) throw new NotFoundException({ code: 'setup_not_found' });
    const take = Math.max(1, Math.min(50, Math.floor(options.limit ?? 20) || 20));
    const readable = options.readableIds;
    if (readable && readable.length === 0) return { setup: toSummary(setup), versions: [], nextCursor: null };

    let after = Prisma.empty;
    if (options.cursor) {
      const anchor = await this.prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
        SELECT "id", "createdAt" FROM "tickrify"."Analysis"
        WHERE "id" = ${options.cursor} AND "userId" = ${userId} AND "setupId" = ${setupId}
        LIMIT 1
      `;
      if (!anchor[0]) return { setup: toSummary(setup), versions: [], nextCursor: null };
      after = Prisma.sql`AND (v."createdAt", v."id") < (${anchor[0].createdAt}, ${anchor[0].id})`;
    }
    const onlyReadable = readable ? Prisma.sql`AND v."id" IN (${Prisma.join(readable)})` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; createdAt: Date; recommendation: string | null; result: unknown; version: number }>
    >`
      WITH v AS (
        SELECT a."id", a."createdAt", a."recommendation", a."result",
          ROW_NUMBER() OVER (ORDER BY a."createdAt" ASC, a."id" ASC)::int AS "version"
        FROM "tickrify"."Analysis" a
        WHERE a."setupId" = ${setupId} AND a."userId" = ${userId} AND a."status" = 'completed'
      )
      SELECT v."id", v."createdAt", v."recommendation", v."result", v."version" FROM v
      WHERE TRUE ${after} ${onlyReadable}
      ORDER BY v."createdAt" DESC, v."id" DESC
      LIMIT ${take + 1}
    `;
    const page = rows.slice(0, take);
    return {
      setup: toSummary(setup),
      versions: page.map((row) => {
        const plan = readPlan(row.result, row.recommendation);
        return {
          analysisId: row.id,
          version: Number(row.version),
          createdAt: row.createdAt,
          recommendation: plan.recommendation,
          entry: plan.entry,
          stopLoss: plan.stopLoss,
          takeProfit1: plan.takeProfit1,
          takeProfit2: plan.takeProfit2,
          entryCondition: plan.entryCondition,
        };
      }),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  /** O setup de uma analise da propria conta, ou null (a tela do resultado decide o botao). */
  async findForAnalysis(userId: string, analysisId: string): Promise<{ setup: SetupSummary | null }> {
    this.assertReady();
    const rows = await this.prisma.$queryRaw<SetupRow[]>`
      SELECT s."id", s."userId", s."status", s."symbol", s."timeframe", s."rootAnalysisId", s."createdAt", s."lastAnalysisAt"
      FROM "tickrify"."Analysis" a
      JOIN "tickrify"."TrackedSetup" s ON s."id" = a."setupId" AND s."userId" = a."userId"
      WHERE a."id" = ${analysisId} AND a."userId" = ${userId}
      LIMIT 1
    `;
    return { setup: rows[0] ? toSummary(rows[0]) : null };
  }

  /**
   * Antes de cobrar uma atualizacao: o setup tem de ser da pessoa (alheio =
   * 404, igual a inexistente) e estar sendo acompanhado (largado/arquivado =
   * 409). Nunca vincula nada aqui.
   */
  async assertUpdatable(userId: string, setupId: string): Promise<void> {
    this.assertReady();
    const setup = await this.findOwned(userId, setupId);
    if (!setup) throw new NotFoundException({ code: 'setup_not_found', message: 'Setup not found.' });
    if (setup.status !== 'tracking') {
      throw new ConflictException({ code: 'setup_not_tracking', message: 'This setup is no longer followed.' });
    }
  }

  /** Marca a analise recem-criada como versao do setup. Nunca lanca: a analise segue igual. */
  async linkAnalysis(userId: string, analysisId: string, setupId: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "tickrify"."Analysis" SET "setupId" = ${setupId}
        WHERE "id" = ${analysisId} AND "userId" = ${userId}
          AND EXISTS (
            SELECT 1 FROM "tickrify"."TrackedSetup" s
            WHERE s."id" = ${setupId} AND s."userId" = ${userId} AND s."status" = 'tracking'
          )
      `;
    } catch (error) {
      this.logger.warn(`[setups] Vinculo nao gravado (${analysisId}): ${error instanceof Error ? error.message : error}`);
    }
  }
}
