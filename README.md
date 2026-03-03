# 🎯 TICKRIFY

> Sistema de Análise de Trading com IA de Nível Institucional v3.1

Plataforma de análise técnica de gráficos de trading usando GPT-4 Vision, com sistema multi-agente adaptativo e análise em tempo real.

---

## 🚀 INÍCIO RÁPIDO

> **Status:** ✅ Projeto pronto para deploy

### 📚 Guias Disponíveis

| Guia | Descrição | Quando Usar |
|------|-----------|-------------|
| **[COMECE_AQUI.md](./docs/COMECE_AQUI.md)** | 🎯 Guia super rápido | Quer começar AGORA |
| **[GUIA_FINAL_DEPLOYMENT.md](./docs/GUIA_FINAL_DEPLOYMENT.md)** | 📖 Guia completo passo a passo | Primeira vez fazendo deploy |
| **[STATUS_PROJETO.md](./docs/STATUS_PROJETO.md)** | ✅ Status e arquitetura | Quer entender o projeto |
| Este README | 📋 Visão geral técnica | Referência geral |

### ⚡ TL;DR - Deploy em 1 hora

```bash
# 1. Criar contas (Supabase, Clerk, Stripe, OpenAI, Vercel)
# 2. Configurar .env
cd apps/backend && cp .env.example .env
cd apps/frontend && cp .env.example .env

# 3. Testar localmente
npm install
npm run build  # Deve funcionar sem erros ✅

# 4. Deploy
vercel --prod

# 5. Configurar webhook do Stripe
# URL: https://seu-backend.vercel.app/api/stripe/webhook
```

**Leia:** [COMECE_AQUI.md](./docs/COMECE_AQUI.md) para detalhes!

---

## 🚀 FEATURES

### ✨ Análise com IA Avançada
- **GPT-4 Vision** para análise visual de gráficos
- **Sistema Multi-Agente** (7 agentes especializados)
- **Thresholds Adaptativos** por timeframe (5m, 15m, 1h, 4h, 1d)
- **Momentum Override** para setups excepcionais
- **Sistema de Exceções** para breakouts e rejeições extremas

### 📊 Análise Técnica Completa
- Identificação de tendências e estrutura de mercado
- Reconhecimento de padrões de candlestick e gráficos
- Suporte/Resistência dinâmicos
- Cálculo de confluência técnica (0-100)
- Entry, Stop Loss, Take Profit (TP1, TP2, TP3)
- Risk/Reward Ratio

### 🔐 Sistema de Autenticação
- Login via **Clerk** (Email, Google, GitHub)
- Gerenciamento de usuários
- Sistema de planos (Free, Pro, Premium)

### 💳 Monetização
- Integração com **Stripe**
- 3 planos de assinatura
- Limite de análises por plano
- Webhooks para sincronização

---

## 🏗️ ARQUITETURA

