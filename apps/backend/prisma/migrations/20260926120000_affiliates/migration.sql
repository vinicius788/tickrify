-- Programa de afiliados. So aditivo: nenhuma tabela existente muda.
-- Idempotente (IF NOT EXISTS) porque o AffiliatesService.onModuleInit roda o
-- mesmo SQL no boot (RUN_MIGRATIONS_ON_START=false em producao).
-- Dinheiro em centavos de USD (INTEGER), taxa em pontos-base (2000 = 20%).

CREATE TABLE IF NOT EXISTS "tickrify"."Affiliate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "couponCode" TEXT NOT NULL,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 2000,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stripePromotionCodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Affiliate_status_check" CHECK ("status" IN ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED')),
    CONSTRAINT "Affiliate_rate_check" CHECK ("commissionRateBps" >= 0 AND "commissionRateBps" <= 10000),
    CONSTRAINT "Affiliate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "tickrify"."AffiliateClick" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "landingPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AffiliateClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "tickrify"."Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "tickrify"."AffiliateReferral" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "clickId" TEXT,
    "firstPaidAt" TIMESTAMP(3),
    "commissionEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AffiliateReferral_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AffiliateReferral_source_check" CHECK ("source" IN ('link', 'coupon')),
    CONSTRAINT "AffiliateReferral_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "tickrify"."Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AffiliateReferral_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "tickrify"."AffiliatePayout" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "method" TEXT NOT NULL,
    "adminNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "decidedById" TEXT,
    CONSTRAINT "AffiliatePayout_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AffiliatePayout_status_check" CHECK ("status" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID')),
    CONSTRAINT "AffiliatePayout_amount_check" CHECK ("amountCents" >= 0),
    CONSTRAINT "AffiliatePayout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "tickrify"."Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "tickrify"."AffiliateCommission" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "referralId" TEXT,
    "referredUserId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "stripePaymentIntentId" TEXT,
    "amountPaidCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "payoutId" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AffiliateCommission_status_check" CHECK ("status" IN ('PENDING', 'AVAILABLE', 'PAID', 'CANCELLED')),
    CONSTRAINT "AffiliateCommission_amount_check" CHECK ("amountPaidCents" >= 0 AND "commissionCents" >= 0),
    CONSTRAINT "AffiliateCommission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "tickrify"."Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCommission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "tickrify"."AffiliateReferral"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCommission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "tickrify"."AffiliatePayout"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_userId_key" ON "tickrify"."Affiliate"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_referralCode_key" ON "tickrify"."Affiliate"("referralCode");
CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_couponCode_key" ON "tickrify"."Affiliate"("couponCode");
CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_stripePromotionCodeId_key" ON "tickrify"."Affiliate"("stripePromotionCodeId");
CREATE INDEX IF NOT EXISTS "AffiliateClick_affiliateId_createdAt_idx" ON "tickrify"."AffiliateClick"("affiliateId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateReferral_userId_key" ON "tickrify"."AffiliateReferral"("userId");
CREATE INDEX IF NOT EXISTS "AffiliateReferral_affiliateId_createdAt_idx" ON "tickrify"."AffiliateReferral"("affiliateId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateCommission_stripeInvoiceId_key" ON "tickrify"."AffiliateCommission"("stripeInvoiceId");
CREATE INDEX IF NOT EXISTS "AffiliateCommission_affiliateId_status_idx" ON "tickrify"."AffiliateCommission"("affiliateId", "status");
CREATE INDEX IF NOT EXISTS "AffiliateCommission_status_availableAt_idx" ON "tickrify"."AffiliateCommission"("status", "availableAt");
CREATE INDEX IF NOT EXISTS "AffiliateCommission_stripeChargeId_idx" ON "tickrify"."AffiliateCommission"("stripeChargeId");
CREATE INDEX IF NOT EXISTS "AffiliateCommission_stripePaymentIntentId_idx" ON "tickrify"."AffiliateCommission"("stripePaymentIntentId");
CREATE INDEX IF NOT EXISTS "AffiliatePayout_affiliateId_status_idx" ON "tickrify"."AffiliatePayout"("affiliateId", "status");
CREATE INDEX IF NOT EXISTS "AffiliatePayout_status_requestedAt_idx" ON "tickrify"."AffiliatePayout"("status", "requestedAt");
