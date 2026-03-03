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
