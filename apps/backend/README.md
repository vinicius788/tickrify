# Tickrify Backend (NestJS + Prisma + BullMQ)

Backend da plataforma Tickrify para autenticação, análises de IA, billing e observabilidade.

## Stack

- NestJS 10
- Prisma + PostgreSQL
- BullMQ + Redis (processamento assíncrono)
- Clerk (auth JWT)
- Stripe (checkout, portal, webhooks)
- OpenAI (análise de imagem)
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

## Legado Isolado

Código legado de pagamentos foi mantido apenas para histórico em:

- `src/modules/payments/_legacy/`

Status:

- não exposto no `PaymentsModule`
- não faz parte do contrato público atual

## Setup Local

```bash
npm install
cp .env.example .env
npm run migrate
npm run dev
```

Em outro terminal (worker):

```bash
npm run worker
```

## Scripts

- `npm run dev`
- `npm run build`
- `npm run test`
- `npm run test:e2e`
- `npm run lint`
- `npm run migrate`
- `npm run migrate:deploy`
- `npm run worker`

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
