-- Telemetria por analise (12/10/2026): o snapshot que a OpenAI de fato usou
-- (response.model) e os numeros do grounding do quick (ATR14, RSI14, swings,
-- posicao no range). Tambem criadas no boot (AiService) e gravadas por SQL.
-- Ficam FORA do schema.prisma ate existirem em producao.
ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "responseModel" TEXT;
ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "groundingStats" JSONB;
