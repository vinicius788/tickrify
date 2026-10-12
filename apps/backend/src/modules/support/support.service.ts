import { randomUUID } from 'crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { AiService } from '../ai/ai.service';
import { captureServer } from '../../common/analytics/posthog';
import { flagBool } from '../../common/flags/feature-flags';
import { billingCycleForPriceId } from '../../config/stripe.config';
import { CHAT_EMAIL_FLAG, notifyFounder } from './chat-email';

/**
 * Chat com o fundador dentro do painel (12/10/2026).
 *
 * Feito em casa de proposito: widget de terceiro exige aceite de cookie, muda a
 * /privacy e sumiria justamente para quem nao aceitou. Uma conversa por pessoa,
 * mensagens no nosso banco, texto puro. Sem WebSocket: o Render roda 2
 * instancias, entao a tela pergunta (polling) e o estado mora no banco.
 *
 * Regras que nao se dobram:
 * - A conversa e sempre a do token; nenhum id vem do corpo.
 * - Funciona com o gratis esgotado (nao passa pelo `isFreeLocked`): quem esta
 *   no paywall e quem mais interessa ouvir.
 * - O texto nunca vai ao PostHog, ao Sentry nem ao prompt da IA. Eventos so com
 *   ids, autor e tamanho.
 * - Tudo por SQL: as tabelas entram no schema.prisma so depois do deploy.
 */
const BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."SupportThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "lastUserReadAt" TIMESTAMP(3),
    "lastFounderReadAt" TIMESTAMP(3),
    "lastFounderMessageAt" TIMESTAMP(3),
    "lastFounderNotifyAt" TIMESTAMP(3),
    "lastReplyEmailAt" TIMESTAMP(3),
    CONSTRAINT "SupportThread_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportThread_status_check" CHECK ("status" IN ('open', 'closed')),
    CONSTRAINT "SupportThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SupportThread_userId_key" ON "tickrify"."SupportThread"("userId")`,
  `CREATE INDEX IF NOT EXISTS "SupportThread_lastMessageAt_idx" ON "tickrify"."SupportThread"("lastMessageAt")`,
  `CREATE TABLE IF NOT EXISTS "tickrify"."SupportMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportMessage_author_check" CHECK ("author" IN ('user', 'founder')),
    CONSTRAINT "SupportMessage_body_check" CHECK (char_length("body") BETWEEN 1 AND 2000),
    CONSTRAINT "SupportMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "tickrify"."SupportThread"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "SupportMessage_threadId_createdAt_idx" ON "tickrify"."SupportMessage"("threadId", "createdAt")`,
];

/** 20 mensagens por hora por pessoa (no banco: vale para as 2 instancias). */
export const CHAT_RATE_LIMIT_PER_HOUR = 20;

export type ChatAuthor = 'user' | 'founder';
export type ChatMessage = { id: string; author: ChatAuthor; body: string; createdAt: Date };
type ThreadRow = {
  id: string;
  userId: string;
  status: 'open' | 'closed';
  lastMessageAt: Date | null;
  lastUserReadAt: Date | null;
  lastFounderReadAt: Date | null;
};

function cleanBody(raw: unknown): string {
  const body = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim() : '';
  if (!body) throw new BadRequestException({ code: 'chat_empty', message: 'Write a message first.' });
  if (body.length > 2000) throw new BadRequestException({ code: 'chat_too_long', message: 'Messages are limited to 2000 characters.' });
  return body;
}

