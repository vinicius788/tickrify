ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "strategyProfile" JSONB;
ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "strategyHash" TEXT;
-- SEM indice em strategyHash, e isto e deliberado. A coluna e NULL em quase
-- 100% das linhas e as quatro queries publicas filtram justamente por NULL, o
-- que um indice comum nao acelera. Ele so custaria escrita em toda analise
-- nova. Se um dia houver volume com estrategia e for preciso segmentar, o
-- indice certo e PARCIAL: WHERE "strategyHash" IS NOT NULL.
