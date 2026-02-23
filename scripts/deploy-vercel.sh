#!/bin/bash

# ============================================
# SCRIPT DE DEPLOY AUTOMÁTICO - VERCEL
# ============================================

set -e

echo "▲ TICKRIFY - DEPLOY FRONTEND PARA VERCEL"
echo "========================================="
echo ""

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Verificar se Vercel CLI está instalado
if ! command -v vercel &> /dev/null; then
    echo -e "${RED}❌ Vercel CLI não está instalado${NC}"
    echo ""
    echo "Instale com:"
    echo "  npm install -g vercel"
    exit 1
fi

echo -e "${GREEN}✅ Vercel CLI detectado${NC}"
echo ""

# Navegar para o frontend
cd apps/frontend

# Verificar se .env.production existe
if [ ! -f .env.production ]; then
    echo -e "${YELLOW}⚠️  .env.production não encontrado${NC}"
    echo ""
    read -p "Criar .env.production agora? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "URL do Backend (ex: https://tickrify-backend.up.railway.app): " BACKEND_URL
        read -p "Clerk Publishable Key: " CLERK_KEY
        
        cat > .env.production << EOF
# Backend API
VITE_API_URL=$BACKEND_URL

# Clerk
VITE_CLERK_PUBLISHABLE_KEY=$CLERK_KEY
EOF
        echo -e "${GREEN}✅ .env.production criado${NC}"
    fi
fi

# Build local primeiro
echo ""
echo "🔨 Building frontend..."
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build falhou${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build local concluído${NC}"
echo ""

# Deploy para produção
echo "🚀 Deploy para Vercel..."
vercel --prod

echo ""
echo -e "${GREEN}✅ DEPLOY CONCLUÍDO!${NC}"
echo ""
echo "🌐 Seu app está disponível no link fornecido acima"
echo ""
echo "📊 Verificar logs:"
echo "  vercel logs [URL]"

