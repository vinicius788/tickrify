-- Opiniao que vale analises (11/11/2026): uma por conta. A linha e o credito
-- (bonusAnalyses), lido por common/feedback-bonus.ts. Tambem criada no boot
-- (FeedbackService.onModuleInit). Fora do schema.prisma, lida por SQL.
CREATE TABLE IF NOT EXISTS "tickrify"."UserFeedback" (
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
);
CREATE INDEX IF NOT EXISTS "UserFeedback_createdAt_idx" ON "tickrify"."UserFeedback"("createdAt" DESC);
ALTER TABLE "tickrify"."UserFeedback" ENABLE ROW LEVEL SECURITY;
