# Sistema de prompts de IA

Este guia descreve o comportamento implementado atualmente. Ele nao define
promessas de qualidade, tempo de resposta ou uma arquitetura de agentes.

## Fontes de verdade

- Prompt canonico no codigo: `apps/backend/src/common/prompts/trading-system-prompt.ts`
- Variante de experimento: `apps/backend/src/common/prompts/trading-system-prompt-v9.ts`
- Composicao final: `apps/backend/src/modules/prompt/prompt-builder.service.ts`
- Sincronizacao no boot: `apps/backend/src/modules/prompt/prompt-sync.service.ts`
- Administracao de versoes: `apps/backend/src/modules/prompt/prompt.controller.ts`
- Caminho assincrono: `apps/backend/worker/ai.worker.ts`

Nao trate textos antigos em handoffs, sprints ou relatorios como prompts ativos.

## Como o prompt e resolvido

O prompt final segue esta ordem, conforme o caminho de execucao:

1. Override interno, quando fornecido pelo proprio backend.
2. Versao persistida especifica, quando um job da fila carrega `promptVersion`.
3. `PromptConfig` ativo mais recente no banco.
4. `TRADING_SYSTEM_PROMPT` do codigo como fallback.

O backend acrescenta a instrucao de consistencia deterministica. Analises
`deep` tambem recebem a instrucao de leitura em camadas. Nos caminhos que
carregam o idioma do usuario, o contexto de idioma e injetado antes dessas
instrucoes. O prompt ativo possui cache de 60 segundos no processo da API.

`promptOverride` nao faz parte do contrato publico de `/api/ai/analyze`. Essa
restricao e intencional para impedir que clientes substituam as regras do
sistema. O backend pode usa-lo internamente em testes e no experimento
controlado por `AB_PROMPT_V9_PERCENT`, cuja distribuicao e estavel por usuario.

## Sincronizacao e versoes

No boot, `PromptSyncService` compara o prompt canonico do codigo com a versao
ativa no banco:

- se forem iguais, nao grava nada;
- se forem diferentes, desativa a versao ativa, cria uma nova versao e a ativa;
- se a sincronizacao falhar, registra o erro e permite que a aplicacao suba;
- `PROMPT_AUTO_SYNC=false` desliga esse comportamento.

O historico nao e apagado. Uma versao ativada manualmente no banco pode ser
substituida no proximo boot se diferir do prompt do codigo e o auto-sync estiver
ligado.

## Administracao

Todas as rotas abaixo exigem `AuthGuard` e `AdminGuard`:

| Metodo | Rota | Funcao |
| --- | --- | --- |
| `POST` | `/api/prompts/config` | Cria uma versao e, por padrao, a ativa. |
| `GET` | `/api/prompts/latest` | Retorna a versao ativa mais recente. |
| `GET` | `/api/prompts/list` | Lista o historico de versoes. |
| `GET` | `/api/prompts/:version` | Busca uma versao numerica. |
| `POST` | `/api/prompts/:version/activate` | Ativa uma versao existente. |

As rotas possuem rate limit. O teste de acesso em
`apps/backend/src/common/guards/__tests__/route-access.spec.ts` protege esse
contrato contra exposicao acidental.

## Alteracao segura

Para uma mudanca que deve acompanhar o codigo:

1. Edite somente a fonte canonica e os testes relacionados.
2. Preserve o contrato JSON consumido pelo normalizador e pela interface.
3. Verifique os caminhos quick, deep, API direta e worker.
4. Execute os testes e o build antes do deploy.
5. Depois do deploy, confirme nos logs se a versao foi sincronizada ou ja estava em dia.
6. Valide uma amostra controlada antes de ampliar qualquer experimento.

Comandos minimos:

```bash
pnpm --dir apps/backend exec tsc --noEmit -p tsconfig.json
pnpm --dir apps/backend exec jest --runInBand
pnpm --dir apps/backend build
pnpm auditoria
```

Para uma alteracao operacional pelo painel/admin, crie uma nova versao em vez
de editar registros existentes. Lembre que o auto-sync pode reativar a versao
do codigo em um reinicio.

## Cuidados

- Nao registre prompt completo, imagens ou resposta crua da IA em producao.
- `AI_DEBUG_DUMP_RAW` deve permanecer desligado em producao.
- Nao altere ao mesmo tempo prompt, modelo e percentual de experimento; isso impede atribuir o efeito observado.
- Nao use numeros de versao fixos em runbooks: as versoes crescem a cada mudanca real.
- Nao presuma tempos de resposta fixos; eles dependem do modelo, da carga e dos provedores.
