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
OPS_TOKEN="${OPS_TOKEN:-${INTERNAL_OPS_TOKEN:-}}"

HEALTH_JSON=""
READY_HTTP_CODE="SKIPPED"
FAILURES=0

if [ -n "$OPS_TOKEN" ]; then
  HEALTH_JSON=$(curl -s -H "x-ops-token: $OPS_TOKEN" "$BACKEND_URL/api/health" || echo "")
  READY_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-ops-token: $OPS_TOKEN" "$BACKEND_URL/api/health/ready")
else
  echo -e "${YELLOW}⚠️  OPS_TOKEN não definido. Checks de /api/health e /api/health/ready serão pulados.${NC}"
fi

read_health_field() {
  local path=$1
  printf '%s' "$HEALTH_JSON" | node -e "
const fs = require('fs');
const path = process.argv[1];
const input = fs.readFileSync(0, 'utf8');
try {
  const payload = JSON.parse(input || '{}');
  const parts = String(path || '').split('.').filter(Boolean);
  let value = payload;
  for (const part of parts) {
    if (value && Object.prototype.hasOwnProperty.call(value, part)) {
      value = value[part];
    } else {
      value = '';
      break;
    }
  }
  if (value === null || value === undefined) {
    process.stdout.write('');
  } else if (typeof value === 'object') {
    process.stdout.write(JSON.stringify(value));
  } else {
    process.stdout.write(String(value));
  }
} catch {
  process.stdout.write('');
}
" "$path"
}

# ============================================
# CHECK 1: Backend Health
# ============================================

echo -e "${BLUE}[1/6] Verificando Backend Health...${NC}"
LIVE_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health/live")
HTTP_CODE=$LIVE_CODE

if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}✅ Backend /health/live está online (HTTP $HTTP_CODE)${NC}"
    if [ -n "$OPS_TOKEN" ]; then
        if [ "$READY_HTTP_CODE" -eq 200 ]; then
            echo -e "${GREEN}✅ Backend /health/ready está online (HTTP $READY_HTTP_CODE)${NC}"
        else
            echo -e "${YELLOW}⚠️  Backend /health/ready não está OK (HTTP $READY_HTTP_CODE)${NC}"
            FAILURES=$((FAILURES + 1))
        fi
    else
        echo -e "${YELLOW}⚠️  /health/ready não validado sem OPS_TOKEN${NC}"
    fi
else
    echo -e "${RED}❌ Backend /health/live não está respondendo (HTTP $HTTP_CODE)${NC}"
    FAILURES=$((FAILURES + 1))
fi

# ============================================
# CHECK 2: Database Connection
# ============================================

echo ""
echo -e "${BLUE}[2/6] Verificando Database Connection...${NC}"
if [ -z "$OPS_TOKEN" ]; then
    echo -e "${YELLOW}⚠️  Check de banco pulado sem OPS_TOKEN${NC}"
else
    DB_STATUS=$(read_health_field "database")

    if [[ "$DB_STATUS" == "ok" ]]; then
        echo -e "${GREEN}✅ Database conectado${NC}"
    else
        echo -e "${RED}❌ Database não conectado (status: ${DB_STATUS:-desconhecido})${NC}"
        FAILURES=$((FAILURES + 1))
    fi
fi

# ============================================
# CHECK 3: Queue/Worker Connection
# ============================================

echo ""
echo -e "${BLUE}[3/6] Verificando Queue/Worker...${NC}"
if [ -z "$OPS_TOKEN" ]; then
    echo -e "${YELLOW}⚠️  Check de queue/worker pulado sem OPS_TOKEN${NC}"
else
    QUEUE_CONNECTED=$(read_health_field "queue.connected")
    QUEUE_WORKERS=$(read_health_field "queue.workersCount")
    QUEUE_REASON=$(read_health_field "queue.reason")
    QUEUE_READY=$(read_health_field "queue.ready")

    if [[ "$QUEUE_CONNECTED" == "true" ]]; then
        echo -e "${GREEN}✅ Queue conectada (workers=${QUEUE_WORKERS:-0}, ready=${QUEUE_READY:-false})${NC}"
    else
        echo -e "${YELLOW}⚠️  Queue nao conectada (reason=${QUEUE_REASON:-unknown})${NC}"
        FAILURES=$((FAILURES + 1))
    fi
fi

# ============================================
# CHECK 4: Dependencias criticas de runtime
# ============================================

echo ""
echo -e "${BLUE}[4/6] Verificando auth/storage/AI (runtime)...${NC}"
if [ -z "$OPS_TOKEN" ]; then
    echo -e "${YELLOW}⚠️  Check de dependências críticas pulado sem OPS_TOKEN${NC}"
else
    AUTH_READY=$(read_health_field "auth.ready")
    STORAGE_READY=$(read_health_field "storage.ready")
    AI_READY=$(read_health_field "ai.ready")

    if [[ "$AUTH_READY" == "true" && "$STORAGE_READY" == "true" && "$AI_READY" == "true" ]]; then
        echo -e "${GREEN}✅ Dependencias criticas prontas${NC}"
    else
        echo -e "${YELLOW}⚠️  Dependencias incompletas (auth=${AUTH_READY:-?}, storage=${STORAGE_READY:-?}, ai=${AI_READY:-?})${NC}"
        FAILURES=$((FAILURES + 1))
    fi
fi

# ============================================
# CHECK 5: Frontend Accessibility
# ============================================

echo ""
echo -e "${BLUE}[5/6] Verificando Frontend...${NC}"
FRONTEND_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL")

if [ "$FRONTEND_CODE" -eq 200 ]; then
    echo -e "${GREEN}✅ Frontend está online (HTTP $FRONTEND_CODE)${NC}"
else
    echo -e "${RED}❌ Frontend não está respondendo (HTTP $FRONTEND_CODE)${NC}"
    FAILURES=$((FAILURES + 1))
fi

# ============================================
# CHECK 6: API Connectivity from Frontend
# ============================================

echo ""
echo -e "${BLUE}[6/6] Verificando conectividade Frontend → Backend...${NC}"
if [ -n "$OPS_TOKEN" ]; then
    API_CHECK=$(curl -s "$BACKEND_URL/api/health" \
      -H "x-ops-token: $OPS_TOKEN" \
      -H "Origin: $FRONTEND_URL" \
      -v 2>&1 | grep -i "access-control-allow-origin")
else
    API_CHECK=$(curl -s "$BACKEND_URL/api/health/live" \
      -H "Origin: $FRONTEND_URL" \
      -v 2>&1 | grep -i "access-control-allow-origin")
fi

if [ ! -z "$API_CHECK" ]; then
    echo -e "${GREEN}✅ CORS configurado corretamente${NC}"
else
    echo -e "${YELLOW}⚠️  CORS pode não estar configurado corretamente${NC}"
    FAILURES=$((FAILURES + 1))
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

echo ""
echo "🧪 Smoke API:"
if command -v node >/dev/null 2>&1; then
    if OPS_TOKEN="$OPS_TOKEN" node scripts/smoke-api.mjs "$BACKEND_URL"; then
        echo -e "${GREEN}✅ smoke-api passou${NC}"
    else
        echo -e "${YELLOW}⚠️  smoke-api falhou (ver mensagem acima)${NC}"
        FAILURES=$((FAILURES + 1))
    fi
else
    echo -e "${YELLOW}⚠️  Node não encontrado para executar scripts/smoke-api.mjs${NC}"
    FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -gt 0 ]; then
    echo ""
    echo -e "${RED}❌ Checagem finalizou com ${FAILURES} falha(s) crítica(s).${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Checagem finalizou sem falhas críticas.${NC}"
