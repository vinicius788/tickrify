-- Anotacao do trader por trade no Diario (05/10/2026): nota, setup, emocao e
-- erros num JSON so. NULL = sem anotacao. Tambem criada no boot (AiService).
-- O campo entra no schema.prisma so DEPOIS de a coluna existir em producao:
-- com o campo no client, o `update`/`create` do worker devolve todas as
-- colunas e falharia se rodasse antes do ALTER do boot.
ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "tradeNote" JSONB;
