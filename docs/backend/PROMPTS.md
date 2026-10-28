# Sistema de prompts de IA

Este guia descreve o comportamento implementado atualmente. Ele nao define
promessas de qualidade, tempo de resposta ou uma arquitetura de agentes.

## Fontes de verdade

- Prompt unico, no codigo: `apps/backend/src/common/prompts/trading-system-prompt.ts` (v10.3)
- Composicao final: `apps/backend/src/modules/prompt/prompt-builder.service.ts`
- Registro de versoes no boot: `apps/backend/src/modules/prompt/prompt-sync.service.ts`
- Leitura das versoes (admin): `apps/backend/src/modules/prompt/prompt.controller.ts`
- Caminho assincrono: `apps/backend/worker/ai.worker.ts`

Nao trate textos antigos em handoffs, sprints ou relatorios como prompts ativos.
Nao existe mais prompt alternativo, A/B, override nem versao escolhida pelo
banco (removidos em 28/10/2026).

## Como o prompt e montado

`buildAnalysisPrompt({ userLanguage, analysisType })` parte SEMPRE do
`TRADING_SYSTEM_PROMPT` do codigo, troca `{{USER_CONTEXT}}` pela instrucao de
idioma e, em analises `deep`, acrescenta a leitura em camadas
(`DEEP_ANALYSIS_INSTRUCTION`, com os estados do v10.3). O worker, o caminho
sincrono, a demo do `/try` e os scripts de medicao usam a mesma funcao.

Os niveis de entrada, stop e alvo nao saem do texto do modelo: o codigo os
calcula (`common/utils/plan-engine.ts`) a partir das velas reais do armazem
(`modules/market/candle-store.ts`) ou, sem velas, dos niveis estimados do
print (`dataMode: 'print'`, a tela avisa).

## Versoes

No boot, `PromptSyncService` compara o prompt do codigo com a versao ativa em
`PromptConfig`:

- se forem iguais, nao grava nada;
- se forem diferentes, desativa a versao ativa, cria uma nova e a ativa;
- se falhar, registra o erro e a aplicacao sobe normalmente.

O banco so numera as versoes: cada analise grava a ativa em `promptVer`, o
corte de medicao antes/depois de uma troca de prompt. O historico nao e apagado.

## Administracao

Rotas so de leitura, todas com `AuthGuard` e `AdminGuard`:

| Metodo | Rota | Funcao |
| --- | --- | --- |
| `GET` | `/api/prompts/latest` | Retorna a versao ativa mais recente. |
| `GET` | `/api/prompts/list` | Lista o historico de versoes. |
| `GET` | `/api/prompts/:version` | Busca uma versao numerica. |

O teste de acesso em
`apps/backend/src/common/guards/__tests__/route-access.spec.ts` protege esse
contrato contra exposicao acidental.

## Alteracao segura

1. Edite somente a fonte canonica e os testes relacionados.
2. Preserve o contrato JSON consumido pelo normalizador e pela interface.
3. Meca antes com `apps/backend/scripts/prompt-replay.ts` (prints reais, mesma regua do rastreador).
4. Execute os testes e o build antes do deploy.
5. Depois do deploy, confirme nos logs se a versao foi registrada ou ja estava em dia.

Comandos minimos:

```bash
pnpm --dir apps/backend exec tsc --noEmit -p tsconfig.json
pnpm --dir apps/backend exec jest --runInBand
pnpm --dir apps/backend build
pnpm auditoria
```

## Cuidados

- Nao registre prompt completo, imagens ou resposta crua da IA em producao.
- `AI_DEBUG_DUMP_RAW` deve permanecer desligado em producao.
- Nao altere ao mesmo tempo prompt e modelo; isso impede atribuir o efeito observado.
- Nao use numeros de versao fixos em runbooks: as versoes crescem a cada mudanca real.
- Nao presuma tempos de resposta fixos; eles dependem do modelo, da carga e dos provedores.
