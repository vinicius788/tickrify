-- Nota por analise e depoimento com licenca (07/10/2026). Tambem criada no boot
-- (RatingsService.onModuleInit).
CREATE TABLE IF NOT EXISTS "tickrify"."AnalysisRating" (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS "AnalysisRating_userId_analysisId_key" ON "tickrify"."AnalysisRating"("userId", "analysisId");
CREATE INDEX IF NOT EXISTS "AnalysisRating_published_createdAt_idx" ON "tickrify"."AnalysisRating"("published", "createdAt");
