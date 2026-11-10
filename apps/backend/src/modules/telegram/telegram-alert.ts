/**
 * Alerta de nivel pelo Telegram (10/11/2026). O trader de 1m a 15m nao vive na
 * caixa de entrada: o mesmo disparo do setup-alert-email.ts chega no celular.
 *
 * Regras:
 * - Chave TELEGRAM_SETUP_ALERTS no /admin, DESLIGADA por padrao: so loga
 *   `[telegram] dry-run ...`. Sem TELEGRAM_BOT_TOKEN nada roda.
 * - So para quem ligou a conta ao bot (`UserTelegram.chatId`).
 * - So disparos das ultimas 6h, nao vistos, de setup seguido e nao vencidos.
 * - No maximo 20 mensagens por pessoa em 24h.
 * - Reserva por INSERT em `TelegramAlertSend` antes de enviar (duas instancias
 *   nunca mandam duas); envio recusado tira a reserva.
 * - Enviou: o alerta ganha `emailedAt` e o e-mail nao sai (poupa a cota da
 *   Resend). Falhou ou o bot foi bloqueado: o e-mail segue como reserva.
 * - Bot bloqueado pela pessoa (403): a conta e desligada do Telegram.
 */
import { createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { captureServer } from '../../common/analytics/posthog';
import {
  alertPlanOf,
  formatLevel,
  levelDescription,
  setupAlertLink,
  type SetupAlertEmailItem,
} from '../mail/setup-alert-email';

export const TELEGRAM_ALERT_FLAG = 'TELEGRAM_SETUP_ALERTS';

const HOUR = 60 * 60 * 1000;
export const TELEGRAM_ALERT_RULES = {
  triggeredWithinMs: 6 * HOUR,
  perPersonPer24h: 20,
  dryRunRecentMs: 5 * 60 * 1000,
  linkCodeTtlMs: 30 * 60 * 1000,
} as const;

/** Tabelas por SQL (fora do schema.prisma), no boot da API e na primeira volta do worker. */
export const TELEGRAM_BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."UserTelegram" (
    "userId" TEXT PRIMARY KEY,
    "chatId" TEXT,
    "linkCode" TEXT,
    "linkCodeExpiresAt" TIMESTAMPTZ,
    "linkedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UserTelegram_chatId_key" ON "tickrify"."UserTelegram"("chatId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UserTelegram_linkCode_key" ON "tickrify"."UserTelegram"("linkCode")`,
  `CREATE TABLE IF NOT EXISTS "tickrify"."TelegramAlertSend" (
    "alertId" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS "TelegramAlertSend_userId_sentAt_idx" ON "tickrify"."TelegramAlertSend"("userId", "sentAt")`,
];

export function telegramToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return String(env.TELEGRAM_BOT_TOKEN || '').trim() || null;
}

/** Segredo do webhook derivado do token: o dono so configura uma variavel. */
export function telegramWebhookSecret(token: string): string {
  return createHash('sha256').update(`tickrify-telegram-webhook:${token}`).digest('hex').slice(0, 48);
}

export type TelegramCall = { ok: boolean; status: number; result: unknown };
export type TelegramFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Uma chamada a Bot API. Nunca lanca; o token nunca vai para log. */
export async function callTelegram(token: string, method: string, body: Record<string, unknown>, fetchImpl: TelegramFetch = fetch as unknown as TelegramFetch): Promise<TelegramCall> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown } | null;
    return { ok: res.status === 200 && data?.ok === true, status: res.status, result: data?.result ?? null };
  } catch {
    return { ok: false, status: 0, result: null };
  }
}

export function renderSetupAlertTelegram(appUrl: string, item: SetupAlertEmailItem): { text: string; button: { text: string; url: string } } {
  const level = formatLevel(item.level);
  const asset = `${item.symbol}${item.timeframe ? ` ${item.timeframe}` : ''}`;
  const label = levelDescription(item.label, item.plan.direction);
  const side = item.plan.direction === 'long' ? 'buy' : item.plan.direction === 'short' ? 'sell' : null;
  const c = item.plan.conditional;
  const lines = [
    `${asset} reached ${level}`,
    `${label.charAt(0).toUpperCase()}${label.slice(1)}. Touched at ${item.triggeredAt.toISOString().slice(11, 16)} UTC.`,
    item.plan.invalidation !== null ? `Invalidation ${formatLevel(item.plan.invalidation)}.` : null,
    item.plan.target !== null ? `Target ${formatLevel(item.plan.target)}.` : null,
    c && side ? `Plan if price reaches ${formatLevel(c.entry)}: ${side} at ${formatLevel(c.entry)}, stop ${formatLevel(c.stopLoss)}, target ${formatLevel(c.takeProfit1)} (${c.tp1R.toFixed(1)}R).` : null,
    'Re-check the chart before you act. This is not a signal to enter.',
  ];
  return { text: lines.filter(Boolean).join('\n'), button: { text: 'Update chart', url: setupAlertLink(appUrl, item, 'telegram') } };
}

type PendingRow = Omit<SetupAlertEmailItem, 'plan'> & {
  userId: string;
  chatId: string;
  clerkUserId: string | null;
  analysisResult: unknown;
  analysisRecommendation: string | null;
};

export type SetupAlertTelegramDeps = {
  prisma: Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$executeRawUnsafe'>;
  token: string | null;
  isEnabled(): boolean;
  appUrl: string;
  now?: () => Date;
  capture?: typeof captureServer;
  fetchImpl?: TelegramFetch;
  log(level: 'log' | 'warn', message: string): void;
};

let schemaReady = false;
/** So para teste. */
export const resetTelegramSchemaForTest = () => { schemaReady = false; };

/** Uma volta, ANTES da volta do e-mail. Devolve quantos receberiam/receberam. */
export async function runSetupAlertTelegramSweep(deps: SetupAlertTelegramDeps): Promise<{ due: number; sent: number }> {
  if (!deps.token) return { due: 0, sent: 0 };
  if (!schemaReady) {
    for (const sql of TELEGRAM_BOOT_SQL) await deps.prisma.$executeRawUnsafe(sql);
    schemaReady = true;
  }
  const now = deps.now ? deps.now() : new Date();
  const enabled = deps.isEnabled();
  const capture = deps.capture ?? captureServer;
  const recent = enabled
    ? Prisma.sql`a."triggeredAt" > ${new Date(now.getTime() - TELEGRAM_ALERT_RULES.triggeredWithinMs)}`
    : Prisma.sql`a."updatedAt" > ${new Date(now.getTime() - TELEGRAM_ALERT_RULES.dryRunRecentMs)}`;
  const rows = await deps.prisma.$queryRaw<PendingRow[]>`
    SELECT a."id" AS "alertId", a."setupId", a."userId", a."symbol", a."priceSymbol", s."timeframe", a."level", a."label", a."triggeredAt",
      t."chatId", u."clerkUserId", an."result" AS "analysisResult", an."recommendation" AS "analysisRecommendation"
    FROM "tickrify"."SetupAlert" a
    JOIN "tickrify"."TrackedSetup" s ON s."id" = a."setupId" AND s."userId" = a."userId" AND s."status" = 'tracking'
    JOIN "tickrify"."UserTelegram" t ON t."userId" = a."userId" AND t."chatId" IS NOT NULL
    JOIN "tickrify"."User" u ON u."id" = a."userId"
    LEFT JOIN "tickrify"."Analysis" an ON an."id" = a."analysisId"
    LEFT JOIN "tickrify"."TelegramAlertSend" ts ON ts."alertId" = a."id"
    WHERE a."status" = 'triggered' AND ts."alertId" IS NULL AND a."emailedAt" IS NULL AND a."seenAt" IS NULL AND ${recent}
      AND (a."expiresAt" IS NULL OR a."expiresAt" > ${now})
    ORDER BY a."triggeredAt" ASC, a."id" ASC
    LIMIT 200
  `;
  let due = 0;
  let sent = 0;
  for (const row of rows) {
    try {
      const [limits] = await deps.prisma.$queryRaw<Array<{ personRecent: number }>>`
        SELECT COUNT(*)::int AS "personRecent" FROM "tickrify"."TelegramAlertSend"
        WHERE "userId" = ${row.userId} AND "sentAt" > ${new Date(now.getTime() - 24 * HOUR)}
      `;
      if (Number(limits?.personRecent) >= TELEGRAM_ALERT_RULES.perPersonPer24h) continue;
      due++;
      if (!enabled) {
        deps.log('log', `[telegram] dry-run user=${row.userId} alert=${row.alertId}`);
        continue;
      }
      const claimed = await deps.prisma.$executeRaw`
        INSERT INTO "tickrify"."TelegramAlertSend" ("alertId", "userId", "sentAt") VALUES (${row.alertId}, ${row.userId}, ${now})
        ON CONFLICT ("alertId") DO NOTHING
      `;
      if (Number(claimed) !== 1) continue;
      const message = renderSetupAlertTelegram(deps.appUrl, { ...row, level: Number(row.level), plan: alertPlanOf(row.analysisResult, row.analysisRecommendation) });
      const res = await callTelegram(deps.token, 'sendMessage', {
        chat_id: row.chatId,
        text: message.text,
        reply_markup: { inline_keyboard: [[{ text: message.button.text, url: message.button.url }]] },
      }, deps.fetchImpl);
      if (res.ok) {
        sent++;
        // O e-mail deste alerta nao sai: a pessoa ja foi avisada.
        await deps.prisma.$executeRaw`
          UPDATE "tickrify"."SetupAlert" SET "emailedAt" = ${now}, "updatedAt" = NOW() WHERE "id" = ${row.alertId} AND "emailedAt" IS NULL
        `;
        if (row.clerkUserId) {
          capture(row.clerkUserId, 'setup_alert_telegram_sent', { alertId: row.alertId, setupId: row.setupId, label: row.label }, {
            dedupeKey: `setup_alert_telegram_sent:${row.alertId}`,
          });
        }
      } else {
        await deps.prisma.$executeRaw`DELETE FROM "tickrify"."TelegramAlertSend" WHERE "alertId" = ${row.alertId}`.catch(() => undefined);
        if (res.status === 403) {
          await deps.prisma.$executeRaw`
            UPDATE "tickrify"."UserTelegram" SET "chatId" = NULL, "linkedAt" = NULL, "updatedAt" = NOW() WHERE "userId" = ${row.userId}
          `.catch(() => undefined);
        }
      }
      const latency = Math.max(0, (deps.now ? deps.now() : new Date()).getTime() - row.triggeredAt.getTime());
      deps.log('log', `[telegram] user=${row.userId} alert=${row.alertId} sent=${res.ok ? 1 : 0} status=${res.status} latency_ms=${latency}`);
    } catch (err) {
      deps.log('warn', `[telegram] Falha best-effort alert=${row.alertId}: ${(err as Error)?.message ?? err}`);
    }
  }
  return { due, sent };
}
