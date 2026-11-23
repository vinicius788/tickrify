-- Watch que arma sozinho (23/11/2026): resultado da conferencia do plano no disparo do alerta
-- { status: 'armed' | 'invalidated' | 'pending', direction, entry, stop, target, checkedAt }. Fora do schema.prisma.
ALTER TABLE "tickrify"."SetupAlert" ADD COLUMN IF NOT EXISTS "armCheck" JSONB;
