-- Separa o veredicto MANUAL do trader do outcome AUTOMÁTICO do sweeper.
--
-- Contexto (27/07/2026): a coluna "outcome" estava guardando dois fatos
-- independentes e eles se destruíam mutuamente:
--   1. o sweeper busca por outcome IS NULL, então uma análise marcada à mão
--      pelo usuário nunca era avaliada e sumia da página /accuracy;
--   2. o setOutcome fazia UPDATE direto, então marcar um trade à mão apagava
--      um WIN/LOSS já medido — perda silenciosa de dado de medição.
--
-- A partir daqui:
--   "outcome"     = o que o mercado fez (escrito SÓ pelo sweeper, MAIÚSCULAS)
--   "userVerdict" = o que o trader diz que fez (escrito SÓ pelo setOutcome)
--
-- Migração puramente aditiva: coluna anulável, sem default, sem constraint,
-- sem reescrita de tabela. IF NOT EXISTS porque a aplicação também cria esta
-- coluna no boot (ai.service.onModuleInit) como rede de segurança.

ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "userVerdict" TEXT;

-- Move os veredictos manuais que ficaram presos em "outcome" para a coluna
-- certa. Só toca em linhas cujo valor é minúsculo — os valores do sweeper são
-- MAIÚSCULOS e não são afetados. Idempotente: rodar duas vezes não muda nada.
UPDATE "tickrify"."Analysis"
SET "userVerdict" = "outcome",
    "outcome"     = NULL
WHERE "outcome" IN ('tp1', 'tp2', 'stop', 'breakeven', 'open');

-- Efeito colateral desejado do UPDATE acima: essas análises voltam a ter
-- outcome NULL, então o sweeper vai avaliá-las na próxima varredura e elas
-- entram na amostra da /accuracy — recuperando os pontos que estavam perdidos.