@Injectable()
export class SupportService implements OnModuleInit {
  private readonly logger = new Logger(SupportService.name);
  private ready = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly ai: AiService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const sql of BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.ready = true;
      this.logger.log('[chat] Tabelas prontas.');
    } catch (error) {
      this.ready = false;
      this.logger.warn(`[chat] Indisponivel (chat desligado): ${error instanceof Error ? error.message : error}`);
    }
  }

  private assertReady() {
    if (!this.ready) throw new ServiceUnavailableException({ code: 'chat_unavailable', message: 'Chat is temporarily unavailable.' });
  }

  private async threadOfUser(userId: string): Promise<ThreadRow | null> {
    const rows = await this.prisma.$queryRaw<ThreadRow[]>`
      SELECT "id", "userId", "status", "lastMessageAt", "lastUserReadAt", "lastFounderReadAt"
      FROM "tickrify"."SupportThread" WHERE "userId" = ${userId} LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /** Cria a conversa da pessoa se ainda nao existe (uma por pessoa). */
  private async ensureThread(userId: string): Promise<{ thread: ThreadRow; created: boolean }> {
    const id = randomUUID();
    const inserted = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "tickrify"."SupportThread" ("id", "userId", "status", "createdAt", "updatedAt")
      VALUES (${id}, ${userId}, 'open', NOW(), NOW())
      ON CONFLICT ("userId") DO NOTHING
      RETURNING "id"
    `;
    const thread = await this.threadOfUser(userId);
    if (!thread) throw new ServiceUnavailableException({ code: 'chat_unavailable' });
    return { thread, created: inserted.length > 0 };
  }

  private async unreadFor(threadId: string, author: ChatAuthor, readAt: Date | null): Promise<number> {
    const [{ n }] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS "n" FROM "tickrify"."SupportMessage"
      WHERE "threadId" = ${threadId} AND "author" = ${author}
        ${readAt ? Prisma.sql`AND "createdAt" > ${readAt}` : Prisma.empty}
    `;
    return Number(n) || 0;
  }

  /** Pagina de mensagens: as mais novas primeiro no banco, em ordem cronologica na resposta. */
  private async page(threadId: string, cursor: string | null, limit: number): Promise<{ items: ChatMessage[]; nextCursor: string | null }> {
    const take = Math.max(1, Math.min(100, Math.floor(limit) || 50));
    let before = Prisma.empty;
    if (cursor) {
      const anchor = await this.prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
        SELECT "id", "createdAt" FROM "tickrify"."SupportMessage"
        WHERE "id" = ${cursor} AND "threadId" = ${threadId} LIMIT 1
      `;
      if (!anchor[0]) return { items: [], nextCursor: null };
      before = Prisma.sql`AND ("createdAt", "id") < (${anchor[0].createdAt}, ${anchor[0].id})`;
    }
    const rows = await this.prisma.$queryRaw<ChatMessage[]>`
      SELECT "id", "author", "body", "createdAt" FROM "tickrify"."SupportMessage"
      WHERE "threadId" = ${threadId} ${before}
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT ${take + 1}
    `;
    const newestFirst = rows.slice(0, take);
    const oldest = newestFirst[newestFirst.length - 1];
    return { items: [...newestFirst].reverse(), nextCursor: rows.length > take && oldest ? oldest.id : null };
  }

  private async isSubscriber(userId: string): Promise<boolean> {
    const active = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: ['active', 'trialing'] } },
      select: { id: true },
    });
    return Boolean(active);
  }

  // ── Usuario ────────────────────────────────────────────────────────────────

  /** A conversa da pessoa e quantas respostas do fundador ela ainda nao leu. */
  async getThreadForUser(userId: string) {
    this.assertReady();
    const thread = await this.threadOfUser(userId);
    if (!thread) return { thread: null };
    return {
      thread: {
        id: thread.id,
        status: thread.status,
        lastMessageAt: thread.lastMessageAt,
        unread: await this.unreadFor(thread.id, 'founder', thread.lastUserReadAt),
      },
    };
  }

  async listMessagesForUser(userId: string, cursor: string | null, limit = 50) {
    this.assertReady();
    const thread = await this.threadOfUser(userId);
    if (!thread) return { items: [], nextCursor: null };
    return this.page(thread.id, cursor, limit);
  }

  async sendUserMessage(user: { id: string; clerkUserId?: string; email?: string | null }, rawBody: unknown): Promise<{ message: ChatMessage }> {
    this.assertReady();
    const body = cleanBody(rawBody);
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const [{ n }] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS "n"
      FROM "tickrify"."SupportMessage" m
      JOIN "tickrify"."SupportThread" t ON t."id" = m."threadId"
      WHERE t."userId" = ${user.id} AND m."author" = 'user' AND m."createdAt" > ${since}
    `;
    if (Number(n) >= CHAT_RATE_LIMIT_PER_HOUR) {
      throw new HttpException(
        { code: 'chat_rate_limited', message: 'You sent a lot of messages in the last hour. Try again a bit later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { thread, created } = await this.ensureThread(user.id);
    const message = await this.insertMessage(thread.id, 'user', body);
    // Escrever conta como ter lido o que estava na tela.
    await this.prisma.$executeRaw`
      UPDATE "tickrify"."SupportThread"
      SET "lastUserReadAt" = ${message.createdAt}
      WHERE "id" = ${thread.id}
    `;

    const [isSubscriber, freeLocked] = await Promise.all([
      this.isSubscriber(user.id),
      this.ai.isFreeLocked(user.id).catch(() => false),
    ]);
    if (user.clerkUserId) {
      if (created) captureServer(user.clerkUserId, 'chat_thread_started', { threadId: thread.id, startedBy: 'user' });
      captureServer(user.clerkUserId, 'chat_message_sent', {
        threadId: thread.id,
        author: 'user',
        length: body.length,
        isSubscriber,
        freeLocked,
      });
    }
    void notifyFounder(
      {
        prisma: this.prisma,
        mail: this.mail,
        isEnabled: () => flagBool(CHAT_EMAIL_FLAG),
        log: (level, text) => (level === 'warn' ? this.logger.warn(text) : this.logger.log(text)),
      },
      { threadId: thread.id, clerkUserId: user.clerkUserId ?? null, userEmail: user.email ?? null, isSubscriber, freeLocked, body },
    );
    return { message };
  }

  async markReadByUser(userId: string): Promise<{ ok: true }> {
    this.assertReady();
    await this.prisma.$executeRaw`
      UPDATE "tickrify"."SupportThread" SET "lastUserReadAt" = NOW() WHERE "userId" = ${userId}
    `;
    return { ok: true };
  }

  /** Grava a mensagem e reabre a conversa (mensagem nova nunca fica numa conversa fechada). */
  private async insertMessage(threadId: string, author: ChatAuthor, body: string): Promise<ChatMessage> {
    const id = randomUUID();
    const [message] = await this.prisma.$queryRaw<ChatMessage[]>`
      INSERT INTO "tickrify"."SupportMessage" ("id", "threadId", "author", "body", "createdAt")
      VALUES (${id}, ${threadId}, ${author}, ${body}, NOW())
      RETURNING "id", "author", "body", "createdAt"
    `;
    await this.prisma.$executeRaw`
      UPDATE "tickrify"."SupportThread"
      SET "lastMessageAt" = ${message.createdAt}, "status" = 'open', "updatedAt" = NOW()
        ${author === 'founder' ? Prisma.sql`, "lastFounderMessageAt" = ${message.createdAt}` : Prisma.empty}
      WHERE "id" = ${threadId}
    `;
    return message;
  }

  // ── Fundador (/admin, aba Chat) ────────────────────────────────────────────

  /** Conversas com o que ajuda a responder: nao lidas primeiro. */
  async adminListThreads() {
    this.assertReady();
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        userId: string;
        status: string;
        lastMessageAt: Date | null;
        createdAt: Date;
        email: string | null;
        name: string | null;
        acquisitionSource: string | null;
        unread: number;
        lastBody: string | null;
        lastAuthor: ChatAuthor | null;
        lastAnalysisAt: Date | null;
        priceId: string | null;
        stripeId: string | null;
      }>
    >`
      SELECT * FROM (
        SELECT t."id", t."userId", t."status", t."lastMessageAt", t."createdAt",
          u."email", u."name", u."acquisitionSource",
          (SELECT COUNT(*)::int FROM "tickrify"."SupportMessage" m
            WHERE m."threadId" = t."id" AND m."author" = 'user'
              AND (t."lastFounderReadAt" IS NULL OR m."createdAt" > t."lastFounderReadAt")) AS "unread",
          (SELECT m."body" FROM "tickrify"."SupportMessage" m WHERE m."threadId" = t."id"
            ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1) AS "lastBody",
          (SELECT m."author" FROM "tickrify"."SupportMessage" m WHERE m."threadId" = t."id"
            ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1) AS "lastAuthor",
          (SELECT MAX(a."createdAt") FROM "tickrify"."Analysis" a WHERE a."userId" = t."userId") AS "lastAnalysisAt",
          s."priceId", s."stripeId"
        FROM "tickrify"."SupportThread" t
        JOIN "tickrify"."User" u ON u."id" = t."userId"
        LEFT JOIN LATERAL (
          SELECT s."priceId", s."stripeId" FROM "tickrify"."Subscription" s
          WHERE s."userId" = t."userId" AND s."status" IN ('active', 'trialing')
          ORDER BY s."updatedAt" DESC LIMIT 1
        ) s ON TRUE
      ) x
      ORDER BY (x."unread" > 0) DESC, x."lastMessageAt" DESC NULLS LAST, x."id" DESC
      LIMIT 100
    `;
    return {
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        status: row.status,
        lastMessageAt: row.lastMessageAt,
        createdAt: row.createdAt,
        email: row.email,
        name: row.name,
        acquisitionSource: row.acquisitionSource,
        unread: Number(row.unread) || 0,
        lastMessage: row.lastBody ? row.lastBody.slice(0, 140) : null,
        lastAuthor: row.lastAuthor,
        lastAnalysisAt: row.lastAnalysisAt,
        isSubscriber: Boolean(row.stripeId),
        // Acesso manual (manual_owner_1) nao e pagante: mesma regra das contagens.
        plan: !row.stripeId ? 'free' : row.stripeId.startsWith('manual_') ? 'manual' : billingCycleForPriceId(row.priceId) ?? 'paid',
      })),
    };
  }

  private async threadById(threadId: string): Promise<(ThreadRow & { clerkUserId: string | null; email: string | null }) | null> {
    const rows = await this.prisma.$queryRaw<Array<ThreadRow & { clerkUserId: string | null; email: string | null }>>`
      SELECT t."id", t."userId", t."status", t."lastMessageAt", t."lastUserReadAt", t."lastFounderReadAt", u."clerkUserId", u."email"
      FROM "tickrify"."SupportThread" t JOIN "tickrify"."User" u ON u."id" = t."userId"
      WHERE t."id" = ${threadId} LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /** Abrir a conversa no /admin conta como o fundador ter lido. */
  async adminGetThread(threadId: string, cursor: string | null, limit = 100) {
    this.assertReady();
    const thread = await this.threadById(threadId);
    if (!thread) throw new NotFoundException({ code: 'thread_not_found' });
    const messages = await this.page(threadId, cursor, limit);
    if (!cursor) {
      await this.prisma.$executeRaw`UPDATE "tickrify"."SupportThread" SET "lastFounderReadAt" = NOW() WHERE "id" = ${threadId}`;
    }
    return { thread: { id: thread.id, userId: thread.userId, status: thread.status, email: thread.email }, ...messages };
  }

  async adminReply(threadId: string, rawBody: unknown): Promise<{ message: ChatMessage }> {
    this.assertReady();
    const body = cleanBody(rawBody);
    const thread = await this.threadById(threadId);
    if (!thread) throw new NotFoundException({ code: 'thread_not_found' });
    const message = await this.insertMessage(threadId, 'founder', body);
    await this.prisma.$executeRaw`UPDATE "tickrify"."SupportThread" SET "lastFounderReadAt" = ${message.createdAt} WHERE "id" = ${threadId}`;
    await this.trackFounderMessage(thread.userId, thread.clerkUserId, threadId, body.length, false);
    return { message };
  }

  async adminSetStatus(threadId: string, status: 'open' | 'closed') {
    this.assertReady();
    const updated = await this.prisma.$executeRaw`
      UPDATE "tickrify"."SupportThread" SET "status" = ${status}, "updatedAt" = NOW() WHERE "id" = ${threadId}
    `;
    if (!updated) throw new NotFoundException({ code: 'thread_not_found' });
    return { id: threadId, status };
  }

  /** O fundador puxa assunto (ex.: assinante que parou de usar). Usa a conversa que ja existir. */
  async adminStartConversation(email: string, rawBody: unknown) {
    this.assertReady();
    const body = cleanBody(rawBody);
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
      select: { id: true, clerkUserId: true },
    });
    if (!user) throw new NotFoundException({ code: 'user_not_found', message: 'No account with this email.' });
    const { thread, created } = await this.ensureThread(user.id);
    const message = await this.insertMessage(thread.id, 'founder', body);
    await this.prisma.$executeRaw`UPDATE "tickrify"."SupportThread" SET "lastFounderReadAt" = ${message.createdAt} WHERE "id" = ${thread.id}`;
    await this.trackFounderMessage(user.id, user.clerkUserId, thread.id, body.length, created);
    return { threadId: thread.id, message };
  }

  /** Eventos da mensagem do fundador vao para a PESSOA da conversa (tempo ate a 1a resposta por pessoa). */
  private async trackFounderMessage(userId: string, clerkUserId: string | null, threadId: string, length: number, started: boolean) {
    if (!clerkUserId) return;
    const [isSubscriber, freeLocked] = await Promise.all([
      this.isSubscriber(userId).catch(() => false),
      this.ai.isFreeLocked(userId).catch(() => false),
    ]);
    if (started) captureServer(clerkUserId, 'chat_thread_started', { threadId, startedBy: 'founder' });
    captureServer(clerkUserId, 'chat_message_sent', { threadId, author: 'founder', length, isSubscriber, freeLocked });
  }
}
