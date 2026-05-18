# 🚀 Como Rodar o Projeto TICKRIFY

## ⚠️ IMPORTANTE: Configuração Necessária

Antes de rodar o projeto completo, você precisa configurar as variáveis de ambiente.

---

## 📝 Opção 1: Rodar Apenas o Frontend (Demo)

Se você só quer ver a interface:

```bash
cd /Users/vini.mqs/Documents/tickrify_novo/apps/frontend
npm run dev
```

Acesse: **http://localhost:5173**

**Nota:** O backend não estará funcionando, então:
- ✅ Você verá a landing page
- ✅ Você verá o dashboard (design)
- ❌ Login não funcionará (precisa Clerk)
- ❌ Análise de IA não funcionará (precisa backend)

---

## 🔧 Opção 2: Rodar Frontend + Backend Completo

### Passo 1: Criar arquivo .env

```bash
cd /Users/vini.mqs/Documents/tickrify_novo/apps/backend
cp .env.example .env
```

### Passo 2: Editar o .env

Abra o arquivo `.env` e adicione suas credenciais:

```env
# Mínimo necessário para testar:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ticrif
REDIS_HOST=localhost
REDIS_PORT=6379
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:5173

# Opcional (para funcionalidades completas):
CLERK_SECRET_KEY=sua_chave_clerk
STRIPE_SECRET_KEY=sua_chave_stripe
AWS_ACCESS_KEY_ID=sua_aws_key
OPENAI_API_KEY=sua_openai_key
```

### Passo 3: Configurar PostgreSQL

```bash
# Instalar PostgreSQL (se não tiver)
brew install postgresql@15
brew services start postgresql@15

# Criar database
psql postgres
CREATE DATABASE ticrif;
\q
```

### Passo 4: Rodar migrations

```bash
cd /Users/vini.mqs/Documents/tickrify_novo
npm run migrate
```

### Passo 5: Seed do banco (Prompts de IA)

```bash
cd /Users/vini.mqs/Documents/tickrify_novo/apps/backend
npm run seed
```

### Passo 6: Instalar e iniciar Redis

```bash
# Instalar Redis
brew install redis
brew services start redis

# Testar
redis-cli ping  # Deve retornar: PONG
```

### Passo 7: Iniciar o projeto

**Terminal 1 - Frontend + Backend:**
```bash
cd /Users/vini.mqs/Documents/tickrify_novo
npm run dev
```

**Terminal 2 - Worker de IA:**
```bash
cd /Users/vini.mqs/Documents/tickrify_novo
npm run worker
```

### Passo 8: Acessar

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001
- **Prisma Studio:** `npm run studio`

---

## 🎯 Testando por Partes

### 1. Testar só Frontend (sem backend)

```bash
cd apps/frontend
npm run dev
```

Acesse: http://localhost:5173

### 2. Testar só Backend (sem worker)

Crie o `.env` primeiro, depois:

```bash
cd apps/backend
npm run dev
```

Teste: http://localhost:3001/api/prompts/latest

### 3. Testar tudo junto

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run worker
```

---

## 🚦 Status dos Serviços

Para o projeto funcionar **completamente**, você precisa:

| Serviço | Obrigatório? | Como iniciar |
|---------|--------------|--------------|
| **Frontend** | ✅ Sim | `npm run dev` |
| **Backend** | ✅ Sim | `npm run dev` |
| **PostgreSQL** | ✅ Sim | `brew services start postgresql@15` |
| **Redis** | ⚠️ Para Worker | `brew services start redis` |
| **Worker** | ⚠️ Para IA | `npm run worker` |

---

## 🎨 Apenas Visualizar o Design

Se você só quer ver o design da interface **sem configurar nada**:

```bash
cd /Users/vini.mqs/Documents/tickrify_novo/apps/frontend
npm run dev
```

Acesse: http://localhost:5173

Você verá:
- ✅ Landing page completa
- ✅ Dashboard (visual)
- ✅ Componentes da interface
- ❌ Funcionalidades não funcionarão (precisa backend)

---

## 📋 Checklist Rápido

Antes de rodar o projeto completo, verifique:

- [ ] PostgreSQL instalado e rodando?
- [ ] Redis instalado e rodando?
- [ ] Arquivo `.env` criado em `apps/backend/`?
- [ ] Migrations executadas? (`npm run migrate`)
- [ ] Seed executado? (`npm run seed`)

---

## 🐛 Troubleshooting

### Erro: "Cannot connect to database"

```bash
# Verificar se PostgreSQL está rodando
brew services list | grep postgresql

# Iniciar se não estiver
brew services start postgresql@15
```

### Erro: "Redis connection refused"

```bash
# Verificar se Redis está rodando
redis-cli ping

# Iniciar se não estiver
brew services start redis
```

### Erro: "Port 3001 already in use"

```bash
# Matar processo na porta 3001
lsof -ti:3001 | xargs kill -9
```

### Erro: "Port 5173 already in use"

```bash
# Matar processo na porta 5173
lsof -ti:5173 | xargs kill -9
```

---

## 🎉 Sucesso!

Se tudo estiver funcionando, você verá:

**Terminal 1:**
```
[Frontend] VITE v6.x.x ready in XXX ms
[Frontend] ➜  Local:   http://localhost:5173/
[Backend]  🚀 Backend running on http://localhost:3001
```

**Terminal 2:**
```
🚀 AI Worker started and listening for jobs...
```

---

## 📚 Documentação Adicional

- `README.md` - Overview do projeto
- `INSTALL.md` - Guia de instalação completo
- `INSTALACAO_COMPLETA.md` - Status da instalação
- `apps/backend/README.md` - Documentação do backend
- `docs/backend/PROMPTS.md` - Sistema de IA
- `docs/backend/API_EXAMPLES.md` - Exemplos de API

---

## 🚀 Modo Desenvolvimento vs Produção

### Desenvolvimento (Local)

```bash
npm run dev           # Frontend + Backend
npm run worker        # Worker de IA
```

### Produção (Deploy)

```bash
npm run build         # Build completo
npm run start         # Start produção
```

---

**Pronto! Escolha a opção que melhor se adequa ao que você quer testar! 🎯**

