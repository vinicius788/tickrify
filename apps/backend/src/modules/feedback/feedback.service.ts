import { HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { AiService } from '../ai/ai.service';
import { captureServer } from '../../common/analytics/posthog';
import { FEEDBACK_RULES } from '../../common/feedback-bonus';
import { isRepeatEmailAccount, readTrial } from '../../common/trial';
import type { FeedbackSource } from './dto/submit-feedback.dto';

/**
 * Opiniao que vale analises (11/11/2026). Conta logada sem assinatura ativa
 * escreve uma frase sobre a plataforma e ganha FEEDBACK_RULES.bonusAnalyses
 * analises, uma vez por conta. A regra inteira mora aqui e em
 * common/feedback-bonus.ts: a tela so mostra o pedido.
 *
 * Gravar e creditar sao o MESMO INSERT (a linha e o credito), protegido pelo
 * unico em `userId`: dois envios juntos gravam um so e o segundo recebe 409.
 * RLS ligada sem politica: so o backend (dono da tabela) le e escreve.
 */
const BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."UserFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "bonusAnalyses" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserFeedback_userId_key" UNIQUE ("userId"),
    CONSTRAINT "UserFeedback_message_check" CHECK (char_length("message") BETWEEN 15 AND 500),
    CONSTRAINT "UserFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS "UserFeedback_createdAt_idx" ON "tickrify"."UserFeedback"("createdAt" DESC)',
  'ALTER TABLE "tickrify"."UserFeedback" ENABLE ROW LEVEL SECURITY',
];

export function feedbackError(code: string, message: string, status: HttpStatus): HttpException {
  return new HttpException({ code, message }, status);
}

/** Espacos repetidos viram um; a contagem de caracteres e feita DEPOIS disso. */
export function cleanFeedback(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** "aaaaaaaaaaaaaaaa" nao e opiniao: pede um minimo de letras diferentes. */
export function isMeaningfulFeedback(message: string): boolean {
  return new Set(message.toLowerCase().replace(/\s/g, '')).size >= 5;
}

export type FeedbackAdminRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  message: string;
  source: string;
  bonusAnalyses: number;
  createdAt: Date;
};

@Injectable()
export class FeedbackService implements OnModuleInit {
  private readonly logger = new Logger(FeedbackService.name);
  private ready = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.prepare();
  }

  private lastPrepareAt = 0;

  /** Falhou no boot? Os pedidos seguintes tentam de novo, no maximo uma vez por minuto. */
  private async prepare(): Promise<void> {
    this.lastPrepareAt = Date.now();
    try {
      for (const sql of BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.ready = true;
      this.logger.log('[feedback] Tabela pronta.');
    } catch (error) {
      this.logger.error('[feedback] Nao consegui garantir a tabela UserFeedback; opiniao com bonus desligada.', error);
    }
  }

  private async isReady(): Promise<boolean> {
    if (!this.ready && Date.now() - this.lastPrepareAt >= 60_000) await this.prepare();
    return this.ready;
  }

  async submit(
    user: { id: string; clerkUserId?: string },
    input: { message: string; source: FeedbackSource },
  ): Promise<{ bonusAnalyses: number }> {
    if (!(await this.isReady())) throw feedbackError('feedback_unavailable', 'Feedback is unavailable right now. Try again later.', HttpStatus.SERVICE_UNAVAILABLE);

    const message = cleanFeedback(input.message);
    if (message.length < FEEDBACK_RULES.minLength || message.length > FEEDBACK_RULES.maxLength || !isMeaningfulFeedback(message)) {
      throw feedbackError(
        'feedback_invalid',
        `Write one sentence, between ${FEEDBACK_RULES.minLength} and ${FEEDBACK_RULES.maxLength} characters.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (await this.ai.hasPaidAccess(user.id)) {
      throw feedbackError('feedback_subscriber', 'This offer is for accounts without an active subscription.', HttpStatus.FORBIDDEN);
    }
    // Trial negado pelo anti-abuso (e-mail descartavel ou repetido) e conta repetida nao ganham analise por aqui.
    if ((await readTrial(this.prisma, user.id))?.status === 'denied' || (await isRepeatEmailAccount(this.prisma, user.id))) {
      throw feedbackError('feedback_not_eligible', 'This offer is not available for this account.', HttpStatus.FORBIDDEN);
    }

    const inserted = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "tickrify"."UserFeedback" ("id", "userId", "message", "source", "bonusAnalyses")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("userId") DO NOTHING
       RETURNING "id"`,
      randomUUID(),
      user.id,
      message,
      input.source,
      FEEDBACK_RULES.bonusAnalyses,
    );
    if (!inserted[0]) {
      throw feedbackError('feedback_already_used', 'You already used this offer.', HttpStatus.CONFLICT);
    }

    this.logger.log(`[feedback] Opiniao com bonus ${inserted[0].id} source=${input.source}`);
    if (user.clerkUserId) {
      // So numeros e enums: o texto nunca vai ao PostHog.
      captureServer(user.clerkUserId, 'feedback_submitted', {
        source: input.source,
        length: message.length,
        bonus_analyses: FEEDBACK_RULES.bonusAnalyses,
      });
    }
    return { bonusAnalyses: FEEDBACK_RULES.bonusAnalyses };
  }

  async adminList(limit = 200): Promise<{ total: number; items: FeedbackAdminRow[] }> {
    if (!(await this.isReady())) return { total: 0, items: [] };
    const take = Math.min(Math.max(Math.floor(limit) || 0, 1), 500);
    const items = await this.prisma.$queryRawUnsafe<FeedbackAdminRow[]>(
      `SELECT f."id", f."userId", u."email" AS "userEmail", f."message", f."source", f."bonusAnalyses", f."createdAt"
         FROM "tickrify"."UserFeedback" f
         LEFT JOIN "tickrify"."User" u ON u."id" = f."userId"
        ORDER BY f."createdAt" DESC
        LIMIT $1`,
      take,
    );
    const count = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      'SELECT COUNT(*)::bigint AS total FROM "tickrify"."UserFeedback"',
    );
    return { total: Number(count[0]?.total ?? 0), items };
  }
}
