# Deploy e Release Gate

Este documento descreve a configuração conferida diretamente nos painéis da Vercel e do Render em 16/09/2026. Não contém segredos nem substitui a conferência das variáveis nos provedores.

## Topologia de produção

| Componente | Provedor | Configuração ativa |
|---|---|---|
| Frontend | Vercel, projeto `tickrify-frontend` | Root Directory `apps/frontend`, framework Vite, domínio `tickrify.com` |
| Backend | Render, serviço web `tickrify` | Branch `main`, contexto `.`, Dockerfile `./Dockerfile`, URL `https://tickrify.onrender.com` |
| Worker | Render | Embutido no mesmo contêiner do backend por `infra/docker-entrypoint.sh` |
| Redis | Render, `tickrify-redis` | Recurso separado usado pelo BullMQ |
| Banco | Supabase Postgres | Acesso por variáveis do backend |

Não existe serviço `tickrify-worker` separado. Também não existe Blueprint Render ativo: o serviço `tickrify` foi configurado manualmente.

## Build ativo

O Render executa o `Dockerfile` da raiz. Esse arquivo instala o monorepo com PNPM, gera o Prisma Client, compila o backend e usa `infra/docker-entrypoint.sh` como entrypoint.

A Vercel usa [`apps/frontend/vercel.json`](./apps/frontend/vercel.json):

- build: `npm run build`
- saída: `dist`
- instalação: `npm install --ignore-scripts`

Esses comandos da Vercel são deliberadamente locais ao diretório `apps/frontend`; o fluxo do monorepo, do Docker e do CI usa PNPM.

## Variáveis

Os nomes esperados ficam em:

- [`apps/backend/.env.example`](./apps/backend/.env.example)
- [`apps/frontend/.env.example`](./apps/frontend/.env.example)
- [`docs/backend/ENV_VARIABLES.md`](./docs/backend/ENV_VARIABLES.md)

Nunca copie valores reais para o repositório. Para migrações, `MIGRATIONS_DATABASE_URL` deve usar uma conexão compatível com o ambiente do Render. O entrypoint roda `migrate:deploy` somente quando `RUN_MIGRATIONS_ON_START=true` e inicia o worker quando `RUN_EMBEDDED_WORKER` não é `false`.

## Gate antes do push

Na raiz do repositório:

```bash
pnpm install --frozen-lockfile
pnpm --dir apps/backend exec eslint "{src,apps,libs,test,worker}/**/*.ts"
pnpm --dir apps/frontend lint
pnpm --dir apps/backend exec tsc --noEmit -p tsconfig.json
pnpm --dir apps/frontend typecheck
pnpm --dir apps/backend exec jest --runInBand
pnpm --dir apps/frontend test
pnpm --dir apps/backend build
pnpm --dir apps/frontend build
pnpm auditoria
pnpm audit
```

O workflow [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) repete esses portões no GitHub Actions com o `pnpm-lock.yaml` congelado.

## Publicação

1. Confirme que a árvore contém apenas as mudanças pretendidas com `git status` e `git diff --check`.
2. Faça commits pequenos e reversíveis.
3. Envie a branch somente depois de todos os portões passarem.
4. Acompanhe o deploy do frontend no projeto Vercel `tickrify-frontend`.
5. Acompanhe o deploy do backend no serviço Render `tickrify`.
6. Não edite variáveis ou comandos dos provedores durante uma publicação comum.

## Verificação pós-deploy

O check público mínimo é:

```bash
curl -i https://tickrify.onrender.com/api/health/live
bash scripts/check-deploy.sh https://tickrify.onrender.com https://tickrify.com
```

Para validar `/api/health` e `/api/health/ready`, forneça `OPS_TOKEN` apenas no ambiente local do comando. Não registre o token no shell history, em arquivos ou em logs compartilhados.

Depois, confirme no produto:

1. página pública e login;
2. saldo de Ticks;
3. envio de uma análise rápida;
4. conclusão do job pelo worker embutido;
5. checkout e webhook somente quando a mudança tocar pagamentos.

## Migrações

Valide o banco antes de aplicar qualquer migração:

```bash
pnpm --dir apps/backend migrate:check-db
pnpm --dir apps/backend migrate:status
pnpm --dir apps/backend migrate:deploy
```

Não execute `migrate:reset` em produção. Não altere `RUN_MIGRATIONS_ON_START` sem entender se o deploy atual depende da execução automática no entrypoint.

## Rollback

- Código: reverta o commit específico e publique novamente.
- Frontend: use o histórico de deployments da Vercel para restaurar a última versão boa.
- Backend: use o histórico de deploys do serviço `tickrify` no Render.
- Banco: migrações destrutivas exigem plano próprio; não tente desfazê-las automaticamente com Git.

Nenhum script do repositório configura provedores ou envia segredos automaticamente. Alterações de infraestrutura são feitas conscientemente nos painéis e documentadas aqui depois da verificação.
