-- Pedido de entrada no programa de afiliados: canal, link, tamanho da
-- audiencia e plano de divulgacao. So aditivo; o boot roda o mesmo SQL.
ALTER TABLE "tickrify"."Affiliate" ADD COLUMN IF NOT EXISTS "applicationPlatform" TEXT;
ALTER TABLE "tickrify"."Affiliate" ADD COLUMN IF NOT EXISTS "applicationUrl" TEXT;
ALTER TABLE "tickrify"."Affiliate" ADD COLUMN IF NOT EXISTS "applicationAudience" TEXT;
ALTER TABLE "tickrify"."Affiliate" ADD COLUMN IF NOT EXISTS "applicationNote" TEXT;
