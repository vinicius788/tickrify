-- Cancelamento pelo portal da Stripe (13/10/2026): agendado, motivo e fim.
-- Tambem criadas no boot (StripeService) e gravadas por SQL. Ficam FORA do
-- schema.prisma de proposito: o upsert da assinatura nao depende delas.
ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS "cancelAt" TIMESTAMP(3);
ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3);
ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "tickrify"."Subscription" ADD COLUMN IF NOT EXISTS "cancelFeedback" TEXT;
