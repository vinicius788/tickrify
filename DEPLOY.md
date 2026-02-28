# Deploy and Release Gate

## Environments

- Frontend staging URL: `https://app-staging.tickrify.com` (substitua pela URL real no Vercel)
- Backend staging URL: `https://tickrify-backend-api.onrender.com` (exemplo; valide no painel Render)
- Worker staging: Render worker service linked to the same backend env group

## Required Env Vars

Backend (`apps/backend/.env.example`):
- `DATABASE_URL`
- `MIGRATIONS_DATABASE_URL` (recommended for migrate status/deploy)
- `REDIS_URL`
- `CLERK_SECRET_KEY` or `CLERK_JWT_KEY`
- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_URL`, `FRONTEND_URL`, `CORS_ORIGINS`

Frontend (`apps/frontend/.env.example`):
- `VITE_API_URL` (must point to backend staging/prod URL)
- `VITE_CLERK_PUBLISHABLE_KEY`

Set `VITE_API_URL` on Vercel Preview/Production:

```bash
vercel env add VITE_API_URL preview
vercel env add VITE_API_URL production
```

## Supabase (ou Postgres) — `MIGRATIONS_DATABASE_URL` (PASSO MANUAL)

Para `migrate status`/`migrate deploy`, use URL de conexão direta do banco (não pooler transacional):

1. Abrir painel do banco.
2. Ir em `Connect` (ou `Connection details`).
3. Copiar a connection string `Direct`/`Session`.
4. Configurar no ambiente:

```bash
export MIGRATIONS_DATABASE_URL='postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?sslmode=require'
```

5. Rodar checker e migrate:

```bash
npm run -w apps/backend migrate:check-db
npm run -w apps/backend migrate:status
npm run -w apps/backend migrate:deploy
```

Notas:
- Supabase costuma oferecer pelo menos duas strings: `pooler` e `direct`. Para migrations, prefira `direct`.
- O checker bloqueia host inválido/NXDOMAIN e informa qual variável está sendo usada (`MIGRATIONS_DATABASE_URL` ou `DATABASE_URL`).

## Release Control

Only promote to production when all of these are true:
- CI is green (`lint`, `test`, `build`)
- Staging smoke is green
- Migration status/deploy succeeded on staging DB

RC tag flow:

```bash
git tag vX.Y.Z-rc1
git push origin vX.Y.Z-rc1
```

## CI

CI workflow: `.github/workflows/ci.yml`
- Install (cached)
- Lint backend/frontend
- Test backend (`--runInBand`)
- Build backend/frontend

## Prisma v7 Migration Commands

Local/staging checks:

```bash
# From repo root
npm run -w apps/backend prisma:validate
npm run -w apps/backend migrate:check-db
npm run -w apps/backend migrate:status
```

Deploy migrations:

```bash
npm run -w apps/backend migrate:deploy
```

If staging uses a different DB URL for migrations:

```bash
export MIGRATIONS_DATABASE_URL="postgresql://..."
npm run -w apps/backend migrate:check-db
npm run -w apps/backend migrate:status
npm run -w apps/backend migrate:deploy
```

## Staging Smoke

`scripts/smoke.sh` detecta automaticamente health em:
- `<BASE>/api/health/live` + `<BASE>/api/health/ready`
- `<BASE>/health/live` + `<BASE>/health/ready`

Se ambos falharem, o script aborta com recomendação para conferir URL do serviço WEB/API no Render.

```bash
# Minimal (backend health)
bash scripts/smoke.sh https://api-staging.tickrify.com

# Backend + frontend accessibility
bash scripts/smoke.sh https://api-staging.tickrify.com https://app-staging.tickrify.com

# Optional authenticated check
SMOKE_AUTH_TOKEN="BearerTokenHere" \
bash scripts/smoke.sh https://api-staging.tickrify.com https://app-staging.tickrify.com
```

## Render — descobrir URL correta do serviço API (PASSO MANUAL)

1. Abrir Render Dashboard.
2. Selecionar o serviço **Web/API** (não worker), por exemplo `tickrify-backend-api`.
3. Copiar a `Public URL` do serviço.
4. Validar com `curl`:

```bash
curl -i https://<RENDER_API_URL>/api/health/live
curl -i https://<RENDER_API_URL>/health/live
```

Use a URL que responder `200` no `scripts/smoke.sh`.

## Vercel Preview 401 (Deployment Protection) (PASSO MANUAL)

Observed symptom:
- Preview URL returns `401` with Vercel SSO/deployment protection enabled.

Two safe options:

1) Disable protection for staging/preview (fastest QA path)
- In Vercel project settings, disable deployment protection for the staging/preview environment.
- Keep protection enabled for production if needed.

2) Keep protection enabled and provide QA access
- Add QA users to Vercel access policy, or
- Use a protected bypass token for automation and pass it as `VERCEL_PROTECTION_BYPASS` to `scripts/smoke.sh`.
- Never commit bypass tokens; store them only in CI/provider secrets.

## GitHub Actions CI — validação remota (PASSO MANUAL)

1. Verificar alterações locais:

```bash
git status
```

2. Commit e push:

```bash
git add .
git commit -m "ci: add release gates and deployment checks"
git push origin <sua-branch>
```

3. Abrir `GitHub > Actions > CI` e confirmar run verde para `pull_request` ou `push`.
4. (Opcional) Habilitar branch protection exigindo checks `Lint`, `Test Backend`, `Build`.
