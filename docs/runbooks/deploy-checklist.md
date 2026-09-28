# Checklist de ambiente de producao

A lista canonica de nomes e comentarios fica em
[`apps/backend/.env.example`](../../apps/backend/.env.example). Valores reais
vivem somente nos paineis dos provedores.

## Backend no Render

### Bootstrap obrigatorio

| Variavel | Regra |
| --- | --- |
| `APP_ENV` | Deve existir; use `production` em producao. |
| `DATABASE_URL` | Obrigatoria, com `DIRECT_URL` ou `DIRECT_DATABASE_URL` como fallbacks aceitos. |
| `FRONTEND_URL` ou `CORS_ORIGINS` | Ao menos uma origem confiavel e obrigatoria em producao. |
| `CLERK_SECRET_KEY` ou `CLERK_JWT_KEY` | Ao menos uma credencial de validacao e obrigatoria em producao. |
| `ALLOW_LEGACY_AUTH_FALLBACK` | Nunca deve ser `true` em producao. |

### Servicos da plataforma

| Grupo | Variaveis principais | Necessidade |
| --- | --- | --- |
| Fila e worker | `REDIS_URL` | Necessaria para processar a fila BullMQ no worker embutido. |
| IA | `OPENAI_API_KEY`, `AI_MODEL_*` | Necessaria para analises reais; modelos possuem fallbacks documentados. |
| Imagens | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` | Necessaria para storage remoto em producao. |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` | Necessaria para checkout, portal e webhooks. |
| Operacoes | `INTERNAL_OPS_TOKEN` | Protege `/api/health` e `/api/health/ready`; sem token, o acesso e negado. |
| Email | `RESEND_API_KEY`, `MAIL_FROM` | Necessaria para envio de email; o restante da aplicacao deve degradar sem derrubar o boot. |

Gere um token operacional fora do repositorio:

```bash
openssl rand -hex 32
```

Configure o resultado diretamente no Render. Nao o inclua em comandos
versionados, tickets ou documentacao.

## Frontend na Vercel

| Variavel | Necessidade |
| --- | --- |
| `VITE_API_URL` | URL publica do backend Render. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Chave publica da aplicacao Clerk. |
| `VITE_TURNSTILE_SITE_KEY` | Necessaria quando o backend exige Turnstile na demo. |
| `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` | Opcionais para analytics. |
| `VITE_SENTRY_DSN`, `VITE_APP_ENV` | Opcionais para observabilidade e identificacao do ambiente. |
| `VITE_GA_TRACKING_ID`, `VITE_GOOGLE_ADS_ID`, `VITE_META_PIXEL_ID` | Opcionais para atribuicao e campanhas. |

Toda variavel `VITE_*` e publica no bundle. Nunca use esse prefixo para um
segredo.

## Antes do deploy

1. Confira os nomes contra os dois arquivos `.env.example`.
2. Rode os portoes locais descritos em [`DEPLOY.md`](../../DEPLOY.md).
3. Verifique se uma nova migracao possui estrategia explicita de aplicacao.
4. Nao altere flags, modelos e prompt simultaneamente sem um plano de medicao.
5. Depois do deploy, valide health, login, saldo, uma analise e a conclusao pelo worker.

## Protecoes que falham fechadas

- Banco: API e worker usam `sslmode=verify-full` por padrao e atualizam o
  legado `sslmode=require` para esse modo. Em producao, outros modos sao
  rejeitados. Confira certificado, hostname e CA do banco antes de publicar;
  uma CA privada deve ser fornecida via `sslrootcert`, sem desativar TLS.
  No Render, monte o certificado oficial Supabase como Secret File
  `supabase-ca.crt` e inclua `sslrootcert=/etc/secrets/supabase-ca.crt` na
  `DATABASE_URL`, preservando host, usuario, senha e demais parametros.
  Obtenha a CA no painel do proprio projeto Supabase; valide uma consulta
  com `verify-full` antes de publicar API e worker.
- Demo: configure `TURNSTILE_SECRET_KEY` no backend e a sitekey correspondente
  no frontend. Sem chave ou com o verificador indisponivel, `/api/demo/analyze`
  retorna 503 antes da IA. Token ausente/rejeitado retorna 403. Configure
  `DEMO_HASH_SALT` ou mantenha `CLERK_SECRET_KEY` para o hash das cotas.
- IP: rate limit e cota da demo usam `req.ip`. O `trust proxy=1` pressupoe um
  unico ingresso confiavel (Render) antes da API, que acrescente/sobrescreva o
  IP real no `X-Forwarded-For`. O processo Node nao deve ficar acessivel por um
  caminho mais curto. Reavalie essa configuracao ao mudar a cadeia de proxies;
  `CF-Connecting-IP` enviado pelo cliente nunca substitui o IP resolvido.
