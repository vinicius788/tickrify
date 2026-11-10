-- Alerta de nivel pelo Telegram (10/11/2026). Fora do schema.prisma; o boot
-- (TelegramService e a volta do worker) cria as mesmas tabelas.
CREATE TABLE IF NOT EXISTS "tickrify"."UserTelegram" (
  "userId" TEXT PRIMARY KEY,
  "chatId" TEXT,
  "linkCode" TEXT,
  "linkCodeExpiresAt" TIMESTAMPTZ,
  "linkedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserTelegram_chatId_key" ON "tickrify"."UserTelegram"("chatId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserTelegram_linkCode_key" ON "tickrify"."UserTelegram"("linkCode");
CREATE TABLE IF NOT EXISTS "tickrify"."TelegramAlertSend" (
  "alertId" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "sentAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "TelegramAlertSend_userId_sentAt_idx" ON "tickrify"."TelegramAlertSend"("userId", "sentAt");
