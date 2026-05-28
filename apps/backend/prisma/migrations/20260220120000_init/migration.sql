-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tickrify";

-- CreateTable
CREATE TABLE "tickrify"."User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "subscriptionStatus" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickrify"."Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickrify"."Analysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL,
    "recommendation" TEXT,
    "confidence" DOUBLE PRECISION,
    "reasoning" TEXT,
    "fullResponse" JSONB,
    "promptVer" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickrify"."AnalysisUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickrify"."PromptConfig" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickrify"."PromptAudit" (
    "id" TEXT NOT NULL,
    "promptConfigId" TEXT,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorClerkUserId" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "tickrify"."User"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "tickrify"."User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "tickrify"."User"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeId_key" ON "tickrify"."Subscription"("stripeId");

-- CreateIndex
CREATE INDEX "Analysis_userId_createdAt_idx" ON "tickrify"."Analysis"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Analysis_status_idx" ON "tickrify"."Analysis"("status");

-- CreateIndex
CREATE INDEX "AnalysisUsage_periodType_periodStart_idx" ON "tickrify"."AnalysisUsage"("periodType", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisUsage_userId_periodType_periodStart_key" ON "tickrify"."AnalysisUsage"("userId", "periodType", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "PromptConfig_version_key" ON "tickrify"."PromptConfig"("version");

-- CreateIndex
CREATE INDEX "PromptConfig_isActive_idx" ON "tickrify"."PromptConfig"("isActive");

-- CreateIndex
CREATE INDEX "PromptAudit_createdAt_idx" ON "tickrify"."PromptAudit"("createdAt");

-- CreateIndex
CREATE INDEX "PromptAudit_actorUserId_createdAt_idx" ON "tickrify"."PromptAudit"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptAudit_action_createdAt_idx" ON "tickrify"."PromptAudit"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "tickrify"."Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickrify"."Analysis" ADD CONSTRAINT "Analysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickrify"."AnalysisUsage" ADD CONSTRAINT "AnalysisUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickrify"."PromptAudit" ADD CONSTRAINT "PromptAudit_promptConfigId_fkey" FOREIGN KEY ("promptConfigId") REFERENCES "tickrify"."PromptConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickrify"."PromptAudit" ADD CONSTRAINT "PromptAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

