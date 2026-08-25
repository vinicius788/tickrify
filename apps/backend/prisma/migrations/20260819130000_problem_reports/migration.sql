-- Botão de reportar problema (item 8).
--
-- O objetivo não é "ter um formulário": é encurtar o caminho entre o usuário
-- ver algo errado e alguém conseguir REPRODUZIR. Por isso a tabela guarda o
-- contexto técnico junto com o texto — rota, análise envolvida, navegador e as
-- últimas ações do usuário. Um relato sem contexto vira "não consegui
-- reproduzir" e morre.

CREATE TABLE IF NOT EXISTS "tickrify"."ProblemReport" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT,
    "message"     TEXT NOT NULL,
    "route"       TEXT,
    "analysisId"  TEXT,
    "context"     JSONB,
    "status"      TEXT NOT NULL DEFAULT 'aberto',
    "resolvedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProblemReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProblemReport_status_createdAt_idx"
  ON "tickrify"."ProblemReport"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ProblemReport_userId_createdAt_idx"
  ON "tickrify"."ProblemReport"("userId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProblemReport_userId_fkey') THEN
    ALTER TABLE "tickrify"."ProblemReport"
      ADD CONSTRAINT "ProblemReport_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- Estados fechados: 'aberto' | 'investigando' | 'resolvido' | 'descartado'.
  -- Sem isto um typo no painel cria um estado que nenhum filtro encontra, e o
  -- relato some da lista sem ninguém perceber.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProblemReport_status_valido') THEN
    ALTER TABLE "tickrify"."ProblemReport"
      ADD CONSTRAINT "ProblemReport_status_valido"
      CHECK ("status" IN ('aberto', 'investigando', 'resolvido', 'descartado'));
  END IF;
END $$;

-- RLS na mesma linha das demais tabelas (item 5): sem policies, só o dono
-- (a conexão do Prisma) acessa. O relato pode conter o que o usuário digitou,
-- então não é dado para ficar exposto ao PostgREST.
ALTER TABLE "tickrify"."ProblemReport" ENABLE ROW LEVEL SECURITY;