```
┌─────────────────────────────────────────────────────────┐
│                    TICKRIFY STACK                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐     ┌──────────────┐                 │
│  │   FRONTEND   │────▶│   BACKEND    │                 │
│  │    React     │     │   NestJS     │                 │
│  │   Vite +     │     │  + Prisma    │                 │
│  │  TailwindCSS │     │  + BullMQ    │                 │
│  └──────────────┘     └──────────────┘                 │
│                              │                           │
│                              ▼                           │
│                       ┌──────────────┐                  │
│                       │ AI WORKER    │                  │
│                       │   (GPT-4V)   │                  │
│                       │Multi-Agent   │                  │
│                       └──────────────┘                  │
│                              │                           │
│        ┌─────────────────────┼────────────────────┐    │
│        ▼                     ▼                     ▼    │
│  ┌──────────┐         ┌──────────┐         ┌──────────┐│
│  │PostgreSQL│         │  Redis   │         │ OpenAI   ││
│  │(Supabase)│         │ (BullMQ) │         │   API    ││
│  └──────────┘         └──────────┘         └──────────┘│
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 📦 STACK TECNOLÓGICA

### Frontend
- **React 19** + TypeScript
- **Vite** para build
- **TailwindCSS** + shadcn/ui
- **React Router** para navegação
- **Clerk** para autenticação
- **Framer Motion** para animações

### Backend
- **NestJS** framework
- **Prisma** ORM
- **PostgreSQL** database
- **BullMQ** para filas
- **Redis** para cache
- **OpenAI GPT-4 Vision** para IA

### DevOps
- **Docker** ready
- **Render** para backend/worker
- **Vercel** para frontend
- **GitHub Actions** CI/CD

---

## 🛠️ INSTALAÇÃO LOCAL

### Pré-requisitos
- Node.js 18+
- PostgreSQL (ou Supabase)
- Redis
- OpenAI API Key
- Clerk Account

### 1. Clone e Instale
```bash
git clone https://github.com/SEU_USUARIO/tickrify-novo.git
cd tickrify-novo
npm install
```

### 2. Configure Variáveis de Ambiente

**Backend** (`apps/backend/.env`):
```env
DATABASE_URL="postgresql://..."
MIGRATIONS_DATABASE_URL="postgresql://..."
CLERK_PUBLISHABLE_KEY="YOUR_PUBLISHABLE_KEY_HERE"
CLERK_SECRET_KEY="YOUR_SECRET_KEY_HERE"
OPENAI_API_KEY="YOUR_OPENAI_API_KEY_HERE"
AI_MODEL="gpt-4o"
REDIS_URL="redis://localhost:6379"
FRONTEND_URL="http://localhost:5173"
CORS_ORIGINS="http://localhost:5173"
NODE_ENV=development
APP_ENV=dev
PORT=3001
```

## ✅ Release Gate (RC)

Antes de promover para produção:
- CI verde (`lint`, `test`, `build`)
- `prisma migrate status` e `migrate deploy` validados em staging
- Smoke pós-deploy verde

Criar tag RC:

```bash
git tag vX.Y.Z-rc1
git push origin vX.Y.Z-rc1
```

Guia completo: [DEPLOY.md](./DEPLOY.md)

**Frontend** (`apps/frontend/.env`):
```env
VITE_API_URL=http://localhost:3001
VITE_CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY_HERE
```

### 3. Setup Database
```bash
cd apps/backend
npx prisma migrate dev
npx prisma generate
npm run seed  # Opcional: dados de teste
```

### 4. Inicie Redis
```bash
redis-server --daemonize yes
```

### 5. Inicie os Serviços

**Opção A: Tudo de uma vez**
```bash
./INICIAR_TUDO.sh
```

**Opção B: Manualmente**
```bash
# Terminal 1: Backend
cd apps/backend
npm run dev

# Terminal 2: Worker
cd apps/backend
npm run worker

# Terminal 3: Frontend
cd apps/frontend
npm run dev
```

### 6. Acesse
- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- API Health: http://localhost:3001/api/health

---

## 🚀 DEPLOY EM PRODUÇÃO

### Deploy Rápido (Recomendado)

Veja: **[DEPLOY_RAPIDO.md](./docs/DEPLOY_RAPIDO.md)**

```bash
# 1. Setup variáveis de ambiente
./scripts/setup-env.sh

# 2. Deploy backend + worker (Railway)
./scripts/deploy-railway.sh

# 3. Deploy frontend (Vercel)
./scripts/deploy-vercel.sh

# 4. Verificar deploy
./scripts/check-deploy.sh https://seu-backend.railway.app https://seu-app.vercel.app

