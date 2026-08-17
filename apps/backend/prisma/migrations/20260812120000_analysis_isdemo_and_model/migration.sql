-- Fecha o drift entre schema.prisma e as migrações (12/08/2026).
--
-- As colunas "isDemo" e "model" estão no schema.prisma e são usadas pela
-- aplicação, mas não eram criadas por migração nenhuma. Em produção elas
-- existem (adicionadas à mão / pelo hook de boot do AiService), então esta
-- migração é NO-OP lá. O que ela conserta é o banco criado DO ZERO:
-- antes disto, `prisma migrate deploy` num banco limpo produzia um schema
-- incompleto e a primeira análise de qualquer usuário estourava.
--
-- "isDemo" é o portão da cota grátis (enforceAccessAndCreate conta isDemo=true)
-- e o filtro que impede análise da demo de vazar para /ai/public-analyses.
-- "model" é o que permite comparar calibração entre modelos na /accuracy.
--
-- IF NOT EXISTS de propósito: precisa ser seguro rodar sobre a produção atual.

ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "model" TEXT;
