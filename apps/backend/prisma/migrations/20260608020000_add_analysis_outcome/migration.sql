-- Adiciona rastreamento de resultado da análise (tudo nullable / aditivo — sem alterar dados existentes).
ALTER TABLE "tickrify"."Analysis" ADD COLUMN "outcome" TEXT;
ALTER TABLE "tickrify"."Analysis" ADD COLUMN "pnlPercent" DOUBLE PRECISION;
ALTER TABLE "tickrify"."Analysis" ADD COLUMN "pnlAmount" DOUBLE PRECISION;
ALTER TABLE "tickrify"."Analysis" ADD COLUMN "closedAt" TIMESTAMP(3);
