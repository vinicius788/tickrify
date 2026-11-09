-- Validade do alerta automatico do WATCH (null = alerta feito a mao, nao expira).
ALTER TABLE "tickrify"."SetupAlert" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
