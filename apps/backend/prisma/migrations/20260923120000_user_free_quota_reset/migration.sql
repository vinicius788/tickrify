ALTER TABLE "tickrify"."User"
  ADD COLUMN IF NOT EXISTS "freeQuotaResetAt" TIMESTAMP(3);
