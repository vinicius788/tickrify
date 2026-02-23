#!/bin/bash

# ============================================
# SCRIPT DE CHECAGEM PÓS-DEPLOY
# ============================================

echo "🔍 TICKRIFY - CHECAGEM PÓS-DEPLOY"
echo "=================================="
echo ""

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Verificar argumentos
if [ $# -eq 0 ]; then
    echo "Uso: ./scripts/check-deploy.sh <BACKEND_URL> <FRONTEND_URL>"
    echo ""
    echo "Exemplo:"
    echo "  ./scripts/check-deploy.sh https://tickrify-backend.up.railway.app https://tickrify.vercel.app"
    exit 1
fi

BACKEND_URL=$1
FRONTEND_URL=$2

# ============================================
# CHECK 1: Backend Health
# ============================================

echo -e "${BLUE}[1/6] Verificando Backend Health...${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health")

if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}✅ Backend está online (HTTP $HTTP_CODE)${NC}"
else
    echo -e "${RED}❌ Backend não está respondendo (HTTP $HTTP_CODE)${NC}"
fi

# ============================================
# CHECK 2: Database Connection
# ============================================

echo ""
echo -e "${BLUE}[2/6] Verificando Database Connection...${NC}"
DB_CHECK=$(curl -s "$BACKEND_URL/api/health" | grep -o "database.*ok" || echo "fail")

if [[ $DB_CHECK == *"ok"* ]]; then
    echo -e "${GREEN}✅ Database conectado${NC}"
else
    echo -e "${RED}❌ Database não conectado${NC}"
fi

# ============================================
# CHECK 3: Redis Connection
# ============================================

echo ""
echo -e "${BLUE}[3/6] Verificando Redis Connection...${NC}"
REDIS_CHECK=$(curl -s "$BACKEND_URL/api/health" | grep -o "redis.*ok" || echo "fail")

if [[ $REDIS_CHECK == *"ok"* ]]; then
    echo -e "${GREEN}✅ Redis conectado${NC}"
else
    echo -e "${YELLOW}⚠️  Redis status desconhecido${NC}"
fi

# ============================================
# CHECK 4: Frontend Accessibility
# ============================================

echo ""
echo -e "${BLUE}[4/6] Verificando Frontend...${NC}"
FRONTEND_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL")

if [ "$FRONTEND_CODE" -eq 200 ]; then
    echo -e "${GREEN}✅ Frontend está online (HTTP $FRONTEND_CODE)${NC}"
else
    echo -e "${RED}❌ Frontend não está respondendo (HTTP $FRONTEND_CODE)${NC}"
fi

# ============================================
# CHECK 5: API Connectivity from Frontend
# ============================================

echo ""
echo -e "${BLUE}[5/6] Verificando conectividade Frontend → Backend...${NC}"
API_CHECK=$(curl -s "$BACKEND_URL/api/health" -H "Origin: $FRONTEND_URL" -v 2>&1 | grep -i "access-control-allow-origin")

if [ ! -z "$API_CHECK" ]; then
    echo -e "${GREEN}✅ CORS configurado corretamente${NC}"
else
    echo -e "${YELLOW}⚠️  CORS pode não estar configurado corretamente${NC}"
fi

# ============================================
# CHECK 6: SSL Certificates
# ============================================

echo ""
echo -e "${BLUE}[6/6] Verificando SSL...${NC}"

# Backend SSL
BACKEND_SSL=$(curl -vI "$BACKEND_URL" 2>&1 | grep -i "ssl certificate verify" || echo "ok")
if [[ $BACKEND_SSL == *"ok"* ]]; then
    echo -e "${GREEN}✅ Backend SSL válido${NC}"
else
    echo -e "${YELLOW}⚠️  Backend SSL pode ter problemas${NC}"
fi

# Frontend SSL
FRONTEND_SSL=$(curl -vI "$FRONTEND_URL" 2>&1 | grep -i "ssl certificate verify" || echo "ok")
if [[ $FRONTEND_SSL == *"ok"* ]]; then
    echo -e "${GREEN}✅ Frontend SSL válido${NC}"
else
    echo -e "${YELLOW}⚠️  Frontend SSL pode ter problemas${NC}"
fi

# ============================================
# SUMMARY
# ============================================

echo ""
echo -e "${GREEN}=================================${NC}"
echo -e "${GREEN}CHECAGEM CONCLUÍDA!${NC}"
echo -e "${GREEN}=================================${NC}"
echo ""
echo "📊 URLs:"
echo "  Backend:  $BACKEND_URL"
echo "  Frontend: $FRONTEND_URL"
echo ""
echo "🔍 Próximos passos:"
echo "  1. Testar login no frontend"
echo "  2. Fazer upload de um gráfico"
echo "  3. Verificar se análise é gerada"
echo "  4. Checar logs do worker"
echo ""
echo "📝 Logs:"
echo "  Railway: railway logs --service backend"
echo "           railway logs --service worker"
echo "  Vercel:  vercel logs $FRONTEND_URL"

