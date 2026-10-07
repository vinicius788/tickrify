import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { captureServer } from '../../common/analytics/posthog';
import { RATING_REASONS } from './dto/ratings.dto';

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

const TESTIMONIAL_LIMIT = 6;
const TESTIMONIAL_CACHE_MS = 5 * 60 * 1000;

export type Testimonial = { comment: string; displayName: string | null; country: string | null };

function clean(text: string | null | undefined, max: number): string | null {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return value || null;
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

  /** Segundo passo: motivos (nota baixa) ou comentario e licenca (nota alta). */
  async addDetails(
    user: { id: string; clerkUserId?: string },
    ratingId: string,
    details: { reasons?: string[]; comment?: string; quoteConsent?: boolean; displayName?: string },
  ): Promise<{ id: string }> {
    this.assertReady();
    const owned = await this.prisma.analysisRating.findFirst({ where: { id: ratingId, userId: user.id }, select: { id: true } });
    if (!owned) throw new NotFoundException({ code: 'rating_not_found' });

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
      where: { published: true, quoteConsent: true, rating: { gte: 4 }, comment: { not: null } },
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
  async adminList() {
    this.assertReady();
    const rows = await this.prisma.analysisRating.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
      select: { id: true, email: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const grouped = await this.prisma.analysisRating.groupBy({
      by: ['recommendation'],
      _avg: { rating: true },
      _count: { _all: true },
    });
    return {
      items: rows.map((r) => ({
        ...r,
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
    const row = await this.prisma.analysisRating.findUnique({ where: { id }, select: { quoteConsent: true, comment: true } });
    if (!row) throw new NotFoundException({ code: 'rating_not_found' });
    if (input.published && (!row.quoteConsent || !row.comment)) {
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
