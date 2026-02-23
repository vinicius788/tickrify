# ✅ Checklist de Deploy - Tickrify

**Use este arquivo para acompanhar seu progresso no deploy!**

---

## 🎯 Status Geral

```
Progresso: ████████████░░░░░░░░ 60% (6/10 etapas)

✅ Código pronto
✅ Build funcionando
✅ Documentação completa
⏳ Contas nos serviços
⏳ Variáveis de ambiente
⏳ Deploy na Vercel
⏳ Configuração final
```

---

## 📋 Checklist Detalhado

### Fase 1: Preparação ✅ (CONCLUÍDA)

- [x] **Código do projeto completo**
- [x] **Build local testado**
- [x] **Integrações implementadas** (Clerk, Stripe, OpenAI)
- [x] **AuthGuard configurado**
- [x] **Webhook otimizado**
- [x] **Documentação criada**

**Status:** ✅ 100% completo

---

### Fase 2: Contas nos Serviços ⏳ (A FAZER)

#### Banco de Dados - Supabase
- [ ] Criar conta em https://supabase.com
- [ ] Criar novo projeto
- [ ] Copiar `DATABASE_URL` (connection pooler)
- [ ] Copiar `DIRECT_URL` (direct connection)

**Tempo estimado:** 5 minutos

#### Autenticação - Clerk
- [ ] Criar conta em https://clerk.com
- [ ] Criar aplicação
- [ ] Copiar `CLERK_PUBLISHABLE_KEY`
- [ ] Copiar `CLERK_SECRET_KEY`

**Tempo estimado:** 5 minutos

#### Pagamentos - Stripe
- [ ] Criar conta em https://stripe.com
- [ ] Ativar modo teste
- [ ] Copiar `STRIPE_SECRET_KEY`
- [ ] Copiar `STRIPE_PUBLISHABLE_KEY`
- [ ] Criar produto "Tickrify Pro"
- [ ] Copiar `STRIPE_PRO_PRICE_ID`

**Tempo estimado:** 10 minutos

#### IA - OpenAI
- [ ] Criar conta em https://platform.openai.com
- [ ] Adicionar método de pagamento
- [ ] Criar API key
- [ ] Copiar `OPENAI_API_KEY`

**Tempo estimado:** 5 minutos

#### Redis - Upstash (Opcional mas recomendado)
- [ ] Criar conta em https://upstash.com
- [ ] Criar Redis database
- [ ] Copiar `REDIS_URL`

**Tempo estimado:** 5 minutos

#### Hosting - Vercel
- [ ] Criar conta em https://vercel.com
- [ ] Instalar Vercel CLI: `npm install -g vercel`
- [ ] Login: `vercel login`

**Tempo estimado:** 5 minutos

**Status:** ⏳ 0% completo (0/6)

---

### Fase 3: Configuração Local ⏳ (A FAZER)

#### Backend
- [ ] `cd apps/backend`
- [ ] `cp .env.example .env`
- [ ] Editar `.env` com credenciais do Supabase
- [ ] Editar `.env` com credenciais do Clerk
- [ ] Editar `.env` com credenciais do Stripe
- [ ] Editar `.env` com credenciais do OpenAI
- [ ] Editar `.env` com `REDIS_URL` (se usar)
- [ ] Editar `.env` com `FRONTEND_URL=http://localhost:5173`

#### Frontend
- [ ] `cd apps/frontend`
- [ ] `cp .env.example .env`
- [ ] Editar `.env` com `VITE_CLERK_PUBLISHABLE_KEY`
- [ ] Editar `.env` com `VITE_API_URL=http://localhost:3001`

**Status:** ⏳ 0% completo (0/12)

---

### Fase 4: Migrations do Banco ⏳ (A FAZER)

- [ ] `cd apps/backend`
- [ ] `npm install`
- [ ] `npx prisma migrate dev`
- [ ] `npx prisma generate`

**Esperado:** Mensagem de sucesso do Prisma

**Status:** ⏳ 0% completo (0/4)

---

### Fase 5: Teste Local ⏳ (A FAZER)

#### Iniciar Backend
- [ ] Terminal 1: `cd apps/backend && npm run dev`
- [ ] Verificar: Backend rodando em http://localhost:3001
- [ ] Testar: `curl http://localhost:3001/api/health`

#### Iniciar Frontend
- [ ] Terminal 2: `cd apps/frontend && npm run dev`
- [ ] Verificar: Frontend rodando em http://localhost:5173
- [ ] Abrir no navegador

#### Testes Funcionais
- [ ] Fazer login com Clerk
- [ ] Upload de gráfico funciona
- [ ] Análise de IA completa (aguardar resposta)
- [ ] Clicar em "Assinar Pro" redireciona para Stripe
- [ ] Ver histórico de análises

**Status:** ⏳ 0% completo (0/10)

---

### Fase 6: Deploy na Vercel ⏳ (A FAZER)

#### Via CLI (recomendado)
- [ ] `cd` para raiz do projeto
- [ ] `vercel`
- [ ] Seguir prompts de configuração
- [ ] `vercel --prod`

#### Via Web (alternativa)
- [ ] Ir em https://vercel.com/new
- [ ] Importar repositório GitHub
- [ ] Configurar Framework: Other
- [ ] Root Directory: `./`
- [ ] Build Command: `npm run build`
- [ ] Clicar em Deploy

#### Aguardar Build
- [ ] Build do backend completado
- [ ] Build do frontend completado
- [ ] Deploy bem-sucedido
- [ ] Copiar URL do deploy

**Status:** ⏳ 0% completo (0/8)

---

