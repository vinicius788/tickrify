-- CreateEnum
CREATE TYPE "tickrify"."TickTxType" AS ENUM ('PURCHASE', 'USAGE', 'REFUND', 'BONUS');

-- CreateTable
CREATE TABLE "tickrify"."user_ticks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ticks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickrify"."tick_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "tickrify"."TickTxType" NOT NULL,
    "description" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tick_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_ticks_userId_key" ON "tickrify"."user_ticks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tick_transactions_stripePaymentIntentId_key" ON "tickrify"."tick_transactions"("stripePaymentIntentId");

-- AddForeignKey
ALTER TABLE "tickrify"."tick_transactions" ADD CONSTRAINT "tick_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."user_ticks"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
