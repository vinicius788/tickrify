-- Revisao mensal do motor (02/11/2026): lado do plano, ATR e a referencia de
-- direcao (a mercado na analise, stop e alvo de 1 ATR) em cada linha do
-- rastreador. Tambem criado no boot do worker (startAnalysisTracker).
ALTER TABLE "tickrify"."AnalysisTrack" ADD COLUMN IF NOT EXISTS "direction" TEXT;
ALTER TABLE "tickrify"."AnalysisTrack" ADD COLUMN IF NOT EXISTS "atr" DOUBLE PRECISION;
ALTER TABLE "tickrify"."AnalysisTrack" ADD COLUMN IF NOT EXISTS "refOutcome" TEXT;
ALTER TABLE "tickrify"."AnalysisTrack" ADD COLUMN IF NOT EXISTS "refFillPrice" DOUBLE PRECISION;
