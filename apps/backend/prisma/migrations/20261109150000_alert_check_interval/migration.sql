-- Intervalo em vigor por ativo no monitor de alertas (a tela mostra o real).
ALTER TABLE "tickrify"."AlertPriceCheck" ADD COLUMN IF NOT EXISTS "intervalMs" INTEGER;
