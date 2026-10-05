-- Quadrinho de opiniao do painel (05/10/2026): mesma tabela dos relatos de
-- problema, separada por `kind`. Linhas antigas sao todas relatos de problema.
ALTER TABLE "tickrify"."ProblemReport" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'problem';
