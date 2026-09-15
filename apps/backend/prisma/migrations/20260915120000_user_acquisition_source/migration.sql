-- Origem declarada pelo proprio usuario no primeiro acesso ao painel.
-- Aditivo e idempotente: o mesmo SQL roda no onModuleInit do AuthController
-- como rede de seguranca, porque RUN_MIGRATIONS_ON_START=false em producao.
ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "acquisitionSource" TEXT;
ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "acquisitionDetail" TEXT;
ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "acquisitionAnsweredAt" TIMESTAMP(3);
