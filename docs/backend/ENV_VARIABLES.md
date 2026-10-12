# Variaveis de ambiente do backend

Este documento explica como administrar a configuracao. A lista canonica e
atualizada de variaveis, com nomes e exemplos seguros, fica em
[`apps/backend/.env.example`](../../apps/backend/.env.example).

Nao copie valores reais para a documentacao, para o Git ou para comandos que
possam ficar no historico do shell.

## Ambiente local

Na raiz do repositorio:

```bash
cp apps/backend/.env.example apps/backend/.env
pnpm install
pnpm dev
```

Preencha apenas o arquivo `.env`, que e ignorado pelo Git. O frontend possui
um exemplo separado em `apps/frontend/.env.example`.

## Grupos de configuracao

| Grupo | Exemplos | Observacao |
| --- | --- | --- |
| Runtime | `NODE_ENV`, `APP_ENV`, `PORT`, `DEMO_MODE` | `APP_ENV=production` ativa validacoes adicionais de seguranca. |
| Banco | `DATABASE_URL`, `MIGRATIONS_DATABASE_URL`, `DIRECT_URL`, `DIRECT_DATABASE_URL` | A URL de migracao e recomendada; o codigo usa os fallbacks documentados no arquivo de exemplo. |
| Fila | `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT` | Redis e obrigatorio em producao para a fila BullMQ e o worker embutido. |
| Autenticacao | `CLERK_*`, `BOOTSTRAP_ADMIN_EMAILS` | Chaves secretas ficam somente no ambiente do backend. |
| Storage | `SUPABASE_*`, `USE_LOCAL_STORAGE`, `MAX_IMAGE_UPLOAD_BYTES` | Producao usa Supabase Storage; armazenamento local e apenas auxiliar de desenvolvimento. |
| IA | `OPENAI_API_KEY`, `AI_MODEL_*`, `AI_REASONING_EFFORT_*` | Modelos quick e deep podem ser configurados separadamente. |
| Cobranca | `STRIPE_*` | Necessario quando a integracao Stripe esta ativa. |
| URLs e CORS | `APP_URL`, `FRONTEND_URL`, `CORS_ORIGINS` | Devem conter apenas origens confiaveis em producao. |
| Operacoes | `INTERNAL_OPS_TOKEN` | Protege os endpoints internos de health e readiness. |
| Flags | `ENABLE_*`, `AB_PROMPT_V9_PERCENT`, `PROMPT_AUTO_SYNC` | Overrides salvos no painel admin prevalecem sobre os valores de ambiente. |
| Demo e dados | `DEMO_*`, `TURNSTILE_SECRET_KEY`, `TWELVE_DATA_API_KEY`, `FRED_API_KEY` | Demo retorna 503 sem chave Turnstile, sem verificador disponivel ou sem segredo para hash. Dados de mercado opcionais degradam conforme documentado no codigo. |
| Email e telemetria | `RESEND_API_KEY`, `MAIL_FROM`, `FOUNDER_CHAT_NOTIFY_TO` (aviso do chat, padrao support@), `POSTHOG_*` | Nao habilite telemetria em testes sem intencao explicita. |
| Backtest | `BT_DEBUG_FIELDS` | Usado apenas por scripts locais. |

Os comentarios em `.env.example` sao parte da documentacao e registram os
fallbacks, limites e cuidados de cada variavel.

## Producao

O backend e o worker rodam juntos no servico `tickrify` do Render, construido
pelo `Dockerfile` da raiz. O frontend roda separadamente na Vercel. Portanto:

1. Variaveis do backend devem ser configuradas no servico do Render.
2. Variaveis `VITE_*` devem ser configuradas no projeto do frontend na Vercel.
3. Segredos nunca devem ser expostos como `VITE_*`, pois entram no bundle do navegador.
4. `REDIS_URL` deve apontar para o Valkey/Redis usado pelo worker de producao.
5. As URLs de banco usadas por migracoes devem ser testadas antes de um deploy.
6. `CORS_ORIGINS`, `FRONTEND_URL` e as configuracoes do Clerk devem aceitar o dominio real do frontend.

O procedimento completo de release esta em [`DEPLOY.md`](../../DEPLOY.md).

## Validacao

Execute na raiz antes de promover uma alteracao:

```bash
pnpm auditoria
pnpm --dir apps/backend exec tsc --noEmit -p tsconfig.json
pnpm --dir apps/backend exec jest --runInBand
pnpm --dir apps/backend build
```

`pnpm auditoria` verifica, entre outros contratos do repositorio, se as
variaveis acessadas pelo codigo estao representadas nos arquivos de exemplo.
Ele nao confirma que os valores secretos configurados nos provedores sao
validos.

Para diagnostico de producao, use os logs do Render e os endpoints operacionais
protegidos por `INTERNAL_OPS_TOKEN`. Nao publique tokens em tickets, prints ou
documentos.
