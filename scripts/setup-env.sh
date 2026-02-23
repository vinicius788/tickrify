#!/bin/bash

# ============================================
# SCRIPT DE SETUP DE VARIÁVEIS DE AMBIENTE
# ============================================

echo "🔐 TICKRIFY - SETUP DE VARIÁVEIS DE AMBIENTE"
echo "============================================="
echo ""

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Este script vai te guiar na configuração das variáveis de ambiente${NC}"
echo ""

# ============================================
# BACKEND .env
# ============================================

echo -e "${YELLOW}=== BACKEND ENVIRONMENT ===${NC}"
echo ""

read -p "Database URL (Supabase): " DATABASE_URL
read -p "Clerk Publishable Key: " CLERK_PUB
read -p "Clerk Secret Key: " CLERK_SECRET
read -p "OpenAI API Key: " OPENAI_KEY
read -p "Redis URL: " REDIS_URL
read -p "Frontend URL: " FRONTEND_URL

echo ""
read -p "Usar S3 para storage? (y/n) " -n 1 -r
echo
USE_S3=false
if [[ $REPLY =~ ^[Yy]$ ]]; then
    USE_S3=true
    read -p "AWS S3 Bucket: " S3_BUCKET
    read -p "AWS Region: " AWS_REGION
    read -p "AWS Access Key ID: " AWS_KEY_ID
    read -p "AWS Secret Access Key: " AWS_SECRET
fi

echo ""
read -p "Configurar Stripe? (y/n) " -n 1 -r
echo
USE_STRIPE=false
if [[ $REPLY =~ ^[Yy]$ ]]; then
    USE_STRIPE=true
    read -p "Stripe Secret Key: " STRIPE_KEY
    read -p "Stripe Webhook Secret: " STRIPE_WEBHOOK
fi

# Criar .env do backend
cat > apps/backend/.env << EOF
# ============================================
# TICKRIFY BACKEND - ENVIRONMENT VARIABLES
# Generated: $(date)
# ============================================

# Node Environment
NODE_ENV=production
PORT=3000

# ============================================
# DATABASE (Supabase PostgreSQL)
# ============================================
DATABASE_URL="$DATABASE_URL"

# ============================================
# AUTHENTICATION (Clerk)
# ============================================
CLERK_PUBLISHABLE_KEY="$CLERK_PUB"
CLERK_SECRET_KEY="$CLERK_SECRET"

# ============================================
# AI SERVICE (OpenAI)
# ============================================
OPENAI_API_KEY="$OPENAI_KEY"

# ============================================
# QUEUE & CACHE (Redis)
# ============================================
REDIS_URL="$REDIS_URL"

# ============================================
# FILE STORAGE
# ============================================
USE_LOCAL_STORAGE=$([ "$USE_S3" = true ] && echo "false" || echo "true")

EOF

if [ "$USE_S3" = true ]; then
    cat >> apps/backend/.env << EOF
# AWS S3
AWS_S3_BUCKET="$S3_BUCKET"
AWS_REGION="$AWS_REGION"
AWS_ACCESS_KEY_ID="$AWS_KEY_ID"
AWS_SECRET_ACCESS_KEY="$AWS_SECRET"

EOF
fi

if [ "$USE_STRIPE" = true ]; then
    cat >> apps/backend/.env << EOF
# ============================================
# PAYMENTS (Stripe)
# ============================================
STRIPE_SECRET_KEY="$STRIPE_KEY"
STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK"

EOF
fi

cat >> apps/backend/.env << EOF
# ============================================
# CORS & FRONTEND
# ============================================
FRONTEND_URL="$FRONTEND_URL"
EOF

echo -e "${GREEN}✅ Backend .env criado!${NC}"

# ============================================
# FRONTEND .env.production
# ============================================

echo ""
echo -e "${YELLOW}=== FRONTEND ENVIRONMENT ===${NC}"
echo ""

read -p "Backend API URL: " API_URL

cat > apps/frontend/.env.production << EOF
# ============================================
# TICKRIFY FRONTEND - PRODUCTION
# Generated: $(date)
# ============================================

# Backend API
VITE_API_URL=$API_URL

# Authentication (Clerk)
VITE_CLERK_PUBLISHABLE_KEY=$CLERK_PUB
EOF

echo -e "${GREEN}✅ Frontend .env.production criado!${NC}"

# ============================================
# SUMMARY
# ============================================

echo ""
echo -e "${GREEN}✅ SETUP CONCLUÍDO!${NC}"
echo ""
echo "📁 Arquivos criados:"
echo "  - apps/backend/.env"
echo "  - apps/frontend/.env.production"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANTE:${NC}"
echo "  1. Nunca faça commit dos arquivos .env"
echo "  2. Configure as mesmas variáveis na sua plataforma de deploy"
echo "  3. Teste localmente antes de fazer deploy"
echo ""
echo "🚀 Próximo passo: Deploy"
echo "  Railway: ./scripts/deploy-railway.sh"
echo "  Vercel:  ./scripts/deploy-vercel.sh"

