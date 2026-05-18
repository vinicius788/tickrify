# 🗄️ Configurar DATABASE_URL para Deploy

## Erro que esse guia resolve:
```
PrismaClientInitializationError: Can't reach database server
Error Code: P1001
```

---

## 📝 Passo a Passo

### 1. Obter Connection String do Supabase

1. Acesse https://supabase.com/dashboard
2. Selecione seu projeto
3. Clique em **Settings** → **Database**
4. Role até **Connection String**
5. Selecione a aba **"URI"** com **"Connection Pooling"** habilitado
6. Copie a URL (deve ter porta `6543` e `pgbouncer=true`)

**Formato correto:**
```
postgresql://postgres.PROJECT_ID:[PASSWORD]@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true
```

⚠️ **IMPORTANTE:** 
- Use porta **6543** (pooling), NÃO **5432** (direct)
- Adicione `&connection_limit=1` no final da URL

**URL final:**
```
postgresql://postgres.PROJECT_ID:[PASSWORD]@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

---

### 2. Configurar no Railway

#### Opção A: Via Dashboard (Recomendado)

1. Acesse https://railway.app
2. Entre no seu projeto
3. Clique no serviço do **backend**
4. Vá em **Variables**
5. Clique em **+ New Variable**
6. Nome: `DATABASE_URL`
7. Valor: Cole a URL do Supabase (com sua senha)
8. Clique em **Add**
9. Railway vai fazer redeploy automaticamente

#### Opção B: Via Railway CLI

```bash
# Instalar Railway CLI (se não tiver)
npm install -g @railway/cli

# Login
railway login

# Link ao projeto
railway link

# Configurar variável
railway variables set DATABASE_URL="postgresql://postgres.PROJECT_ID:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# Fazer redeploy
railway up
```

---

### 3. Verificar Schema Existe no Supabase

O projeto usa schema customizado `tickrify`. Verifique se existe:

1. No Dashboard do Supabase, vá em **SQL Editor**
2. Execute:

```sql
-- Criar schema se não existir
CREATE SCHEMA IF NOT EXISTS tickrify;

-- Verificar schemas existentes
SELECT schema_name FROM information_schema.schemata;
```

---

### 4. Rodar Migrations

Depois de configurar o DATABASE_URL:

```bash
# Via Railway CLI (recomendado)
railway run npx prisma migrate deploy

# OU conectar diretamente
export DATABASE_URL="sua_url_aqui"
cd apps/backend
npx prisma migrate deploy
```

---

## 🔍 Troubleshooting

### Erro persiste após configurar?

**Verifique:**

1. **Senha está correta?**
   - Vá em Supabase → Settings → Database
   - Em "Reset Database Password" você pode resetar

2. **URL está completa?**
   - Deve incluir senha
   - Deve ter `pgbouncer=true`
   - Deve ter `connection_limit=1`

3. **Schema existe?**
   ```sql
   CREATE SCHEMA IF NOT EXISTS tickrify;
   ```

4. **Firewall do Supabase?**
   - Supabase Settings → Database → Connection Pooling
   - Certifique-se que está habilitado

---

## 📊 Logs para Debug

Ver logs no Railway:
```bash
# Via CLI
railway logs

# OU no dashboard:
# Railway → Seu Projeto → Backend → Deployments → Ver logs
```

Procure por:
```
✅ BOM:  Prisma schema loaded
✅ BOM:  Generated Prisma Client
✅ BOM:  Starting Nest application...
✅ BOM:  Successfully started

❌ RUIM: Can't reach database server
❌ RUIM: P1001
❌ RUIM: Connection timeout
```

---

## ✅ Checklist Final

- [ ] Obtive Connection String com **Connection Pooling** do Supabase
- [ ] URL usa porta **6543** (não 5432)
- [ ] URL contém `pgbouncer=true&connection_limit=1`
- [ ] Configurei `DATABASE_URL` no Railway
- [ ] Schema `tickrify` existe no Supabase
- [ ] Rodei `prisma migrate deploy`
- [ ] Verifiquei logs do Railway

---

## 🎯 Resultado Esperado

Após configurar corretamente:

```
✅ Prisma Client gerado
✅ Conectado ao banco de dados
✅ Migrations aplicadas
✅ Backend iniciado com sucesso
🚀 API respondendo normalmente
```

