# Tickrify Backend (NestJS + Prisma + BullMQ)

Backend da plataforma Tickrify para autenticação, análises de IA, billing e observabilidade.

## Stack

- NestJS 10
- Prisma + PostgreSQL
- BullMQ + Redis (processamento assíncrono)
- Clerk (auth JWT)
- Stripe (checkout, portal, webhooks)
- Provedor de IA (análise de imagem; camada única em `src/modules/ai/vision-model.ts`)
- Supabase Storage (persistência de imagens)

## Endpoints Canônicos

### Health

- `GET /api/health/live` (público)
- `GET /api/health/ready` (protegido por `x-ops-token`)
- `GET /api/health` (protegido por `x-ops-token`)

### Auth

- `GET /api/auth/me`

### AI

- `POST /api/ai/analyze`
- `GET /api/ai/analysis/:id`
- `GET /api/ai/analyses?limit=20`
- `GET /api/ai/usage`

### Prompts (admin)

- `POST /api/prompts/config`
- `GET /api/prompts/latest`
- `GET /api/prompts/list`
- `GET /api/prompts/:version`
- `POST /api/prompts/:version/activate`

### Pagamentos (Stripe)

- `POST /api/stripe/create-checkout-session`
- `POST /api/stripe/create-customer-portal`
- `POST /api/stripe/cancel-subscription`
- `POST /api/stripe/reactivate-subscription`
- `GET /api/stripe/subscription`
- `POST /api/stripe/webhook`

## Setup Local

```bash
pnpm install
cp .env.example .env
pnpm --dir apps/backend migrate
pnpm --dir apps/backend dev
```

Em outro terminal (worker):

```bash
pnpm --dir apps/backend worker
```

## Scripts

- `pnpm --dir apps/backend dev`
- `pnpm --dir apps/backend build`
- `pnpm --dir apps/backend test`
- `pnpm --dir apps/backend test:e2e`
- `pnpm --dir apps/backend lint`
- `pnpm --dir apps/backend migrate`
- `pnpm --dir apps/backend migrate:deploy`
- `pnpm --dir apps/backend worker`

## Variáveis Críticas

- `DATABASE_URL`
- `MIGRATIONS_DATABASE_URL` (ou `DIRECT_URL`)
- `REDIS_URL`
- `CLERK_SECRET_KEY` e/ou `CLERK_JWT_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`)
- `OPENAI_API_KEY`
- `INTERNAL_OPS_TOKEN`

## Notas Importantes

- O contrato de API oficial de análise é `/api/ai/*`.
- A rota legada `/api/analyze-chart` foi removida do módulo ativo.
- Upload de imagem usa Supabase Storage (não AWS S3).
- Em produção, API e worker rodam no mesmo contêiner pelo `infra/docker-entrypoint.sh`.
