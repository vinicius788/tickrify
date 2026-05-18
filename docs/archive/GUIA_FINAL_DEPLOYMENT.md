# 🚀 Guia Final de Deployment - Tickrify

## ✅ Status do Projeto

### O que já está pronto:

- ✅ **Build local funciona** sem erros
- ✅ **Rotas do frontend corretas** (sem `/api` duplicado)
- ✅ **AuthGuard implementado** (produção segura + dev flexível)
- ✅ **Webhook do Stripe otimizado** (retorna 200 mesmo com erro)
- ✅ **`.vercelignore` criado** (otimiza build)
- ✅ **Prefixo global `/api`** configurado no backend
- ✅ **Documentação completa** (ENV_VARIABLES.md, README_VERCEL.md, etc)
- ✅ **`.env.example`** disponível para referência

---

## 🎯 Próximos Passos para Deploy

### 1. Configurar Banco de Dados (Supabase)

```bash
# 1. Criar conta gratuita em https://supabase.com
# 2. Criar novo projeto
# 3. Ir em Settings > Database
# 4. Copiar "Connection string" (com connection pooler)
# 5. Copiar "Direct connection" 
```

**Adicionar ao `.env` local e Vercel:**
```bash
DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres
```

### 2. Executar Migrations

```bash
cd apps/backend
npx prisma migrate dev
npx prisma generate
```

### 3. Configurar Clerk (Autenticação)

```bash
# 1. Criar conta em https://clerk.com
# 2. Criar aplicação
# 3. Ir em API Keys
# 4. Copiar Publishable Key e Secret Key
```

**Adicionar ao `.env` local:**
```bash
CLERK_SECRET_KEY=YOUR_SECRET_KEY_HERE
CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY_HERE
```

**Adicionar ao frontend (`apps/frontend/.env`):**
```bash
VITE_CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY_HERE
```

### 4. Configurar Stripe (Pagamentos)

```bash
# 1. Criar conta em https://stripe.com
# 2. Ativar modo teste
# 3. Ir em Developers > API keys
# 4. Copiar chaves de teste
```

**Adicionar ao `.env` local:**
```bash
STRIPE_SECRET_KEY=YOUR_SECRET_KEY_HERE
STRIPE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY_HERE
STRIPE_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET_HERE  # Será criado depois do deploy
```

**Criar produtos no Stripe:**
```bash
# No Stripe Dashboard:
# 1. Products > Add Product
# 2. Nome: "Tickrify Pro"
# 3. Preço: R$ 80,00/mês (ou valor desejado)
# 4. Copiar o "Price ID" (price_xxxxx)
```

**Adicionar ao `.env`:**
```bash
STRIPE_PRO_PRICE_ID=price_xxxxx
```

### 5. Configurar OpenAI

```bash
# 1. Criar conta em https://platform.openai.com
# 2. Adicionar método de pagamento
# 3. Ir em API Keys
# 4. Criar nova chave
```

**Adicionar ao `.env`:**
```bash
OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE
```

### 6. Configurar Redis (Opcional mas Recomendado)

Para processamento assíncrono de IA (evita timeouts):

```bash
# 1. Criar conta gratuita em https://upstash.com
# 2. Criar Redis database
# 3. Copiar REDIS_URL
```

**Adicionar ao `.env`:**
```bash
REDIS_URL=rediss://default:[PASSWORD]@[HOST]:6379
```

### 7. Testar Localmente

```bash
# Terminal 1 - Backend
cd apps/backend
npm run dev

# Terminal 2 - Frontend  
cd apps/frontend
npm run dev
```

**Acessar:** http://localhost:5173

**Testar:**
- ✅ Login com Clerk
- ✅ Upload de gráfico
- ✅ Análise de IA
- ✅ Botão "Assinar Pro" (deve redirecionar para Stripe)

### 8. Deploy no Vercel

#### Opção A: Via Interface Web

1. Ir em https://vercel.com/new
2. Importar repositório GitHub
3. Configurar:
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

4. Adicionar todas as variáveis de ambiente (ver `.env.example`)
5. Clicar em "Deploy"

#### Opção B: Via CLI

```bash
# Instalar Vercel CLI
npm install -g vercel

# Na raiz do projeto
vercel

# Seguir prompts e configurar
# Depois:
vercel --prod
```

### 9. Configurar Variáveis de Ambiente na Vercel

No dashboard da Vercel:

1. Settings > Environment Variables
2. Adicionar cada variável do `.env`
3. Importante:
   - `NODE_ENV=production`
   - `FRONTEND_URL=https://seu-dominio.vercel.app`
   - Use chaves de **produção** do Stripe e Clerk

