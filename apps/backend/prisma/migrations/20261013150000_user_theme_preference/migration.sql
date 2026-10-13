-- Tema da area logada escolhido em Configuracoes (13/10/2026). NULL = escuro.
-- Tambem criada no boot (AuthController) e lida/gravada por SQL. Fica FORA do
-- schema.prisma de proposito, como o clientContext.
ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "themePreference" TEXT;
