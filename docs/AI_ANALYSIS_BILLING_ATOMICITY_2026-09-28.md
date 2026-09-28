# Criação e cobrança da análise — 28/09/2026

## Falha encontrada

No caminho pago, `enforceAccessAndCreate` debitava os ticks numa transação e só depois criava a linha `Analysis` fora dela. Se a segunda gravação falhasse, o usuário perderia 1 tick no quick ou 3 no deep sem existir análise a processar ou ID para o reembolso normal. No fallback síncrono, a leitura do saldo e a validação inicial da imagem também aconteciam antes do `try/catch` que marca a análise como falha e devolve os ticks.

## Mudança preparada no branch isolado

- Débito (`userTicks` e `tickTransaction`) e criação de `Analysis` agora participam da **mesma transação Prisma**. `TicksService.debitTicks` continua abrindo sua própria transação para os outros chamadores, mas aceita a transação do chamador quando a análise precisa incluir a criação. Falha no insert aborta a transação inteira; saldo insuficiente ainda impede a criação.
- No fallback síncrono, leitura de saldo e pre-hooks entram no fluxo de falha já existente. Se uma dessas etapas falhar após a criação, a análise fica `failed` e o reembolso idempotente é tentado.
- Sem mudança de prompt, modelo, número de ticks, quota grátis, schema ou migração.

## Verificação e limite

Os testes exercitam a transação compartilhada, a falha do insert, saldo insuficiente e reembolso após bloqueio no pre-hook. A suíte completa do backend passou com **36 suítes / 324 testes**; TypeScript e build do backend/worker passaram. Em 28/09, uma verificação adicional com PostgreSQL 18.3 local e descartável confirmou que a falha do insert desfaz o débito e a transação de uso; o caminho bem-sucedido gravou os três registros juntos. Os serviços temporários foram encerrados. Ainda falta validar o fluxo completo em staging antes de qualquer implantação.

Este ajuste cobre a criação da linha e o processamento síncrono. O despacho posterior para a fila (`queue.add`) ainda pode falhar depois de uma criação paga confirmada. O [ID estável e a auditoria somente de leitura](AI_ANALYSIS_DISPATCH_AUDIT_2026-09-28.md) ajudam a identificar esse caso, mas a recuperação automática precisa de um desenho separado, testado contra Redis e banco em staging. Não houve push, migração aplicada nem alteração em produção.
