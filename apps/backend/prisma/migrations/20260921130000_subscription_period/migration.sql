-- Periodo de cobranca na assinatura: janela mensal do saldo de ticks.
ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMP(3);
ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3);
