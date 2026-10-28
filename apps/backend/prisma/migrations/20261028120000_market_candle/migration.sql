-- Armazem de velas (28/10/2026): REAL DATA de toda analise, ate 500 velas por
-- par, compartilhado entre usuarios. Tambem criado no boot (registerCandleStore).
-- Fora do schema.prisma: lido e gravado por SQL (market/candle-store.ts).
CREATE TABLE IF NOT EXISTS "tickrify"."MarketCandle" (
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "openTime" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketCandle_pkey" PRIMARY KEY ("symbol", "timeframe", "openTime")
  );
