# 🚀 Guia Rápido de Deploy - Tickrify (CORRIGIDO)

**Problema resolvido:** Conflito entre `functions` e `builds` no vercel.json

---

## ⚡ Deploy Rápido (Recomendado)

### Opção 1: Deploy Separado (Mais Simples)

Esta é a forma mais confiável e recomendada pela Vercel para monorepos.

#### 1️⃣ Deploy do Backend

```bash
cd apps/backend
npx vercel --prod
```

**O que vai acontecer:**
- Vercel vai detectar o `vercel.json` local
- Vai compilar o backend usando o build já existente em `dist/`
- Vai criar uma função serverless com o arquivo `dist/src/vercel.js`
- Você receberá uma URL tipo: `https://tickrify-backend.vercel.app`

**⚠️ IMPORTANTE:** Copie a URL do backend para usar no próximo passo!

---

#### 2️⃣ Atualizar Variável do Frontend

Antes de fazer deploy do frontend, você precisa atualizar a variável de ambiente:

```bash
# Edite o arquivo .env do frontend
cd ../frontend
nano .env  # ou use seu editor preferido
```

Altere:
```
VITE_API_URL=https://SEU-BACKEND.vercel.app
```

Substitua `SEU-BACKEND.vercel.app` pela URL real que você recebeu no passo anterior.

---

#### 3️⃣ Deploy do Frontend

```bash
cd ../../  # Voltar para a raiz
npx vercel --prod
```

**O que vai acontecer:**
- Vercel vai detectar o `vercel.json` da raiz
- Vai compilar o frontend (apps/frontend)
- Vai servir os arquivos estáticos do `dist/`
- Você receberá uma URL tipo: `https://tickrify.vercel.app`

---

#### 4️⃣ Atualizar CORS do Backend

Agora que você tem a URL do frontend, precisa atualizar o backend:

1. Acesse o **Dashboard da Vercel** do seu projeto backend
2. Vá em **Settings > Environment Variables**
3. Encontre a variável `FRONTEND_URL`
4. Atualize para: `https://SEU-FRONTEND.vercel.app`
5. Clique em **Save**
6. Faça **Redeploy** do backend

---

## 🔧 Configurações Necessárias na Vercel

### Backend - Environment Variables

Configure estas variáveis no Dashboard da Vercel (Settings > Environment Variables):

```bash
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
CLERK_SECRET_KEY=YOUR_SECRET_KEY_HERE
CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY_HERE
OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE
STRIPE_SECRET_KEY=YOUR_SECRET_KEY_HERE
STRIPE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY_HERE
STRIPE_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET_HERE
STRIPE_PRICE_PRO=price_...
FRONTEND_URL=https://seu-frontend.vercel.app
NODE_ENV=production
```

### Frontend - Environment Variables

Configure estas variáveis no Dashboard da Vercel:

```bash
VITE_API_URL=https://seu-backend.vercel.app
VITE_CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY_HERE
```

---

## ✅ Validação

### Teste o Backend
```bash
curl https://seu-backend.vercel.app/health
# Esperado: {"status":"ok"}
```

### Teste o Frontend
1. Abra `https://seu-frontend.vercel.app` no navegador
2. Verifique se a página carrega
3. Tente fazer login
4. Teste o upload de uma imagem

---

## 🐛 Troubleshooting

### Erro: "Cannot find module 'dist/src/vercel.js'"

**Solução:** O backend precisa ser compilado antes do deploy.

```bash
cd apps/backend
npm run build
npx vercel --prod
```

---

### Erro: CORS ao chamar a API

**Causa:** A variável `FRONTEND_URL` no backend não está correta.

**Solução:**
1. Verifique a variável na Vercel Dashboard do backend
2. Deve ser exatamente a URL do frontend (sem barra no final)
3. Faça redeploy do backend

---

### Erro: "The 'functions' property cannot be used..."

**Solução:** Já corrigido! O novo `vercel.json` não tem mais esse conflito.

---

## 📝 Checklist Final

Antes de considerar o deploy completo, verifique:

- [ ] Backend deployado com sucesso
- [ ] Frontend deployado com sucesso
- [ ] Variáveis de ambiente configuradas em ambos
- [ ] `FRONTEND_URL` no backend aponta para o frontend real
- [ ] `VITE_API_URL` no frontend aponta para o backend real
- [ ] Teste de health check do backend funcionando
- [ ] Login no frontend funcionando
- [ ] Upload e análise de imagem funcionando
- [ ] Webhook do Stripe configurado
- [ ] Migrations do banco aplicadas

---

## 🎉 Pronto!

Sua plataforma Tickrify está no ar! 

**URLs finais:**
- Frontend: `https://seu-frontend.vercel.app`
- Backend API: `https://seu-backend.vercel.app`

**Próximos passos:**
1. Configure um domínio customizado (opcional)
2. Configure monitoramento e logs
3. Teste com usuários reais
4. Monitore uso de APIs (OpenAI, Stripe)

Boa sorte! 🚀
