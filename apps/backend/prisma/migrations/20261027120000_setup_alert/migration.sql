-- Alertas de nivel dos setups acompanhados (27/10/2026). Tabelas tambem
-- criadas no boot (SetupAlertsService.onModuleInit). Fora do schema.prisma, como
-- TrackedSetup e UserTrial: tudo e lido e gravado por SQL.
CREATE TABLE IF NOT EXISTS "tickrify"."SetupAlert" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "setupId" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "priceSymbol" TEXT NOT NULL,
  "level" DOUBLE PRECISION NOT NULL,
  "label" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "referencePrice" DOUBLE PRECISION NOT NULL,
  "prefilled" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "watchFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "triggeredAt" TIMESTAMP(3),
  "triggerPrice" DOUBLE PRECISION,
  "emailedAt" TIMESTAMP(3),
  "seenAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "SetupAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SetupAlert_label_check" CHECK ("label" IN ('entry', 'stop', 'tp1', 'invalidation', 'custom')),
  CONSTRAINT "SetupAlert_side_check" CHECK ("side" IN ('above', 'below')),
  CONSTRAINT "SetupAlert_status_check" CHECK ("status" IN ('active', 'triggered', 'cancelled')),
  CONSTRAINT "SetupAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SetupAlert_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "tickrify"."TrackedSetup"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
CREATE INDEX IF NOT EXISTS "SetupAlert_status_priceSymbol_idx" ON "tickrify"."SetupAlert"("status", "priceSymbol");
CREATE INDEX IF NOT EXISTS "SetupAlert_userId_status_idx" ON "tickrify"."SetupAlert"("userId", "status");
CREATE INDEX IF NOT EXISTS "SetupAlert_setupId_idx" ON "tickrify"."SetupAlert"("setupId");
CREATE TABLE IF NOT EXISTS "tickrify"."AlertPriceCheck" (
  "symbol" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "checkedAt" TIMESTAMP(3),
  "lastPrice" DOUBLE PRECISION,
  "lastCandleAt" TIMESTAMP(3),
  CONSTRAINT "AlertPriceCheck_pkey" PRIMARY KEY ("symbol")
  );