# 5. Smoke test da API em produção (falha CI em erro)
SMOKE_API_BASE_URL=https://seu-backend.railway.app npm run smoke:api
```

### Variáveis de Ambiente (Produção)

Defina no **Railway (backend)**:

```env
NODE_ENV=production
APP_ENV=production
PORT=8080
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE
AI_MODEL=gpt-4o
STRIPE_SECRET_KEY=YOUR_SECRET_KEY_HERE
STRIPE_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET_HERE
CLERK_SECRET_KEY=YOUR_SECRET_KEY_HERE
CLERK_ISSUER=https://SEU_TENANT.clerk.accounts.dev
CLERK_JWKS_URL=https://SEU_TENANT.clerk.accounts.dev/.well-known/jwks.json
CLERK_AUTHORIZED_PARTIES=https://seu-frontend.vercel.app
BOOTSTRAP_ADMIN_EMAILS=admin@suaempresa.com
FRONTEND_URL=https://seu-frontend.vercel.app
CORS_ORIGINS=https://seu-frontend.vercel.app
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=... # fallback aceito
REDIS_URL=rediss://default:... # obrigatório para /ready=ok e processamento
```

No Railway, rode **dois serviços separados**:

- `api`: `npm run migrate:deploy && npm run start:railway`
- `worker`: `npm run worker:railway`

Sem o serviço `worker`, `/api/health/ready` retorna 503 (`worker_unavailable`) e análises não são processadas.

Defina no **Vercel (frontend)**:

```env
VITE_CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY_HERE
# obrigatório em produção:
VITE_API_URL=https://seu-backend.railway.app
```
`vercel.json` não usa mais rewrite externo para backend.
O frontend deve chamar a URL pública do backend via `VITE_API_URL`.

### Deploy Completo

Veja: **[GUIA_DEPLOY_ATUALIZADO.md](./docs/GUIA_DEPLOY_ATUALIZADO.md)**

---

## 📖 DOCUMENTAÇÃO

Índice completo: **[docs/README.md](./docs/README.md)**

### Estrutura do Projeto
```
tickrify-novo/
├── apps/
│   ├── backend/              # API NestJS
│   │   ├── src/
│   │   │   ├── modules/      # Módulos (AI, Auth, Storage, etc)
│   │   │   ├── common/       # Prompts e utils
│   │   │   └── main.ts
│   │   ├── worker/           # AI Worker (BullMQ)
│   │   ├── prisma/           # Database schema
│   │   └── package.json
│   │
│   └── frontend/             # React + Vite
│       ├── src/
│       │   ├── components/   # UI Components
│       │   ├── lib/          # API client e utils
│       │   └── App.tsx
│       └── package.json
│
├── scripts/                  # Scripts de deploy
├── docs/                     # Toda documentação centralizada
│   ├── backend/              # Documentação técnica do backend
│   └── README.md             # Índice de documentação
└── README.md                 # Este arquivo
```

### API Endpoints

**Health Check**
```bash
GET /api/health
```

**Criar Análise**
```bash
POST /api/ai/analyze
Content-Type: multipart/form-data

Body: {
  file: <image>
}

Response: {
  id: "uuid",
  status: "processing"
}
```

**Obter Análise**
```bash
GET /api/ai/analyze/:id

Response: {
  id: "uuid",
  status: "done",
  recommendation: "BUY",
  confidence: 75,
  analysis: {
    symbol: "BTCUSDT",
    entry: 42200,
    stopLoss: 41750,
    ...
  }
}
```

**Listar Análises**
```bash
GET /api/ai/analyses
```

---

## 🤖 SISTEMA DE IA v3.1

### Multi-Agent Architecture

1. **CHART_INSPECTOR** - Validação de qualidade da imagem
2. **STRUCTURE_ANALYST** - Análise de tendência e estrutura
3. **PATTERN_RECOGNITION** - Identificação de padrões
4. **PRICE_ACTION_ANALYST** - Análise pura de price action
5. **RISK_MANAGER** - Cálculo de entry/stop/TP
6. **CONFLUENCE_ENGINE** - Score de confluência (0-100)
7. **DECISION_SYNTHESIZER** - Decisão final (BUY/SELL/HOLD)

### Thresholds Adaptativos

| Timeframe | Threshold | Fatores Mínimos | Override |
|-----------|-----------|-----------------|----------|
| 1m-5m     | 50 pts    | 2               | ✅ Sim   |
| 15m-1h    | 55 pts    | 2               | ✅ Sim   |
| 4h-1d     | 60 pts    | 3               | ❌ Não   |
| 1w+       | 65 pts    | 3               | ❌ Não   |

### Momentum Override

Para timeframes rápidos (1m-1h), se detectar **momentum forte**:
- Threshold reduzido para 45-48 pontos
- Stop loss apertado obrigatório
- R/R mínimo 1:2

**Critérios**:
- 3+ candles grandes consecutivos
- Aceleração visível
- Breakout de nível relevante
- Volume confirmando (se visível)

---

## 🧪 TESTES

```bash
# Backend
cd apps/backend
npm run test
npm run test:e2e

