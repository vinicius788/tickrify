# TICRIF Backend - NestJS + Prisma + BullMQ + Clerk + Stripe

Backend completo para análise de gráficos de trading usando IA.

## 🚀 Features

- ✅ Autenticação com Clerk (JWT)
- ✅ Pagamentos com Stripe (Checkout + Webhooks)
- ✅ Upload de imagens para AWS S3
- ✅ **Análise de IA Multi-Agente com OpenAI GPT-4o Vision**
  - Sistema de 7 agentes especializados
  - Scoring de confluência adaptativo (0-100 pontos)
  - Suporte para naked charts (price action puro)
  - Detecção automática de indicadores
- ✅ Processamento assíncrono com BullMQ + Redis
- ✅ **Sistema de Versionamento de Prompts**
  - v1: Multi-Agent System (Production)
  - v2: Simplified (Development)
  - Ativação dinâmica via API
- ✅ Deploy na Vercel Serverless

## 📋 Pré-requisitos

- Node.js 20+
- PostgreSQL
- Redis
- Contas: Clerk, Stripe, AWS S3, OpenAI

## ⚙️ Setup Local

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env` com suas credenciais reais.

### 3. Rodar migrations

```bash
npm run migrate
```

### 4. Iniciar backend

```bash
npm run dev
```

Backend rodará em `http://localhost:3001`

### 5. Iniciar worker (em outro terminal)

```bash
npm run worker
```

## 📡 Endpoints da API

### Auth

- **GET** `/api/auth/me` - Retorna perfil do usuário autenticado

### Payments

- **POST** `/api/payments/create-checkout` - Cria sessão de checkout Stripe
```json
{
  "priceId": "price_xxxxx",
  "mode": "subscription"
}
```

- **POST** `/api/payments/webhooks/stripe` - Webhook do Stripe (use Stripe CLI local)

### AI Analysis

- **POST** `/api/ai/analyze` - Envia imagem para análise
  - FormData com campo `image` (arquivo)
  - OU JSON com `base64Image`
  - Opcional: `promptOverride`

- **GET** `/api/ai/analysis/:id` - Busca resultado da análise

- **GET** `/api/ai/analyses?limit=20` - Lista análises do usuário

### Prompts

- **POST** `/api/prompts/config` - Cria nova versão de prompt (admin)
```json
{
  "prompt": "Seu prompt aqui...",
  "setActive": true
}
```

- **GET** `/api/prompts/latest` - Retorna prompt ativo

- **GET** `/api/prompts/list` - Lista todos os prompts

- **POST** `/api/prompts/:version/activate` - Ativa versão específica

## 🧪 Testar localmente

### 1. Testar upload + análise

```bash
curl -X POST http://localhost:3001/api/ai/analyze \
  -H "Authorization: Bearer SEU_TOKEN_CLERK" \
  -F "image=@grafico.png"
```

### 2. Buscar resultado

```bash
curl http://localhost:3001/api/ai/analysis/ANALYSIS_ID \
  -H "Authorization: Bearer SEU_TOKEN_CLERK"
```

### 3. Testar Stripe webhook local

```bash
# Instalar Stripe CLI
stripe listen --forward-to localhost:3001/api/payments/webhooks/stripe

# Em outro terminal, simular evento
stripe trigger checkout.session.completed
```

## 🚀 Deploy na Vercel

### 1. Configure as variáveis de ambiente no dashboard da Vercel

Todas as variáveis do `.env.example`

Para Prisma ORM v7, configure as URLs do banco sem aspas e sem prefixo `DATABASE_URL=` dentro do valor:

```env
MIGRATIONS_DATABASE_URL=postgresql://user:pass@host:5432/db?schema=tickrify&sslmode=require
DATABASE_URL=postgresql://user:pass@host:5432/db?schema=tickrify&sslmode=require
```

### 2. Deploy

```bash
vercel --prod
```

### 3. Configure o webhook do Stripe

No dashboard do Stripe, adicione:
```
https://seu-dominio.vercel.app/api/payments/webhooks/stripe
```

## 📊 Fluxo de Análise

1. **Frontend** envia imagem via POST `/api/ai/analyze`
2. **Backend** faz upload para S3
3. **Backend** cria registro `Analysis` com status `queued`
4. **Backend** adiciona job no BullMQ
5. **Worker** pega o job e:
   - Atualiza status para `processing`
   - Chama OpenAI com imagem do S3
   - Parse resposta (BUY/SELL/HOLD)
   - Salva resultado com status `done`
6. **Frontend** consulta GET `/api/ai/analysis/:id` para ver resultado

## 🔒 Estrutura de Resposta da IA

```json
{
  "id": "analysis_id",
  "status": "done",
  "recommendation": "BUY",
  "confidence": 85,
  "reasoning": "Análise técnica detalhada...",
  "imageUrl": "https://s3.amazonaws.com/...",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

## 🛠️ Scripts Disponíveis

- `npm run dev` - Inicia backend em modo watch
- `npm run build` - Build para produção
- `npm run start` - Inicia backend (prod)
- `npm run migrate` - Roda migrations
- `npm run studio` - Abre Prisma Studio
- `npm run worker` - Inicia worker BullMQ
- `npm run lint` - Lint do código
- `npm run test` - Roda testes

## 📦 Tecnologias

- NestJS 10
- Prisma 5
- PostgreSQL
- Redis + BullMQ
- Clerk SDK
- Stripe SDK
- AWS SDK (S3)
- OpenAI SDK

## 🐛 Troubleshooting

### Worker não processa jobs

- Verifique se Redis está rodando
- Verifique `REDIS_URL` no `.env`
- Veja logs do worker: `npm run worker`

### Stripe webhook falha

- Use Stripe CLI local para testar
- Verifique `STRIPE_WEBHOOK_SECRET`
- Veja logs em `vercel logs`

### Erro de upload S3

- Verifique credenciais AWS
- Verifique permissões do bucket
- Bucket deve permitir PutObject

## 🤖 Sistema de Prompts de IA

### Versões Disponíveis

**v1 (Production) - ATIVO por padrão:**
- Sistema multi-agente com 7 especialistas
- Análise profunda e completa
- Scoring de confluência técnica
- ~50KB de instruções

**v2 (Simplified) - Para testes:**
- Análise direta e rápida
- Output simples
- ~1KB de instruções

### Gerenciar Prompts

```bash
# Ver prompt ativo
GET /api/prompts/latest

# Listar todas as versões
GET /api/prompts/list

# Ativar uma versão específica
POST /api/prompts/1/activate

# Criar nova versão
POST /api/prompts/config
{
  "prompt": "Seu prompt customizado...",
  "setActive": false
}
```

**📖 Documentação completa:** Ver [docs/backend/PROMPTS.md](../../docs/backend/PROMPTS.md)

---

## 📞 Suporte

Para mais informações sobre o sistema de IA e prompts, consulte:
- [docs/backend/PROMPTS.md](../../docs/backend/PROMPTS.md) - Documentação completa do sistema de prompts
- [docs/backend/API_EXAMPLES.md](../../docs/backend/API_EXAMPLES.md) - Exemplos de uso da API
