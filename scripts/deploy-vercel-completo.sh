#!/bin/bash

# ============================================
# DEPLOY COMPLETO: VERCEL + RAILWAY WORKER
# ============================================

set -e

echo "🚀 TICKRIFY - DEPLOY VERCEL + RAILWAY"
echo "======================================"
echo ""

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# ============================================
# PASSO 1: REDIS (UPSTASH)
# ============================================

echo -e "${BLUE}📦 PASSO 1/4: Setup Redis (Upstash)${NC}"
echo ""
echo "1. Acesse: https://upstash.com/"
echo "2. Login/Signup"
echo "3. Create Database → Redis"
echo "4. Region: Escolha mais próximo"
echo "5. Copie a REDIS_URL (aba Details → REST API → UPSTASH_REDIS_REST_URL)"
echo ""
read -p "Cole o REDIS_URL aqui: " REDIS_URL

if [ -z "$REDIS_URL" ]; then
    echo -e "${RED}❌ REDIS_URL não pode estar vazio${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Redis URL configurado${NC}"

# ============================================
# PASSO 2: VERIFICAR DEPENDÊNCIAS
# ============================================

echo ""
echo -e "${BLUE}🔍 PASSO 2/4: Verificando dependências${NC}"

if ! command -v vercel &> /dev/null; then
    echo -e "${YELLOW}⚠️  Vercel CLI não instalado${NC}"
    echo "Instalando..."
    npm install -g vercel
fi

echo -e "${GREEN}✅ Vercel CLI instalado${NC}"

# ============================================
# PASSO 3: DEPLOY NA VERCEL
# ============================================

echo ""
echo -e "${BLUE}▲ PASSO 3/4: Deploy na Vercel${NC}"
echo ""

# Build frontend
echo "🔨 Building frontend..."
cd apps/frontend
npm install
npm run build
cd ../..

echo -e "${GREEN}✅ Frontend build concluído${NC}"

# Deploy
echo ""
echo "🚀 Deploying para Vercel..."
vercel --prod

echo ""
echo -e "${GREEN}✅ Deploy na Vercel concluído!${NC}"
echo ""
read -p "Cole a URL do app na Vercel (ex: https://seu-app.vercel.app): " VERCEL_URL

if [ -z "$VERCEL_URL" ]; then
    echo -e "${RED}❌ URL não pode estar vazio${NC}"
    exit 1
fi

# ============================================
# PASSO 4: CONFIGURAR VARIÁVEIS NA VERCEL
# ============================================

echo ""
echo -e "${BLUE}⚙️  PASSO 4/4: Configurar variáveis de ambiente${NC}"
echo ""
echo "Acesse: https://vercel.com/dashboard"
echo "Selecione seu projeto → Settings → Environment Variables"
echo ""
echo "Adicione as seguintes variáveis:"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "REDIS_URL=$REDIS_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Você também precisa adicionar:"
echo "  • DATABASE_URL (Supabase)"
echo "  • CLERK_PUBLISHABLE_KEY"
echo "  • CLERK_SECRET_KEY"
echo "  • OPENAI_API_KEY"
echo "  • FRONTEND_URL=$VERCEL_URL"
echo "  • USE_LOCAL_STORAGE=false"
echo "  • NODE_ENV=production"
echo ""
read -p "Pressione Enter quando terminar de adicionar TODAS as variáveis..."

# ============================================
# PASSO 5: REDEPLOY (PARA APLICAR VARIÁVEIS)
# ============================================

echo ""
echo "🔄 Redeploy para aplicar variáveis..."
vercel --prod

# ============================================
# PASSO 6: WORKER NO RAILWAY
# ============================================

echo ""
echo -e "${BLUE}🚂 AGORA: Deploy do Worker no Railway${NC}"
echo ""
echo "O Worker PRECISA rodar no Railway (ou similar) porque:"
echo "  • Vercel tem timeout de 10s (Hobby) ou 300s (Pro)"
echo "  • Worker precisa rodar continuamente"
echo "  • Railway oferece $5 gratuito/mês"
echo ""
echo "Passos:"
echo "  1. Acesse: https://railway.app/"
echo "  2. Login com GitHub"
echo "  3. New Project → GitHub Repo"
echo "  4. Escolha: tickrify-novo"
echo "  5. Settings:"
echo "     • Root Directory: apps/backend"
echo "     • Build Command: npm install && npm run build && npx prisma generate"
echo "     • Start Command: npm run worker"
echo "  6. Variables (adicione as MESMAS da Vercel):"
echo "     • DATABASE_URL"
echo "     • CLERK_PUBLISHABLE_KEY"
echo "     • CLERK_SECRET_KEY"
echo "     • OPENAI_API_KEY"
echo "     • REDIS_URL=$REDIS_URL"
echo "     • FRONTEND_URL=$VERCEL_URL"
echo "     • NODE_ENV=production"
echo "  7. Deploy!"
echo ""
read -p "Pressione Enter quando o Worker estiver rodando no Railway..."

# ============================================
# VERIFICAÇÃO
# ============================================

echo ""
echo -e "${BLUE}🔍 Verificando deploy...${NC}"
echo ""

# Check frontend
echo "Testando frontend..."
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$VERCEL_URL")

if [ "$FRONTEND_STATUS" -eq 200 ]; then
    echo -e "${GREEN}✅ Frontend está online (HTTP $FRONTEND_STATUS)${NC}"
else
    echo -e "${YELLOW}⚠️  Frontend status: HTTP $FRONTEND_STATUS${NC}"
fi

# Check backend
echo "Testando backend..."
BACKEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$VERCEL_URL/api/health")

if [ "$BACKEND_STATUS" -eq 200 ]; then
    echo -e "${GREEN}✅ Backend está online (HTTP $BACKEND_STATUS)${NC}"
else
    echo -e "${YELLOW}⚠️  Backend status: HTTP $BACKEND_STATUS${NC}"
fi

# ============================================
# CONCLUSÃO
# ============================================

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}✅ DEPLOY CONCLUÍDO!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo "🌐 URLs:"
echo "   Frontend: $VERCEL_URL"
echo "   Backend:  $VERCEL_URL/api"
echo "   Health:   $VERCEL_URL/api/health"
echo ""
echo "📊 Próximos passos:"
echo "   1. Teste o login"
echo "   2. Faça upload de um gráfico"
echo "   3. Verifique logs do worker no Railway"
echo "   4. Monitore performance"
echo ""
echo "📝 Logs:"
echo "   Vercel:  vercel logs $VERCEL_URL --follow"
echo "   Railway: railway logs --service worker"
echo ""
echo "📚 Documentação:"
echo "   cat DEPLOY_VERCEL_COMPLETO.md"
echo ""
echo -e "${GREEN}🎉 TUDO PRONTO!${NC}"