# Frontend
cd apps/frontend
npm run test
```

---

## 📊 MONITORAMENTO

### Logs

**Desenvolvimento**:
```bash
# Backend
tail -f logs/backend.log

# Worker
tail -f logs/worker.log
```

**Produção**:
```bash
# Railway
railway logs --service backend --tail
railway logs --service worker --tail

# Vercel
vercel logs seu-app.vercel.app --follow
```

### Health Checks

```bash
# Backend health
curl http://localhost:3000/api/health

# Worker status (check logs)
tail -f logs/worker.log | grep "started and listening"
```

---

## 🤝 CONTRIBUINDO

1. Fork o projeto
2. Crie uma branch: `git checkout -b feature/nova-feature`
3. Commit: `git commit -m 'Add nova feature'`
4. Push: `git push origin feature/nova-feature`
5. Abra um Pull Request

---

## 📝 CHANGELOG

### v3.1 (Novembro 2025) - OPTIMIZED
- ✅ Thresholds adaptativos por timeframe
- ✅ Momentum override para setups excepcionais
- ✅ Sistema de exceções para breakouts
- ✅ Justificativas adaptadas ao timeframe
- ✅ Parser de JSON corrigido (remove markdown)

### v3.0 (Novembro 2025) - BALANCED
- ✅ Scoring reduzido (50+ pts para 5m)
- ✅ Fatores mínimos reduzidos (2 vs 3)
- ✅ Padrões >60% confiança válidos
- ✅ Prompt mais proativo

### v2.0 (Outubro 2025)
- Sistema de planos implementado
- Worker assíncrono com BullMQ
- Clerk integration

### v1.0 (Setembro 2025)
- MVP inicial
- Análise básica com GPT-4 Vision

---

## 🐛 TROUBLESHOOTING

### Worker não processa jobs
```bash
# Verificar Redis
redis-cli ping

# Checar logs
tail -f logs/worker.log

# Verificar OpenAI API Key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Frontend não conecta ao backend
```bash
# Verificar CORS
curl -H "Origin: http://localhost:5173" \
  -v http://localhost:3000/api/health

# Verificar variáveis de ambiente
cat apps/frontend/.env
```

### Prisma não conecta ao banco
```bash
# Testar conexão
cd apps/backend
npx prisma db pull

# Regenerar client
npx prisma generate
```

---

## 📄 LICENÇA

Este projeto é privado e proprietário.

---

## 👨‍💻 AUTOR

Desenvolvido com ❤️ para traders profissionais.

---

## 📞 SUPORTE

Para questões técnicas:
1. Verifique [GUIA_DEPLOY_ATUALIZADO.md](./docs/GUIA_DEPLOY_ATUALIZADO.md)
2. Consulte [DEPLOY_RAPIDO.md](./docs/DEPLOY_RAPIDO.md)
3. Cheque os logs do sistema

---

**🎯 TICKRIFY v3.1** - Análise de Trading com IA de Nível Institucional

Última atualização: Novembro 2025
# tickrify
