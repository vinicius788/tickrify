#!/bin/bash

set -euo pipefail

echo "TICKRIFY - Setup de variaveis de ambiente"
echo "=========================================="
echo ""

echo "Este setup gera:"
echo " - apps/backend/.env"
echo " - apps/frontend/.env.production"
echo ""

echo "BACKEND"
echo "-------"
read -r -p "Database URL (Supabase pooler): " DATABASE_URL
read -r -p "Direct URL (enter para repetir DATABASE_URL): " DIRECT_URL
DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"

read -r -p "Clerk Publishable Key: " CLERK_PUB
read -r -p "Clerk Secret Key: " CLERK_SECRET
read -r -p "Clerk Issuer (opcional): " CLERK_ISSUER

read -r -p "OpenAI API Key: " OPENAI_KEY
read -r -p "Redis URL: " REDIS_URL
read -r -p "Frontend URL (ex: https://app.tickrify.com): " FRONTEND_URL
read -r -p "App URL (enter para usar FRONTEND_URL): " APP_URL
APP_URL="${APP_URL:-$FRONTEND_URL}"

echo ""
echo "Storage em runtime usa Supabase Storage."
read -r -p "Supabase URL (ex: https://xxx.supabase.co): " SUPABASE_URL
read -r -p "Supabase Service Key (service_role): " SUPABASE_SERVICE_KEY
read -r -p "Supabase Storage Bucket [analysis-images]: " SUPABASE_STORAGE_BUCKET
SUPABASE_STORAGE_BUCKET="${SUPABASE_STORAGE_BUCKET:-analysis-images}"

read -r -p "Bootstrap admin emails (opcional, separado por virgula): " BOOTSTRAP_ADMIN_EMAILS

echo ""
read -r -p "Configurar Stripe agora? (y/n): " STRIPE_REPLY
USE_STRIPE=false
if [[ "$STRIPE_REPLY" =~ ^[Yy]$ ]]; then
  USE_STRIPE=true
  read -r -p "Stripe Secret Key: " STRIPE_SECRET_KEY
  read -r -p "Stripe Publishable Key: " STRIPE_PUBLISHABLE_KEY
  read -r -p "Stripe Webhook Secret: " STRIPE_WEBHOOK_SECRET
  read -r -p "Stripe Price Pro Monthly: " STRIPE_PRICE_PRO_MONTHLY
  read -r -p "Stripe Price Pro Annual (opcional): " STRIPE_PRICE_PRO_ANNUAL
fi

cat > apps/backend/.env <<EOF
# ============================================
# TICKRIFY BACKEND - ENVIRONMENT VARIABLES
# Generated: $(date)
# ============================================

NODE_ENV=production
APP_ENV=production
PORT=3001

DATABASE_URL="$DATABASE_URL"
DIRECT_URL="$DIRECT_URL"

CLERK_PUBLISHABLE_KEY="$CLERK_PUB"
CLERK_SECRET_KEY="$CLERK_SECRET"
CLERK_ISSUER="$CLERK_ISSUER"
CLERK_AUTHORIZED_PARTIES="$FRONTEND_URL"
BOOTSTRAP_ADMIN_EMAILS="$BOOTSTRAP_ADMIN_EMAILS"

OPENAI_API_KEY="$OPENAI_KEY"
AI_MODEL="gpt-4o"
DEMO_MODE=false

REDIS_URL="$REDIS_URL"

SUPABASE_URL="$SUPABASE_URL"
SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY"
SUPABASE_STORAGE_BUCKET="$SUPABASE_STORAGE_BUCKET"

FRONTEND_URL="$FRONTEND_URL"
APP_URL="$APP_URL"
CORS_ORIGINS="$FRONTEND_URL"

FREE_ANALYSIS_LIMIT_PER_MONTH=3
EOF

if [ "$USE_STRIPE" = true ]; then
  cat >> apps/backend/.env <<EOF

STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY"
STRIPE_PUBLISHABLE_KEY="$STRIPE_PUBLISHABLE_KEY"
STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET"
STRIPE_PRICE_PRO_MONTHLY="$STRIPE_PRICE_PRO_MONTHLY"
STRIPE_PRICE_PRO_ANNUAL="$STRIPE_PRICE_PRO_ANNUAL"
EOF
fi

echo ""
echo "FRONTEND"
echo "--------"
read -r -p "Backend API URL publico (ex: https://api.tickrify.com): " API_URL

cat > apps/frontend/.env.production <<EOF
# ============================================
# TICKRIFY FRONTEND - PRODUCTION
# Generated: $(date)
# ============================================

VITE_API_URL="$API_URL"
VITE_CLERK_PUBLISHABLE_KEY="$CLERK_PUB"
EOF

echo ""
echo "Setup concluido."
echo "Arquivos gerados:"
echo " - apps/backend/.env"
echo " - apps/frontend/.env.production"
echo ""
echo "Proximo passo:"
echo " - Revisar valores e fazer deploy"

