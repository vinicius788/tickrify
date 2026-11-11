-- Alerta do My assets (11/11/2026): sem setup nem analise por tras. O boot do
-- SetupAlertsService faz o mesmo, so se ainda precisar e com lock_timeout.
ALTER TABLE "tickrify"."SetupAlert" ALTER COLUMN "setupId" DROP NOT NULL;
ALTER TABLE "tickrify"."SetupAlert" ALTER COLUMN "analysisId" DROP NOT NULL;
