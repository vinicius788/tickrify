-- Outcome tracking: resultado real da análise verificado 48h depois nos candles.
-- outcome: WIN | LOSS | TIMEOUT | NO_FILL | ABSTAIN | INCOMPLETE | UNTRACKABLE
ALTER TABLE "tickrify"."Analysis" ADD COLUMN "outcome" TEXT;
ALTER TABLE "tickrify"."Analysis" ADD COLUMN "outcomeAt" TIMESTAMP(3);
ALTER TABLE "tickrify"."Analysis" ADD COLUMN "outcomeDetail" JSONB;

CREATE INDEX "Analysis_outcome_createdAt_idx" ON "tickrify"."Analysis"("outcome", "createdAt");
