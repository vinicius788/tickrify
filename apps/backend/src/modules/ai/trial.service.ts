import { HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { flagBool } from '../../common/flags/feature-flags';
import { fetchClerkProfile } from '../../common/utils/clerk-email';
import { getFreeQuota, hadEndedSubscription } from '../../common/free-quota';
import {
  TRIAL_RULES,
  USER_EMAIL_NORMALIZED_SQL,
  isDisposableEmail,
  isRepeatEmailAccount,
  readTrial,
  validTimezone,
  type TrialRow,
  type TrialState,
} from '../../common/trial';
import { syncTrial, trackTrialDenied, trackTrialPaywallShown, trackTrialStarted } from '../../common/analytics/trial-funnel';

/**
 * Trial de 3 dias sem cartao (13/10/2026). Regras e estado em common/trial.ts;
 * aqui fica o que precisa do Nest: tabela no boot, concessao (com anti-abuso),
 * teto de gasto diario, print repetido, conversao e reativacao.
 *
 * Chaves no /admin, todas DESLIGADAS por padrao:
 * - TRIAL_MODE: conta sem nenhuma analise gratis ganha o trial na 1a visita
 *   ao painel. Quem ja usou a regra antiga continua nela (ninguem perde nada).
 * - TRIAL_REACTIVATION: libera o envio (com confirmacao) do trial para quem
 *   esgotou a regra antiga e nunca assinou.
 */

const BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."UserTrial" (
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "convertedAt" TIMESTAMP(3),
    "dayAtConversion" INTEGER,
    "usageDays" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "analysesToday" INTEGER NOT NULL DEFAULT 0,
    "todayDate" TEXT,
    "source" TEXT NOT NULL DEFAULT 'signup',
    "denyReason" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserTrial_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "UserTrial_status_check" CHECK ("status" IN ('active', 'ended_converted', 'ended_unconverted', 'denied')),
    CONSTRAINT "UserTrial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS "UserTrial_status_startedAt_idx" ON "tickrify"."UserTrial"("status", "startedAt")',
  'CREATE INDEX IF NOT EXISTS "UserTrial_ipHash_startedAt_idx" ON "tickrify"."UserTrial"("ipHash", "startedAt")',
  // Print repetido no trial: mesma imagem devolve a leitura anterior, sem IA.
  'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "imageSha256" TEXT',
  // E-mail repetido (conta recriada com o mesmo e-mail): coluna gerada + indice.
  ...USER_EMAIL_NORMALIZED_SQL,
];

/** Recusa do trial, em forma que o front traduz (codigo estavel + texto em ingles). */
export function trialError(code: string, message: string, status = HttpStatus.FORBIDDEN): HttpException {
  return new HttpException({ code, message }, status);
}

export const TRIAL_ERRORS = {
  dailyLimit: () => trialError('TRIAL_DAILY_LIMIT', 'You have used today\'s analyses. Come back tomorrow or subscribe now.'),
  ended: () => trialError('TRIAL_ENDED', 'Your free trial has ended. Subscribe to keep analyzing.'),
  busy: () =>
    trialError(
      'TRIAL_BUSY',
      'Free trial analyses are in high demand right now. Please try again in a little while.',
      HttpStatus.SERVICE_UNAVAILABLE,
    ),
  emailNotAllowed: () =>
    trialError('TRIAL_EMAIL_NOT_ALLOWED', 'Please sign up with a permanent email address to start your free trial.'),
  emailUnverified: () => trialError('TRIAL_EMAIL_UNVERIFIED', 'Please verify your email address to start your free trial.'),
  networkLimit: () =>
    trialError(
      'TRIAL_NETWORK_LIMIT',
      'Too many new trials from this network today. Please try again tomorrow.',
      HttpStatus.TOO_MANY_REQUESTS,
    ),
};

@Injectable()
export class TrialService implements OnModuleInit {
  private readonly logger = new Logger(TrialService.name);
  private ready = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const sql of BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.ready = true;
      this.logger.log(`[trial] Tabela pronta. Modo trial: ${flagBool('TRIAL_MODE') ? 'LIGADO' : 'desligado'}.`);
    } catch (error) {
      this.logger.warn(`[trial] Tabela indisponivel (trial desligado): ${error instanceof Error ? error.message : error}`);
    }
  }

  async read(userId: string): Promise<TrialRow | null> {
    if (!this.ready) return null;
    return readTrial(this.prisma, userId);
  }

  /**
   * Garante o trial de quem tem direito, antes do /usage e de cada analise de
   * quem nao assina. Sem TRIAL_MODE, ou para quem ja usou a regra antiga, nao
   * faz nada. Lanca o erro de anti-abuso quando nao da para conceder.
   */
  async ensure(userId: string, ctx: { ip?: string | null; timezone?: string | null } = {}): Promise<TrialRow | null> {
    if (!this.ready) return null;
    const existing = await readTrial(this.prisma, userId);
    const tz = validTimezone(ctx.timezone);
    if (existing) {
      // Repetida cai no paywall normal (cota zero em getFreeQuota), sem mensagem de e-mail.
      if (existing.status === 'denied') {
        if (existing.denyReason === 'repeat_email') return null;
        throw TRIAL_ERRORS.emailNotAllowed();
      }
      if (tz && !existing.timezone) {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "tickrify"."UserTrial" SET "timezone" = $2, "updatedAt" = NOW() WHERE "userId" = $1 AND "timezone" IS NULL',
          userId,
          tz,
        );
        existing.timezone = tz;
      }
      return existing;
    }
    if (!flagBool('TRIAL_MODE')) return null;

    // So quem nunca usou uma analise gratis entra no trial.
    const used = await this.prisma.analysis.count({ where: { userId, isDemo: true, status: { not: 'failed' } } });
    if (used > 0) return null;
    // Ex-assinante nao ganha trial depois de cancelar: cai no modo leitura.
    if (await hadEndedSubscription(this.prisma, userId)) return null;
    // Mesmo e-mail (normalizado) ja usou o produto em conta mais antiga: sem trial.
    if (await isRepeatEmailAccount(this.prisma, userId)) {
      await this.insert(userId, { tz, ipHash: null, status: 'denied', denyReason: 'repeat_email', source: 'signup' });
      this.logger.log(`[trial] repeat_email user=${userId}`);
      void trackTrialDenied(this.prisma, userId, 'repeat_email');
      return null;
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, clerkUserId: true } });
    if (!user) return null;
    if (isDisposableEmail(user.email)) {
      await this.insert(userId, { tz, ipHash: null, status: 'denied', denyReason: 'disposable_email', source: 'signup' });
      this.logger.log(`[trial] Negado (e-mail descartavel) user=${userId}`);
      throw TRIAL_ERRORS.emailNotAllowed();
    }
    // Clerk fora do ar ou sem resposta (null) nao pune ninguem.
    const profile = user.clerkUserId ? await fetchClerkProfile(user.clerkUserId) : null;
    if (profile?.emailVerified === false) throw TRIAL_ERRORS.emailUnverified();

    const ipHash = ctx.ip ? createHash('sha256').update(`tickrify-trial|${ctx.ip}`).digest('hex').slice(0, 32) : null;
    if (ipHash) {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
        `SELECT COUNT(*) AS n FROM "tickrify"."UserTrial" WHERE "ipHash" = $1 AND "startedAt" > NOW() - INTERVAL '24 hours'`,
        ipHash,
      );
      if (Number(rows[0]?.n ?? 0) >= TRIAL_RULES.maxNewTrialsPerIpPerDay) {
        this.logger.log(`[trial] Limite de rede atingido user=${userId}`);
        throw TRIAL_ERRORS.networkLimit();
      }
    }

    const row = await this.insert(userId, { tz, ipHash, status: 'active', denyReason: null, source: 'signup' });
    if (row) void trackTrialStarted(this.prisma, userId, 'signup', row.startedAt);
    return row;
  }

  private async insert(
    userId: string,
    data: { tz: string | null; ipHash: string | null; status: 'active' | 'denied'; denyReason: string | null; source: TrialRow['source'] },
  ): Promise<TrialRow | null> {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "tickrify"."UserTrial" ("userId", "timezone", "ipHash", "status", "denyReason", "source")
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ("userId") DO NOTHING`,
      userId,
      data.tz,
      data.ipHash,
      data.status,
      data.denyReason,
      data.source,
    );
    return readTrial(this.prisma, userId);
  }

  /** Estado atual (sem gravar nada). null = sem trial. */
  async state(userId: string): Promise<TrialState | null> {
    return (await getFreeQuota(this.prisma, userId)).trial;
  }

  /** Grava o retrato e emite os eventos do que mudou (fim de analise, /usage). */
  sync(userId: string): Promise<TrialState | null> {
    return syncTrial(this.prisma, userId);
  }

  /** O paywall do trial esta na tela da pessoa (ou a analise foi recusada por ele). */
  paywallShown(userId: string, state: TrialState): void {
    if (state.paywall) void trackTrialPaywallShown(this.prisma, userId, state, state.paywall);
  }

  /** Erro certo para um trial bloqueado. */
  blockedError(state: TrialState): HttpException {
    return state.status === 'ended' ? TRIAL_ERRORS.ended() : TRIAL_ERRORS.dailyLimit();
  }

  // ── Teto de gasto diario ──────────────────────────────────────────────────

  /**
   * Gasto estimado com analises de trial hoje (UTC). Passou do teto: avisa o
   * dono (1x por dia: log, /admin e e-mail ao suporte) e devolve uma mensagem
   * de fila em vez de quebrar.
   */
  async assertSpendCapacity(): Promise<void> {
    if (!this.ready) return;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
      `SELECT COUNT(*) AS n FROM "tickrify"."Analysis" a
         JOIN "tickrify"."UserTrial" t ON t."userId" = a."userId"
        WHERE a."isDemo" = true AND a."status" <> 'failed'
          AND a."createdAt" >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
    );
    const count = Number(rows[0]?.n ?? 0);
    const spent = count * TRIAL_RULES.estimatedCostPerAnalysisUsd;
    if (spent < TRIAL_RULES.dailySpendCapUsd) return;
    await this.alertSpendCap(count, spent);
    throw TRIAL_ERRORS.busy();
  }

  private async alertSpendCap(count: number, spent: number): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const action = `trial:spend_cap:${day}`;
    try {
      const already = await this.prisma.adminAudit.findFirst({ where: { action }, select: { id: true } });
      if (already) return;
      await this.prisma.adminAudit.create({ data: { action, details: { count, estimatedUsd: Number(spent.toFixed(2)) } } });
      this.logger.warn(
        `[trial] ALERTA teto de gasto do trial atingido: ${count} analises hoje, ~US$ ${spent.toFixed(2)} (teto US$ ${TRIAL_RULES.dailySpendCapUsd}). Novas analises de trial pausadas ate a virada UTC.`,
      );
      await this.mail.sendOwnerAlert(
        '[Tickrify] Teto de gasto do trial atingido',
        `<p><b>${count}</b> analises de trial hoje (UTC), ~US$ ${spent.toFixed(2)} estimados. O teto e US$ ${TRIAL_RULES.dailySpendCapUsd}.</p>
<p>Novas analises de trial mostram uma mensagem de fila ate a virada do dia UTC. Assinantes nao sao afetados.</p>
<p>Para mudar o teto: TRIAL_RULES.dailySpendCapUsd em apps/backend/src/common/trial.ts.</p>`,
      );
    } catch (error) {
      this.logger.warn(`[trial] Alerta de teto nao registrado: ${error instanceof Error ? error.message : error}`);
    }
  }

  // ── Print repetido ────────────────────────────────────────────────────────

  static imageHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /** Mesma pessoa, mesmo print, concluido na janela: id da leitura anterior. */
  async findDuplicate(userId: string, hash: string): Promise<string | null> {
    if (!this.ready) return null;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "tickrify"."Analysis"
        WHERE "userId" = $1 AND "imageSha256" = $2 AND "status" = 'completed'
          AND "createdAt" > NOW() - ($3 || ' hours')::interval
        ORDER BY "createdAt" DESC LIMIT 1`,
      userId,
      hash,
      String(TRIAL_RULES.duplicateChartWindowHours),
    );
    return rows[0]?.id ?? null;
  }

  async saveImageHash(analysisId: string, hash: string): Promise<void> {
    if (!this.ready) return;
    try {
      await this.prisma.$executeRawUnsafe('UPDATE "tickrify"."Analysis" SET "imageSha256" = $2 WHERE "id" = $1', analysisId, hash);
    } catch {
      /* so serve ao cache do trial */
    }
  }

  // ── Reativacao (TRIAL_REACTIVATION) ───────────────────────────────────────

  /**
   * Quem esgotou a regra antiga, nunca assinou e nao tem trial. So conta e
   * lista; nao concede nada.
   */
  async reactivationCandidates(limit = 500): Promise<Array<{ id: string; email: string | null }>> {
    if (!this.ready) return [];
    const users = await this.prisma.$queryRawUnsafe<Array<{ id: string; email: string | null }>>(
      `SELECT u."id", u."email" FROM "tickrify"."User" u
        WHERE NOT EXISTS (SELECT 1 FROM "tickrify"."UserTrial" t WHERE t."userId" = u."id")
          AND NOT EXISTS (SELECT 1 FROM "tickrify"."Subscription" s WHERE s."userId" = u."id")
          AND COALESCE(u."role", '') <> 'admin'
          AND EXISTS (SELECT 1 FROM "tickrify"."Analysis" a WHERE a."userId" = u."id" AND a."isDemo" = true AND a."status" = 'completed')
        ORDER BY u."createdAt" DESC LIMIT ${Math.max(1, Math.min(2000, Math.floor(limit)))}`,
    );
    const out: Array<{ id: string; email: string | null }> = [];
    for (const user of users) {
      const quota = await getFreeQuota(this.prisma, user.id);
      if (quota.settledExhausted && !isDisposableEmail(user.email)) out.push(user);
    }
    return out;
  }

  /** Concede o trial (sem enviar nada). Exige TRIAL_REACTIVATION ligada. */
  async grantReactivation(userIds: string[]): Promise<number> {
    if (!this.ready || !flagBool('TRIAL_REACTIVATION')) return 0;
    let granted = 0;
    for (const userId of userIds) {
      const row = await this.insert(userId, { tz: null, ipHash: null, status: 'active', denyReason: null, source: 'reactivation' });
      if (row?.source === 'reactivation' && row.status === 'active') {
        granted++;
        void trackTrialStarted(this.prisma, userId, 'reactivation', row.startedAt);
      }
    }
    this.logger.log(`[trial] Reativacao: trial concedido a ${granted} de ${userIds.length}.`);
    return granted;
  }
}
