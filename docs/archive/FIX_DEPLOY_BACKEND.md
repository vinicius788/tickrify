# 🔧 FIX DEPLOY BACKEND - Railway

## ❌ Problema Identificado

```
Error: Cannot find module '/app/apps/backend/dist/main'
```

O Railway estava procurando `dist/main.js` mas o NestJS compila para `dist/src/main.js`

## ✅ Correções Aplicadas

### 1. **package.json** - Corrigido caminho do start:prod

```json
"start:prod": "node dist/src/main"  // Era: "node dist/main"
```

### 2. **nixpacks.toml** - Adicionado migrate no build

```toml
[phases.build]
cmds = [
  "npm run build -w apps/backend", 
  "cd apps/backend && npx prisma generate",
  "cd apps/backend && npx prisma migrate deploy"  // ✅ NOVO
]
```

## 🚀 Como Fazer Novo Deploy

### Opção 1: Commit e Push (Deploy Automático)

```bash
cd /Users/vini.mqs/Documents/tickrify_novo

# Adicionar as correções
git add apps/backend/package.json nixpacks.toml

# Commit
git commit -m "fix: corrigir caminho do main.js no deploy do backend"

# Push (vai fazer deploy automático no Railway)
git push origin main
```

### Opção 2: Deploy Manual via Railway CLI

```bash
cd /Users/vini.mqs/Documents/tickrify_novo

# Login
railway login

# Link para o projeto
railway link

# Deploy
railway up
```

### Opção 3: Trigger Manual no Dashboard

1. Acesse: https://railway.app
2. Vá no seu projeto
3. Clique em "Deploy" > "Redeploy"

## 📋 Verificar Depois do Deploy

```bash
# Teste o endpoint
curl https://tickrify-worker-production.up.railway.app/api/prompts/latest

# Ou
curl https://tickrify-worker-production.up.railway.app/health
```

## 🔍 Logs no Railway

Para ver os logs:
```bash
railway logs
```

Ou acesse o dashboard: https://railway.app/project/seu-projeto/deployments

## ⚙️ Configuração recomendada no Railway (UI)

- Builder: Dockerfile
- Start Command: (deixe em branco para usar o CMD do Dockerfile) ou:
  ```
  npm run start:prod
  ```
- Deploy Command (sem usar `cd`):
  ```
  npx prisma migrate deploy --schema=/app/apps/backend/prisma/schema.prisma
  ```

Observação: Nunca use `cd ...` no Start/Deploy Command da UI. O Dockerfile já define `WORKDIR /app/apps/backend`.

