-- Lista de ativos da pessoa (10/11/2026). Fora do schema.prisma; o boot do
-- WatchAssetsService cria a mesma tabela.
CREATE TABLE IF NOT EXISTS "tickrify"."UserWatchAsset" (
  "userId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "UserWatchAsset_pkey" PRIMARY KEY ("userId", "symbol")
);
