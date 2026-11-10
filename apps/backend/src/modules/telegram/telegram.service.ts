import { randomBytes, timingSafeEqual } from 'crypto';
import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { captureServer } from '../../common/analytics/posthog';
import {
  TELEGRAM_ALERT_RULES,
  TELEGRAM_BOOT_SQL,
  callTelegram,
  telegramToken,
  telegramWebhookSecret,
  type TelegramFetch,
} from './telegram-alert';

export type TelegramStatus = { available: boolean; linked: boolean; botUsername: string | null };

type TelegramUpdate = { message?: { text?: unknown; chat?: { id?: unknown; type?: unknown } } };

/**
 * Liga a conta ao bot do Telegram (10/11/2026). A pessoa pede um link no
 * painel, abre o bot e toca em Start: o codigo do link (30 min, uso unico)
 * prova de quem e o chat. Sem TELEGRAM_BOT_TOKEN, tudo responde "indisponivel".
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private ready = false;
  private botUsername: string | null = null;
  fetchImpl: TelegramFetch | undefined;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const sql of TELEGRAM_BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.ready = true;
    } catch (error) {
      this.logger.warn(`[telegram] Tabelas indisponiveis: ${error instanceof Error ? error.message : error}`);
      return;
    }
    const token = telegramToken();
    if (!token) {
      this.logger.log('[telegram] Tabelas prontas. Bot: sem TELEGRAM_BOT_TOKEN (desligado).');
      return;
    }
    const me = await callTelegram(token, 'getMe', {}, this.fetchImpl);
    this.botUsername = me.ok ? String((me.result as { username?: unknown })?.username || '') || null : null;
    const base = String(process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
    let webhook = 'sem URL publica';
    if (base && this.botUsername) {
      const set = await callTelegram(token, 'setWebhook', {
        url: `${base}/api/telegram/webhook`,
        secret_token: telegramWebhookSecret(token),
        allowed_updates: ['message'],
      }, this.fetchImpl);
      webhook = set.ok ? 'registrado' : `falhou (${set.status})`;
    }
    this.logger.log(`[telegram] Tabelas prontas. Bot: ${this.botUsername ? `@${this.botUsername}` : 'token recusado'}; webhook: ${webhook}.`);
  }

  private get available(): boolean {
    return this.ready && !!telegramToken() && !!this.botUsername;
  }

  private assertAvailable() {
    if (!this.available) throw new ServiceUnavailableException({ code: 'telegram_unavailable', message: 'Telegram alerts are not available right now.' });
  }

  async status(userId: string): Promise<TelegramStatus> {
    if (!this.available) return { available: false, linked: false, botUsername: null };
    const rows = await this.prisma.$queryRaw<Array<{ chatId: string | null }>>`
      SELECT "chatId" FROM "tickrify"."UserTelegram" WHERE "userId" = ${userId} LIMIT 1
    `;
    return { available: true, linked: !!rows[0]?.chatId, botUsername: this.botUsername };
  }

  /** Link do bot com um codigo novo; o anterior deixa de valer. */
  async createLink(userId: string): Promise<{ url: string; expiresAt: string }> {
    this.assertAvailable();
    const code = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + TELEGRAM_ALERT_RULES.linkCodeTtlMs);
    await this.prisma.$executeRaw`
      INSERT INTO "tickrify"."UserTelegram" ("userId", "linkCode", "linkCodeExpiresAt")
      VALUES (${userId}, ${code}, ${expiresAt})
      ON CONFLICT ("userId") DO UPDATE SET "linkCode" = ${code}, "linkCodeExpiresAt" = ${expiresAt}, "updatedAt" = NOW()
    `;
    return { url: `https://t.me/${this.botUsername}?start=${code}`, expiresAt: expiresAt.toISOString() };
  }

  async unlink(user: { id: string; clerkUserId: string }): Promise<TelegramStatus> {
    if (this.ready) {
      const changed = await this.prisma.$executeRaw`
        UPDATE "tickrify"."UserTelegram" SET "chatId" = NULL, "linkedAt" = NULL, "linkCode" = NULL, "linkCodeExpiresAt" = NULL, "updatedAt" = NOW()
        WHERE "userId" = ${user.id} AND "chatId" IS NOT NULL
      `;
      if (Number(changed) > 0) captureServer(user.clerkUserId, 'telegram_unlinked', { by: 'dashboard' });
    }
    return this.status(user.id);
  }

  /** O cabecalho do webhook confere com o segredo derivado do token. */
  isValidWebhookSecret(header: unknown): boolean {
    const token = telegramToken();
    if (!token || typeof header !== 'string') return false;
    const expected = Buffer.from(telegramWebhookSecret(token));
    const got = Buffer.from(header);
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  /** `/start <codigo>` liga o chat a conta; `/stop` desliga. Qualquer outra coisa recebe a ajuda. */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const token = telegramToken();
    const chat = update?.message?.chat;
    const text = typeof update?.message?.text === 'string' ? update.message.text.trim() : '';
    if (!token || !this.ready || !chat || chat.type !== 'private' || (typeof chat.id !== 'number' && typeof chat.id !== 'string')) return;
    const chatId = String(chat.id);
    const reply = (message: string) => callTelegram(token, 'sendMessage', { chat_id: chatId, text: message }, this.fetchImpl);

    if (/^\/stop\b/i.test(text)) {
      const rows = await this.prisma.$queryRaw<Array<{ clerkUserId: string | null }>>`
        UPDATE "tickrify"."UserTelegram" t SET "chatId" = NULL, "linkedAt" = NULL, "updatedAt" = NOW()
        FROM "tickrify"."User" u WHERE t."chatId" = ${chatId} AND u."id" = t."userId"
        RETURNING u."clerkUserId"
      `;
      if (rows[0]?.clerkUserId) captureServer(rows[0].clerkUserId, 'telegram_unlinked', { by: 'bot' });
      await reply('Alerts are off for this chat. You can connect again from Settings in Tickrify.');
      return;
    }

    const code = /^\/start\s+([A-Za-z0-9_-]{16,64})$/.exec(text)?.[1];
    if (!code) {
      await reply('This bot sends your Tickrify price alerts. Open Settings in Tickrify and tap "Connect Telegram" to link your account. Send /stop to turn alerts off.');
      return;
    }
    const linked = await this.prisma.$transaction(async (tx) => {
      const owner = await tx.$queryRaw<Array<{ userId: string }>>`
        SELECT "userId" FROM "tickrify"."UserTelegram"
        WHERE "linkCode" = ${code} AND "linkCodeExpiresAt" > NOW() LIMIT 1 FOR UPDATE
      `;
      if (!owner[0]) return null;
      // Um chat avisa uma conta so: ligar em outra conta tira da anterior.
      await tx.$executeRaw`
        UPDATE "tickrify"."UserTelegram" SET "chatId" = NULL, "linkedAt" = NULL, "updatedAt" = NOW()
        WHERE "chatId" = ${chatId} AND "userId" <> ${owner[0].userId}
      `;
      await tx.$executeRaw`
        UPDATE "tickrify"."UserTelegram" SET "chatId" = ${chatId}, "linkedAt" = NOW(), "linkCode" = NULL, "linkCodeExpiresAt" = NULL, "updatedAt" = NOW()
        WHERE "userId" = ${owner[0].userId}
      `;
      return owner[0].userId;
    });
    if (!linked) {
      await reply('This link has expired. Open Settings in Tickrify and tap "Connect Telegram" again.');
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: linked }, select: { clerkUserId: true } });
    if (user?.clerkUserId) captureServer(user.clerkUserId, 'telegram_linked', {});
    await reply('Connected. You will get a message here when price reaches a level you are watching. This is not a signal to enter. Send /stop to turn alerts off.');
  }
}
