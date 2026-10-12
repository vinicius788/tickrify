-- Chat com o fundador (12/10/2026): uma conversa por pessoa e as mensagens
-- (texto puro, ate 2000 caracteres). Tambem criadas no boot
-- (SupportService.onModuleInit); entram no schema.prisma so depois do deploy.
CREATE TABLE IF NOT EXISTS "tickrify"."SupportThread" (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupportThread_userId_key" ON "tickrify"."SupportThread"("userId");
CREATE INDEX IF NOT EXISTS "SupportThread_lastMessageAt_idx" ON "tickrify"."SupportThread"("lastMessageAt");

CREATE TABLE IF NOT EXISTS "tickrify"."SupportMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportMessage_author_check" CHECK ("author" IN ('user', 'founder')),
    CONSTRAINT "SupportMessage_body_check" CHECK (char_length("body") BETWEEN 1 AND 2000),
    CONSTRAINT "SupportMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "tickrify"."SupportThread"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SupportMessage_threadId_createdAt_idx" ON "tickrify"."SupportMessage"("threadId", "createdAt");
