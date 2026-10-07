-- Origem da analise (06/10/2026): { source, platform, chartSymbol, chartTimeframe }.
-- Hoje so a extensao de navegador grava; NULL = site. Tambem criada no boot
-- (AiService) e gravada por SQL. Fica FORA do schema.prisma de proposito: o
-- client nao conhece a coluna, entao create/update do worker nao dependem dela.
ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "clientContext" JSONB;
