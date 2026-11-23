-- E-mail repetido (23/11/2026): e-mail normalizado como coluna GERADA (preenche as linhas antigas e novas
-- sozinha). Mesma regra de normalizeEmail/normalizedEmailSql em common/trial.ts; o boot do TrialService roda o mesmo SQL.
-- Fora do schema.prisma.
ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "emailNormalized" TEXT GENERATED ALWAYS AS (CASE WHEN split_part(regexp_replace(lower("email"), '\s', '', 'g'), '@', 2) IN ('gmail.com', 'googlemail.com') THEN NULLIF(replace(split_part(split_part(regexp_replace(lower("email"), '\s', '', 'g'), '@', 1), '+', 1), '.', ''), '') || '@gmail.com'
    WHEN split_part(regexp_replace(lower("email"), '\s', '', 'g'), '@', 2) <> '' THEN NULLIF(split_part(split_part(regexp_replace(lower("email"), '\s', '', 'g'), '@', 1), '+', 1), '') || '@' || split_part(regexp_replace(lower("email"), '\s', '', 'g'), '@', 2) END) STORED;
CREATE INDEX IF NOT EXISTS "User_emailNormalized_idx" ON "tickrify"."User"("emailNormalized");
