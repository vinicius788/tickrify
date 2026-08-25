-- Loja de apps interna: overrides de feature flag no banco (item 7).
--
-- Só guarda OVERRIDE. Ausência de linha = "usa a variável de ambiente / o
-- padrão do código". Por isso a tabela nasce vazia e nada muda de comportamento
-- no momento em que esta migração roda.
--
-- IF NOT EXISTS porque o hook de boot do AiService cria a mesma tabela como
-- rede de segurança (RUN_MIGRATIONS_ON_START=false em produção).

CREATE TABLE IF NOT EXISTS "tickrify"."FeatureFlag" (
    "key"         TEXT NOT NULL,
    "value"       TEXT NOT NULL,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeatureFlag_updatedById_fkey') THEN
    ALTER TABLE "tickrify"."FeatureFlag"
      ADD CONSTRAINT "FeatureFlag_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "tickrify"."User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- RLS na mesma linha das outras tabelas (item 5). Sem policies: só o dono
-- (a conexão do Prisma) acessa; anon/authenticated do PostgREST ficam de fora.
ALTER TABLE "tickrify"."FeatureFlag" ENABLE ROW LEVEL SECURITY;
