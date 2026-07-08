ALTER TABLE "tickrify"."Analysis"
ADD COLUMN "result" JSONB,
ADD COLUMN "errorMessage" TEXT;

ALTER TABLE "tickrify"."Analysis"
ALTER COLUMN "fullResponse" TYPE TEXT
USING CASE
  WHEN "fullResponse" IS NULL THEN NULL
  ELSE "fullResponse"::text
END;
