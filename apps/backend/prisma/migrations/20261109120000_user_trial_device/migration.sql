ALTER TABLE "tickrify"."UserTrial" ADD COLUMN IF NOT EXISTS "deviceHash" TEXT;
CREATE INDEX IF NOT EXISTS "UserTrial_deviceHash_idx" ON "tickrify"."UserTrial"("deviceHash");