### Fase 7: Variáveis na Vercel ⏳ (A FAZER)

#### Configurar no Dashboard
- [ ] Ir em Settings > Environment Variables
- [ ] Adicionar `NODE_ENV=production`
- [ ] Adicionar `DATABASE_URL=...`
- [ ] Adicionar `DIRECT_URL=...`
- [ ] Adicionar `CLERK_SECRET_KEY=...`
- [ ] Adicionar `CLERK_PUBLISHABLE_KEY=...`
- [ ] Adicionar `OPENAI_API_KEY=...`
- [ ] Adicionar `STRIPE_SECRET_KEY=...` (usar chave de PRODUÇÃO!)
- [ ] Adicionar `STRIPE_PUBLISHABLE_KEY=...`
- [ ] Adicionar `STRIPE_PRO_PRICE_ID=...`
- [ ] Adicionar `FRONTEND_URL=https://seu-dominio.vercel.app`
- [ ] Adicionar `REDIS_URL=...` (se usar)

#### Redeploy
- [ ] Clicar em "Redeploy" para aplicar variáveis

**Status:** ⏳ 0% completo (0/13)

---

### Fase 8: Migrations em Produção ⏳ (A FAZER)

- [ ] `cd apps/backend`
- [ ] Configurar `DATABASE_URL` local com URL de produção temporariamente
- [ ] `npx prisma migrate deploy`
- [ ] Reverter `DATABASE_URL` local

**Alternativa:** Executar via Vercel CLI ou criar script de build

**Status:** ⏳ 0% completo (0/3)

---

### Fase 9: Webhook do Stripe ⏳ (A FAZER)

- [ ] Ir em Stripe Dashboard > Developers > Webhooks
- [ ] Clicar em "Add endpoint"
- [ ] URL: `https://seu-backend.vercel.app/api/stripe/webhook`
- [ ] Selecionar eventos:
  - [ ] `checkout.session.completed`
  - [ ] `customer.subscription.created`
  - [ ] `customer.subscription.updated`
  - [ ] `customer.subscription.deleted`
- [ ] Copiar "Signing secret" (YOUR_WEBHOOK_SECRET_HERE)
- [ ] Adicionar na Vercel: `STRIPE_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET_HERE`
- [ ] Redeploy na Vercel

**Status:** ⏳ 0% completo (0/8)

---

### Fase 10: Validação Final ⏳ (A FAZER)

#### Testes de API
- [ ] `curl https://seu-backend.vercel.app/api/health`
- [ ] Resposta: `{"status":"ok"}`

#### Testes de Frontend
- [ ] Abrir: `https://seu-frontend.vercel.app`
- [ ] Página carrega sem erros
- [ ] Fazer login com Clerk
- [ ] Upload de gráfico
- [ ] Aguardar análise de IA
- [ ] Análise aparece com resultado
- [ ] Clicar em "Assinar Pro"
- [ ] Redireciona para Stripe Checkout
- [ ] Testar pagamento (usar cartão de teste)
- [ ] Verificar webhook no Stripe Dashboard
- [ ] Verificar plano atualizado no app

#### Monitoramento
- [ ] Verificar logs da Vercel: `vercel logs`
- [ ] Verificar Stripe Dashboard > Events
- [ ] Verificar Supabase Database
- [ ] Verificar uso OpenAI

**Status:** ⏳ 0% completo (0/15)

---

## 🎉 CONCLUSÃO

### Quando tudo estiver ✅:

```
Progresso: ████████████████████ 100% (10/10 etapas)

✅ Código pronto
✅ Build funcionando
✅ Documentação completa
✅ Contas criadas
✅ Variáveis configuradas
✅ Testes locais passando
✅ Deploy na Vercel
✅ Webhook configurado
✅ Validação completa
✅ Pronto para usuários! 🚀
```

### 🎊 Parabéns! Seu Tickrify está no ar!

---

## 📊 Estatísticas

**Tempo total estimado:** 1-2 horas

**Breakdown:**
- Preparação: 0h (já feito)
- Criar contas: 35 min
- Configurar local: 10 min
- Migrations: 5 min
- Testes locais: 15 min
- Deploy Vercel: 20 min
- Variáveis Vercel: 10 min
- Migrations prod: 5 min
- Webhook Stripe: 10 min
- Validação: 20 min

**Total:** ~2h 10min

---

## 💡 Dicas

### Para Acelerar:
1. Prepare todas as contas de uma vez (35 min)
2. Configure todas as variáveis de uma vez
3. Use Vercel CLI (mais rápido que web)
4. Teste localmente antes de fazer deploy

### Para Evitar Erros:
1. Copie e cole as chaves (não digite)
2. Use modo teste do Stripe até validar
3. Verifique logs constantemente
4. Teste cada funcionalidade individualmente

### Se Algo Falhar:
1. Verifique os logs: `vercel logs`
2. Verifique as variáveis de ambiente
3. Verifique o guia: `GUIA_FINAL_DEPLOYMENT.md`
4. Verifique troubleshooting: `STATUS_PROJETO.md`

---

## 📚 Documentação de Apoio

Durante o processo, consulte:

- **Dúvida rápida:** `COMECE_AQUI.md`
- **Passo a passo:** `GUIA_FINAL_DEPLOYMENT.md`
- **Variáveis:** `docs/backend/ENV_VARIABLES.md`
- **Troubleshooting:** `STATUS_PROJETO.md`
- **Referência:** `README.md`

---

**📍 Você está aqui:** Fase 2 (Criar contas nos serviços)

**🎯 Próximo passo:** Criar conta no Supabase

**💪 Vamos lá! Você consegue!**

