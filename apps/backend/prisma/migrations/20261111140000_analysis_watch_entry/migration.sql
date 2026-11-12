-- "I entered" num WATCH (11/11/2026). Fora do schema.prisma; o boot do AiService
-- cria a mesma coluna com flag propria.
ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "watchEntry" JSONB;
