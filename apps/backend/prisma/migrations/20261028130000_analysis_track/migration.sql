-- Rastreador de resultado do v10.3 (28/10/2026): toque, fill, TP1/stop/TIMEOUT,
-- MFE/MAE e missed de cada plano, ligado a analise e a versao do prompt. Tambem
-- criado no boot do worker (startAnalysisTracker). Fora do schema.prisma.
CREATE TABLE IF NOT EXISTS "tickrify"."AnalysisTrack" (
    "analysisId" TEXT NOT NULL,
    "promptVer" INTEGER,
    "engineVersion" TEXT,
    "symbol" TEXT,
    "timeframe" TEXT,
    "signalState" TEXT NOT NULL,
    "dataMode" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "outcome" TEXT,
    "touched" BOOLEAN NOT NULL DEFAULT false,
    "touchedAt" TIMESTAMP(3),
    "filled" BOOLEAN NOT NULL DEFAULT false,
    "fillAt" TIMESTAMP(3),
    "fillPrice" DOUBLE PRECISION,
    "entry" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit1" DOUBLE PRECISION,
    "mfeR" DOUBLE PRECISION,
    "maeR" DOUBLE PRECISION,
    "missed" BOOLEAN NOT NULL DEFAULT false,
    "candleInterval" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalysisTrack_pkey" PRIMARY KEY ("analysisId"),
    CONSTRAINT "AnalysisTrack_status_check" CHECK ("status" IN ('tracked', 'skipped')),
    CONSTRAINT "AnalysisTrack_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "tickrify"."Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
CREATE INDEX IF NOT EXISTS "AnalysisTrack_promptVer_idx" ON "tickrify"."AnalysisTrack"("promptVer");
