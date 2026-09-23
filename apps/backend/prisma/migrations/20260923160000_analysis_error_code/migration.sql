-- Campo opcional para falhas futuras. Análises antigas continuam sem código.
ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "errorCode" TEXT;
