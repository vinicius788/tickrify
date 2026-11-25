-- "Ask about this analysis" (25/11/2026): perguntas do trader sobre uma analise concluida e a resposta curta.
-- Tambem criada no boot (AnalysisQuestionsService). Fora do schema.prisma. answer NULL = pergunta em voo.
CREATE TABLE IF NOT EXISTS "tickrify"."AnalysisQuestion" (
  "id" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "costUsd" DOUBLE PRECISION,
  "ms" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalysisQuestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalysisQuestion_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "tickrify"."Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AnalysisQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AnalysisQuestion_analysisId_createdAt_idx" ON "tickrify"."AnalysisQuestion"("analysisId", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalysisQuestion_userId_createdAt_idx" ON "tickrify"."AnalysisQuestion"("userId", "createdAt");
