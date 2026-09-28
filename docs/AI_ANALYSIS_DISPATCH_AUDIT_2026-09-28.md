# Auditoria do despacho de análises — 28/09/2026

## Motivo

A linha da análise paga já existe quando a API chama `queue.add`. Se a chamada falhar, o resultado é ambíguo: o Redis pode ter gravado o job e perdido só a confirmação. Reprocessar ou reembolsar automaticamente nesse ponto pode entregar duas análises ou devolver ticks por uma análise que está rodando. O branch não introduz essa compensação automática.

## Preparação segura

Novos jobs recebem `jobId` igual ao `Analysis.id`. Isso permite consultar exatamente o job daquela análise e faz o BullMQ deduplicar o mesmo ID. Em um Redis local descartável, duas chamadas `queue.add` com o mesmo ID resultaram em **um único job aguardando**; `getJob` recuperou os dados esperados. O worker continua recebendo o mesmo payload; não há mudança de modelo, prompt, cobrança, schema ou migração.

O script [`analysis-dispatch-audit.ts`](../apps/backend/scripts/analysis-dispatch-audit.ts) faz somente `Analysis.findMany`, `queue.getJob` e `job.getState`, sem escrever em banco ou fila. Ele lista análises `pending`/`processing` mais antigas que o limite, mostrando apenas ID interno, estado, se era demo, horário e estado do job. Não imprime usuário, imagem, preço, prompt, saldo ou credenciais. Consulta o Redis sequencialmente, com limite máximo de 500 linhas. `not_found`, job concluído/falho com análise ainda pendente e ID divergente são marcados para revisão; falha da consulta é `lookup_error`, **não** prova ausência do job. O script não reembolsa nem reenvia análises.

Executar **somente depois de existir um horário de ativação conhecido** para os IDs estáveis, passando esse horário em `--since`. Jobs mais antigos tinham ID automático; consultá-los pelo ID da análise produziria falsos `not_found`.

```bash
cd apps/backend
pnpm exec ts-node scripts/analysis-dispatch-audit.ts \
  --since 2026-09-28T12:00:00Z --min-age-minutes 10 --limit 100
```

O horário acima é apenas exemplo, não representa uma implantação. O script não foi executado contra produção ou staging porque este worktree não tem essas conexões. Antes de qualquer reparo manual, conferir os estados no banco e no Redis, o histórico de reembolso e os logs do worker. O próximo desenho precisa recuperar de forma idempotente um despacho cuja confirmação foi perdida; isso requer teste integrado de falha de rede, banco e Redis em staging.

Validação local: **37 suítes / 326 testes** do backend e build do backend/worker passaram. A CLI recusou `--since` inválido antes de abrir conexões.
