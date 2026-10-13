-- Estado da operacao e checagens de gerenciamento (13/10/2026). Tambem criadas
-- no boot (TradesService.onModuleInit) e lidas por SQL; fora do schema.prisma
-- ate existirem em producao (mesma regra de TrackedSetup e UserTrial).
CREATE TABLE IF NOT EXISTS "tickrify"."TradeState" (
    "analysisId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "symbol" TEXT,
    "timeframe" TEXT,
    "entryPrice" DOUBLE PRECISION,
    "plannedEntry" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "target" DOUBLE PRECISION,
    "pendingAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "timeline" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeState_pkey" PRIMARY KEY ("analysisId"),
    CONSTRAINT "TradeState_status_check" CHECK ("status" IN ('suggested', 'pending_order', 'in_trade', 'closed', 'cancelled', 'expired')),
    CONSTRAINT "TradeState_closeReason_check" CHECK ("closeReason" IS NULL OR "closeReason" IN ('target_hit', 'stop_hit', 'breakeven', 'manual', 'invalidated', 'cancelled')),
    CONSTRAINT "TradeState_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "tickrify"."Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TradeState_userId_status_idx" ON "tickrify"."TradeState"("userId", "status");
CREATE TABLE IF NOT EXISTS "tickrify"."TradeCheck" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "currentPrice" DOUBLE PRECISION,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeCheck_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradeCheck_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "tickrify"."Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TradeCheck_analysisId_createdAt_idx" ON "tickrify"."TradeCheck"("analysisId", "createdAt");
CREATE INDEX IF NOT EXISTS "TradeCheck_userId_isFree_createdAt_idx" ON "tickrify"."TradeCheck"("userId", "isFree", "createdAt");