### 10. Executar Migrations em Produção

```bash
# Após primeiro deploy, executar:
cd apps/backend
npx prisma migrate deploy
```

Ou configurar como script de build no Vercel.

### 11. Configurar Webhook do Stripe

1. Ir em Stripe Dashboard > Developers > Webhooks
2. Adicionar endpoint: `https://seu-backend.vercel.app/api/stripe/webhook`
3. Selecionar eventos:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copiar "Signing secret"
5. Adicionar na Vercel como `STRIPE_WEBHOOK_SECRET`

### 12. Validação Final

```bash
# Testar API
curl https://seu-projeto.vercel.app/api/health

# Testar frontend
# Acessar https://seu-projeto.vercel.app
# Fazer login
# Criar análise
# Testar pagamento
```

---

## 🔧 Estrutura das URLs

Com o prefixo global `/api` configurado:

**Backend expõe:**
- `https://seu-backend.vercel.app/api/ai/analyze`
- `https://seu-backend.vercel.app/api/stripe/create-checkout-session`
- `https://seu-backend.vercel.app/api/stripe/webhook`

**Frontend chama:**
```typescript
// Em lib/api.ts e lib/stripe.ts
const API_BASE_URL = 'https://seu-backend.vercel.app';

// Chamadas ficam:
fetch(`${API_BASE_URL}/ai/analyze`)  // NestJS adiciona /api automaticamente
fetch(`${API_BASE_URL}/stripe/create-checkout-session`)
```

---

## 🐛 Troubleshooting

### Erro: "Cannot find module '@nestjs/core'"
```bash
cd apps/backend
npm install
```

### Erro: "Prisma Client not generated"
```bash
cd apps/backend
npx prisma generate
```

### Erro: "CORS error"
Verificar se `FRONTEND_URL` está correto no backend.

### Erro: "Webhook signature verification failed"
1. Verificar se `STRIPE_WEBHOOK_SECRET` está correto
2. Usar secret do ambiente correto (test vs live)
3. Certificar-se de que a URL do webhook está correta

### Timeout na análise de IA
1. Configurar Redis para processamento assíncrono
2. Ou usar Vercel Pro (timeout maior)
3. Ou otimizar prompt/modelo da OpenAI

---

## 📊 Monitoramento

### Logs da Vercel
```bash
vercel logs
```

Ou acessar: https://vercel.com/seu-projeto/logs

### Stripe Dashboard
Monitorar: https://dashboard.stripe.com/test/payments

### Métricas Importantes
- Taxa de conversão para Pro
- Tempo de resposta da IA
- Taxa de erro dos webhooks
- Uso de créditos OpenAI

---

## 💰 Custos Estimados

### Tier Gratuito:
- ✅ Vercel (até 100GB bandwidth)
- ✅ Supabase (até 500MB database)
- ✅ Upstash Redis (10k requests/dia)
- ✅ Clerk (até 10k MAUs)

### Custos Variáveis:
- 💵 Stripe: 2.99% + R$ 0.39 por transação
- 💵 OpenAI: ~$0.01-0.05 por análise (depende do modelo)

### Quando Pagar:
- Se passar dos limites gratuitos
- Se quiser timeout maior (Vercel Pro: $20/mês)
- Se precisar de mais análises de IA

---

## 🎉 Checklist Final

Antes de lançar para usuários reais:

- [ ] Build local funciona
- [ ] Testes locais passam
- [ ] Deploy na Vercel sucesso
- [ ] Variáveis de ambiente configuradas
- [ ] Migrations executadas em produção
- [ ] Webhook do Stripe configurado
- [ ] Login com Clerk funciona
- [ ] Análise de IA funciona
- [ ] Pagamento com Stripe funciona
- [ ] Usuário é atualizado após pagamento
- [ ] Logs monitorados
- [ ] Backups do banco configurados
- [ ] Usar chaves de PRODUÇÃO (não teste)

---

## 📚 Documentação Adicional

- `docs/backend/ENV_VARIABLES.md` - Todas as variáveis de ambiente
- `docs/backend/README_VERCEL.md` - Guia detalhado Vercel
- `docs/backend/DEPLOYMENT_CHECKLIST.md` - Checklist de deploy
- `docs/backend/API_EXAMPLES.md` - Exemplos de uso da API
- `apps/backend/.env.example` - Template de configuração

---

## 🆘 Suporte

Em caso de dúvidas:

1. Verificar logs da Vercel
2. Verificar documentação dos serviços (Clerk, Stripe, etc)
3. Revisar este guia
4. Verificar issues no GitHub do projeto

---

**Boa sorte com o deploy! 🚀**

