-- CreateTable
CREATE TABLE "tickrify"."AdminAudit" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "targetUserId" TEXT,
    "targetEmail" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAudit_createdAt_idx" ON "tickrify"."AdminAudit"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAudit_action_createdAt_idx" ON "tickrify"."AdminAudit"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAudit_actorUserId_createdAt_idx" ON "tickrify"."AdminAudit"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAudit_targetUserId_createdAt_idx" ON "tickrify"."AdminAudit"("targetUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "tickrify"."AdminAudit" ADD CONSTRAINT "AdminAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "tickrify"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickrify"."AdminAudit" ADD CONSTRAINT "AdminAudit_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "tickrify"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
