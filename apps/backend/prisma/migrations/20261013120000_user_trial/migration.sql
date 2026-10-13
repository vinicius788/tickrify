-- Trial de 3 dias sem cartao (13/10/2026). Tabela tambem criada no boot
-- (TrialService.onModuleInit) e lida por SQL; fica FORA do schema.prisma ate
-- existir em producao (mesma regra de TrackedSetup).
CREATE TABLE IF NOT EXISTS "tickrify"."UserTrial" (
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "convertedAt" TIMESTAMP(3),
    "dayAtConversion" INTEGER,
    "usageDays" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "analysesToday" INTEGER NOT NULL DEFAULT 0,
    "todayDate" TEXT,
    "source" TEXT NOT NULL DEFAULT 'signup',
    "denyReason" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserTrial_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "UserTrial_status_check" CHECK ("status" IN ('active', 'ended_converted', 'ended_unconverted', 'denied')),
    CONSTRAINT "UserTrial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "UserTrial_status_startedAt_idx" ON "tickrify"."UserTrial"("status", "startedAt");
CREATE INDEX IF NOT EXISTS "UserTrial_ipHash_startedAt_idx" ON "tickrify"."UserTrial"("ipHash", "startedAt");

-- Print repetido no trial: a mesma imagem devolve a leitura anterior, sem IA.
ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "imageSha256" TEXT;
