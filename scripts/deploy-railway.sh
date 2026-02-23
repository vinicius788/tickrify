#!/bin/bash

# ============================================
# SCRIPT DE DEPLOY AUTOMÁTICO - RAILWAY
# ============================================

set -e

echo "🚂 TICKRIFY - DEPLOY PARA RAILWAY"
echo "=================================="
echo ""

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Verificar se Railway CLI está instalado
if ! command -v railway &> /dev/null; then
    echo -e "${RED}❌ Railway CLI não está instalado${NC}"
    echo ""
    echo "Instale com:"
    echo "  npm install -g @railway/cli"
    echo ""
    echo "Ou:"
    echo "  brew install railway"
    exit 1
fi

echo -e "${GREEN}✅ Railway CLI detectado${NC}"
echo ""

# Login no Railway
echo "🔐 Fazendo login no Railway..."
railway login

echo ""
echo "📋 Projetos Railway:"
railway list

echo ""
read -p "Digite o ID do seu projeto Railway: " PROJECT_ID

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}❌ ID do projeto não pode estar vazio${NC}"
    exit 1
fi

# Link do projeto
echo ""
echo "🔗 Linkando projeto..."
railway link $PROJECT_ID

# Deploy do Backend
echo ""
echo "🚀 Deploy do Backend..."
cd apps/backend
railway up --service backend

# Deploy do Worker
echo ""
echo "🤖 Deploy do Worker..."
railway up --service worker

echo ""
echo -e "${GREEN}✅ DEPLOY CONCLUÍDO!${NC}"
echo ""
echo "📊 Verificar logs:"
echo "  Backend: railway logs --service backend"
echo "  Worker:  railway logs --service worker"
echo ""
echo "🌐 Abrir dashboard:"
echo "  railway open"

