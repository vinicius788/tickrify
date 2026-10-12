-- Setups acompanhados (12/10/2026): o trader segue um setup e volta para
-- atualizar com uma analise nova. Tabela e coluna tambem criadas no boot
-- (SetupsService.onModuleInit). Os campos entram no schema.prisma so DEPOIS de
-- existirem em producao: com `setupId` no client, o `update`/`create` do
-- worker devolve todas as colunas e falharia se rodasse antes do ALTER do boot.
CREATE TABLE IF NOT EXISTS "tickrify"."TrackedSetup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rootAnalysisId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'tracking',
    "symbol" TEXT,
    "timeframe" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAnalysisAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "TrackedSetup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrackedSetup_status_check" CHECK ("status" IN ('tracking', 'untracked', 'archived')),
    CONSTRAINT "TrackedSetup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrackedSetup_rootAnalysisId_key" ON "tickrify"."TrackedSetup"("rootAnalysisId");
CREATE INDEX IF NOT EXISTS "TrackedSetup_userId_status_lastAnalysisAt_idx" ON "tickrify"."TrackedSetup"("userId", "status", "lastAnalysisAt");

ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "setupId" TEXT;
-- Em producao este indice e criado a mao (CONCURRENTLY, SQL entregue ao dono):
-- o boot nao cria indice na tabela Analysis.
CREATE INDEX IF NOT EXISTS "Analysis_setupId_idx" ON "tickrify"."Analysis"("setupId");
