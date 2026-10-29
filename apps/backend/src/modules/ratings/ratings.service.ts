import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { captureServer } from '../../common/analytics/posthog';
import { storedSignalState } from '../../common/utils/signal-decision';
import { RATING_REASONS, USEFULNESS_REASONS } from './dto/ratings.dto';

/**
 * Nota por analise (estrelas abaixo do resultado) e depoimento com licenca
 * (07/10/2026). Existe porque o site nao tinha nenhuma prova social real e o
 * e-mail para os assinantes nao trazia resposta: o pedido acontece dentro do
 * painel, logo depois de a pessoa usar.
 *
 * Regra que nao se dobra: o site so mostra o que o proprio assinante autorizou
 * (`quoteConsent`) e o admin aprovou (`published`). Nada e inventado.
 */
const BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."AnalysisRating" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "reasons" JSONB,
    "comment" TEXT,
    "quoteConsent" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "country" TEXT,
    "recommendation" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnalysisRating_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AnalysisRating_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "AnalysisRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AnalysisRating_userId_analysisId_key" ON "tickrify"."AnalysisRating"("userId", "analysisId")`,
  `CREATE INDEX IF NOT EXISTS "AnalysisRating_published_createdAt_idx" ON "tickrify"."AnalysisRating"("published", "createdAt")`,
];

// Historical star rows use SQL NULL, JSON null, or a reason array. Binary rows use an object.
const STAR_RATINGS_ONLY: Prisma.AnalysisRatingWhereInput = {
  OR: [{ reasons: { equals: Prisma.DbNull } }, { reasons: { equals: Prisma.JsonNull } }, { reasons: { array_contains: [] } }],
};

const TESTIMONIAL_LIMIT = 6;
const TESTIMONIAL_CACHE_MS = 5 * 60 * 1000;

export type Testimonial = { comment: string; displayName: string | null; country: string | null };

function clean(text: string | null | undefined, max: number): string | null {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return value || null;
}

type UsefulnessData = {
  kind: 'usefulness'; version: 1; useful: boolean;
  modality: 'trial' | 'legacy' | 'free' | 'paid';
  verdict: string; reasons: string[];
};

function usefulnessData(value: unknown): UsefulnessData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as UsefulnessData;
  return data.kind === 'usefulness' && data.version === 1 && typeof data.useful === 'boolean' ? data : null;
}

@Injectable()
export class RatingsService implements OnModuleInit {
  private readonly logger = new Logger(RatingsService.name);
  private ready = false;
  private cache: { at: number; items: Testimonial[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const sql of BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.ready = true;
      this.logger.log('[ratings] Tabela pronta.');
    } catch (error) {
      this.logger.error('[ratings] Nao consegui garantir a tabela AnalysisRating; notas desligadas.', error);
    }
  }

  private assertReady() {
    if (!this.ready) throw new BadRequestException({ code: 'ratings_unavailable' });
  }

  /** Estrelas: uma nota por analise da propria conta (tocar de novo troca a nota). */
  async rate(user: { id: string; clerkUserId?: string }, analysisId: string, rating: number): Promise<{ id: string }> {
    this.assertReady();
    const analysis = await this.prisma.analysis.findFirst({
      where: { id: analysisId, userId: user.id, status: 'completed', isDemo: false },
      select: { recommendation: true },
    });
    if (!analysis) throw new NotFoundException({ code: 'analysis_not_found' });

    const saved = await this.prisma.analysisRating.upsert({
      where: { userId_analysisId: { userId: user.id, analysisId } },
      create: { userId: user.id, analysisId, rating, recommendation: analysis.recommendation },
      update: { rating },
      select: { id: true },
    });
    if (user.clerkUserId) {
      // So numeros: o comentario nunca vai ao PostHog.
      captureServer(user.clerkUserId, 'analysis_rated', { rating, recommendation: analysis.recommendation ?? null });
    }
    return saved;
  }

  private async ownedAnalysis(userId: string, analysisId: string) {
    this.assertReady();
    const analysis = await this.prisma.analysis.findFirst({
      where: { id: analysisId, userId, status: 'completed' },
      select: { isDemo: true, recommendation: true, result: true, createdAt: true },
    });
    if (!analysis) throw new NotFoundException({ code: 'analysis_not_found' });
    return analysis;
  }

  private async feedbackContext(userId: string, analysis: { isDemo: boolean; recommendation: string | null; result: unknown; createdAt: Date }) {
    let modality: UsefulnessData['modality'] = 'paid';
    if (analysis.isDemo) {
      try {
        // Read only the immutable start, not today's subscription or trial status.
        const rows = await this.prisma.$queryRawUnsafe<Array<{ startedAt: Date }>>(
          'SELECT "startedAt" FROM "tickrify"."UserTrial" WHERE "userId" = $1', userId,
        );
        modality = rows[0] && analysis.createdAt >= new Date(rows[0].startedAt) ? 'trial' : 'legacy';
      } catch {
        // Missing table/read failure is unknown free context, never proof of legacy.
        modality = 'free';
      }
    }
    const signalState = storedSignalState(analysis.result, analysis.recommendation);
    const verdict = signalState === 'WATCH' || signalState === 'NO_TRADE' ? signalState : analysis.recommendation ?? 'WAIT';
    return { modality, verdict } as const;
  }

  /** Read-only eligibility is NOT an impression. The browser reports actual visibility. */
  async usefulnessEligibility(userId: string, analysisId: string) {
    const analysis = await this.ownedAnalysis(userId, analysisId);
    const answered = await this.prisma.analysisRating.findUnique({ where: { userId_analysisId: { userId, analysisId } }, select: { id: true } });
    const recent = await this.prisma.analysisRating.findFirst({
      where: { userId, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, select: { id: true },
    });
    return { eligible: analysis.isDemo && !answered && !recent, answered: Boolean(answered), recentAnswered: Boolean(recent), ...await this.feedbackContext(userId, analysis) };
  }

  /** One immutable Yes/No per owned completed analysis, including authenticated free rows. */
  async usefulness(user: { id: string; clerkUserId?: string }, analysisId: string, useful: boolean) {
    const analysis = await this.ownedAnalysis(user.id, analysisId);
    const key = { userId_analysisId: { userId: user.id, analysisId } };
    const existing = await this.prisma.analysisRating.findUnique({ where: key, select: { id: true } });
    if (existing) return { id: existing.id, duplicate: true };
    const context = await this.feedbackContext(user.id, analysis);
    const data: UsefulnessData = { kind: 'usefulness', version: 1, useful, ...context, reasons: [] };
    try {
      const saved = await this.prisma.analysisRating.create({
        data: { userId: user.id, analysisId, rating: useful ? 5 : 1, recommendation: analysis.recommendation, reasons: data },
        select: { id: true, createdAt: true },
      });
      if (user.clerkUserId) captureServer(user.clerkUserId, 'analysis_usefulness_answered',
        { analysisId, useful, ...context }, { dedupeKey: `usefulness:${saved.id}`, timestamp: saved.createdAt });
      return { id: saved.id, duplicate: false };
    } catch (error) {
      // The unique index also covers simultaneous requests from two tabs/devices.
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const saved = await this.prisma.analysisRating.findUnique({ where: key, select: { id: true } });
      if (!saved) throw error;
      return { id: saved.id, duplicate: true };
    }
  }

  /** Segundo passo: motivos (nota baixa) ou comentario e licenca (nota alta). */
  async addDetails(
    user: { id: string; clerkUserId?: string },
    ratingId: string,
    details: { kind?: 'usefulness'; reasons?: string[]; comment?: string; quoteConsent?: boolean; displayName?: string },
  ): Promise<{ id: string }> {
    this.assertReady();
    const owned = await this.prisma.analysisRating.findFirst({ where: { id: ratingId, userId: user.id }, select: { id: true, reasons: true } });
    if (!owned) throw new NotFoundException({ code: 'rating_not_found' });

    const binary = usefulnessData(owned.reasons);
    if (binary) {
      const reasons = [...new Set(details.reasons ?? [])].filter(r => (USEFULNESS_REASONS as readonly string[]).includes(r));
      if ((details.reasons ?? []).some(r => !(USEFULNESS_REASONS as readonly string[]).includes(r))) throw new BadRequestException({ code: 'invalid_usefulness_reason' });
      if (binary.useful || details.quoteConsent || details.comment || details.displayName) throw new BadRequestException({ code: 'invalid_usefulness_details' });
      if (JSON.stringify([...binary.reasons].sort()) === JSON.stringify([...reasons].sort())) return { id: ratingId };
      const saved = await this.prisma.analysisRating.update({
        where: { id: ratingId }, data: { reasons: { ...binary, reasons } }, select: { analysisId: true, updatedAt: true },
      });
      if (user.clerkUserId) captureServer(user.clerkUserId, 'analysis_usefulness_reasons', {
        analysisId: saved.analysisId, modality: binary.modality, verdict: binary.verdict, reasons,
      }, { dedupeKey: `usefulness_reasons:${ratingId}:${saved.updatedAt.toISOString()}`, timestamp: saved.updatedAt });
      return { id: ratingId };
    }

    if (details.kind === 'usefulness') throw new BadRequestException({ code: 'not_a_usefulness_rating' });
    const reasons = (details.reasons ?? []).filter((r) => (RATING_REASONS as readonly string[]).includes(r));
    const comment = clean(details.comment, 500);
    await this.prisma.analysisRating.update({
      where: { id: ratingId },
      data: {
        reasons: reasons.length ? reasons : Prisma.DbNull,
        comment,
        // Licenca sem texto nao serve para nada; e quem retira a licenca sai do site na hora.
        quoteConsent: Boolean(details.quoteConsent && comment),
        displayName: clean(details.displayName, 40),
        ...(details.quoteConsent ? {} : { published: false }),
      },
    });
    if (!details.quoteConsent) this.cache = null;
    if (user.clerkUserId) {
      captureServer(user.clerkUserId, 'analysis_rating_details', {
        reasons: reasons.length,
        hasComment: Boolean(comment),
        quoteConsent: Boolean(details.quoteConsent && comment),
      });
    }
    return { id: ratingId };
  }

  /** Publico: so publicado + licenca + nota >= 4 + comentario. Cache curto. */
  async testimonials(): Promise<Testimonial[]> {
    if (!this.ready) return [];
    if (this.cache && Date.now() - this.cache.at < TESTIMONIAL_CACHE_MS) return this.cache.items;
    const rows = await this.prisma.analysisRating.findMany({
      where: { ...STAR_RATINGS_ONLY, published: true, quoteConsent: true, rating: { gte: 4 }, comment: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: TESTIMONIAL_LIMIT,
      select: { comment: true, displayName: true, country: true },
    });
    const items = rows
      .filter((row) => row.comment)
      .map((row) => ({ comment: row.comment as string, displayName: row.displayName, country: row.country }));
    this.cache = { at: Date.now(), items };
    return items;
  }

  /** Admin: ultimas notas com o e-mail e a media por tipo de resultado. */
  async adminList(includeUsefulness = false) {
    this.assertReady();
    const rows = await this.prisma.analysisRating.findMany({
      ...(includeUsefulness ? {} : { where: STAR_RATINGS_ONLY }), orderBy: { createdAt: 'desc' }, take: 100,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
      select: { id: true, email: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const grouped = await this.prisma.analysisRating.groupBy({
      // Binary feedback is not a star score; keep existing star averages separate.
      where: STAR_RATINGS_ONLY,
      by: ['recommendation'],
      _avg: { rating: true },
      _count: { _all: true },
    });
    return {
      supportsUsefulness: true,
      items: rows.map((r) => ({
        ...r,
        feedback: usefulnessData(r.reasons),
        reasons: usefulnessData(r.reasons)?.reasons ?? r.reasons,
        userEmail: byId.get(r.userId)?.email ?? null,
        userName: byId.get(r.userId)?.name ?? null,
      })),
      averages: grouped.map((g) => ({
        recommendation: g.recommendation,
        average: g._avg.rating ? Math.round(g._avg.rating * 10) / 10 : null,
        count: g._count._all,
      })),
    };
  }

  /** Admin publica ou tira do site. Sem licenca ou sem comentario, nao publica. */
  async adminPublish(id: string, input: { published: boolean; displayName?: string; country?: string }) {
    this.assertReady();
    const row = await this.prisma.analysisRating.findUnique({ where: { id }, select: { quoteConsent: true, comment: true, reasons: true } });
    if (!row) throw new NotFoundException({ code: 'rating_not_found' });
    if (input.published && (usefulnessData(row.reasons) || !row.quoteConsent || !row.comment)) {
      throw new BadRequestException({ code: 'no_consent', message: 'Only ratings with permission and a comment can go on the site.' });
    }
    await this.prisma.analysisRating.update({
      where: { id },
      data: {
        published: input.published,
        ...(input.displayName !== undefined ? { displayName: clean(input.displayName, 40) } : {}),
        ...(input.country !== undefined ? { country: clean(input.country, 40) } : {}),
      },
    });
    this.cache = null;
    return { id, published: input.published };
  }
}
