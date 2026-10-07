-- Pagamento em cripto de passe pre-pago (07/10/2026). Tambem criada no boot
-- (CryptoService.onModuleInit), igual as tabelas de afiliados.
CREATE TABLE IF NOT EXISTS "tickrify"."CryptoPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pass" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "providerInvoiceId" TEXT,
    "providerPaymentId" TEXT,
    "payCurrency" TEXT,
    "actuallyPaid" TEXT,
    "subscriptionId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CryptoPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CryptoPayment_pass_check" CHECK ("pass" IN ('week', 'month')),
    CONSTRAINT "CryptoPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CryptoPayment_providerInvoiceId_key" ON "tickrify"."CryptoPayment"("providerInvoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "CryptoPayment_providerPaymentId_key" ON "tickrify"."CryptoPayment"("providerPaymentId");
CREATE INDEX IF NOT EXISTS "CryptoPayment_userId_createdAt_idx" ON "tickrify"."CryptoPayment"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "CryptoPayment_status_idx" ON "tickrify"."CryptoPayment"("status");
