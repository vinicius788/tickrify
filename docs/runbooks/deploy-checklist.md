## Variáveis de Ambiente Obrigatórias (Backend)

| Variável | Obrigatório | Descrição |
|---|---|---|
| `APP_ENV` | ✅ Sim | Deve ser `production` em produção. Ausente = falha no bootstrap. |
| `DATABASE_URL` | ✅ Sim | Connection string do Postgres (ou `DIRECT_URL` como fallback). |
| `CORS_ORIGINS` | ✅ Sim em prod | Origens permitidas pelo CORS em produção (alternativamente `FRONTEND_URL`). |
| `CLERK_SECRET_KEY` | ✅ Sim em prod | Chave secreta do Clerk para validação de JWT (ou `CLERK_JWT_KEY`). |
| `INTERNAL_OPS_TOKEN` | ⚠️ Recomendado | Token para acessar health endpoints internos. Sem ele, `/health` e `/health/ready` retornam 403. Gere com `openssl rand -hex 32`. |
| `ALLOW_LEGACY_AUTH_FALLBACK` | ❌ Nunca em prod | Se `true` em produção, o bootstrap falha por design (SEC-001). |

## Como gerar INTERNAL_OPS_TOKEN
```bash
openssl rand -hex 32
```
Configure no painel do Render/Railway/Vercel como variável de ambiente segura.

## Frontend — Variáveis de Ambiente (Vercel)

O arquivo `apps/frontend/.env.production` NÃO é versionado no repositório (está no .gitignore).
As variáveis vivem no painel do Vercel em Settings → Environment Variables:

| Variável | Ambiente | Descrição |
|---|---|---|
| `VITE_API_URL` | Production, Preview | URL do backend Render |
| `VITE_CLERK_PUBLISHABLE_KEY` | Production, Preview | Chave pública do Clerk |

Para adicionar via CLI:
```bash
echo "https://tickrify.onrender.com" | vercel env add VITE_API_URL production
echo "pk_live_..." | vercel env add VITE_CLERK_PUBLISHABLE_KEY production
```
