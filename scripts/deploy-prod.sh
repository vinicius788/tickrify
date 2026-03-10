#!/usr/bin/env bash
# scripts/deploy-prod.sh
# Deploy completo de produção — Render (backend) + Vercel (frontend)
# Uso: bash scripts/deploy-prod.sh
set -euo pipefail

# ─────────────────────────────────────────────
# CORES
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
info() { echo -e "ℹ️  $1"; }

echo ""
echo "═══════════════════════════════════════════"
echo "  TICKRIFY — DEPLOY PRODUÇÃO"
echo "═══════════════════════════════════════════"
echo ""

# ─────────────────────────────────────────────
# COLETAR CREDENCIAIS (uma vez só)
echo "Cole as credenciais abaixo. Ctrl+C para cancelar."
echo ""

read -rp "🔑 Render API Key (dashboard.render.com → Account → API Keys): " RENDER_API_KEY
read -rp "🔑 Render Service ID (URL do serviço: dashboard.render.com/web/srv-XXXXXX): " RENDER_SERVICE_ID
read -rp "🔑 DATABASE_URL (pooler Supabase :6543, sslmode=require): " DATABASE_URL
read -rp "🔑 MIGRATIONS_DATABASE_URL (pooler session :5432 ou direct :5432): " MIGRATIONS_DATABASE_URL
read -rp "🔑 CLERK_SECRET_KEY: " CLERK_SECRET_KEY
read -rp "🔑 REDIS_URL: " REDIS_URL
read -rp "🔑 OPENAI_API_KEY: " OPENAI_API_KEY
read -rp "🔑 STRIPE_SECRET_KEY: " STRIPE_SECRET_KEY
read -rp "🔑 STRIPE_WEBHOOK_SECRET: " STRIPE_WEBHOOK_SECRET
read -rp "🌐 FRONTEND_URL (ex: https://tickrify.com): " FRONTEND_URL
read -rp "🌐 CORS_ORIGINS (mesmo valor do FRONTEND_URL): " CORS_ORIGINS

# Gerar token interno automaticamente
INTERNAL_OPS_TOKEN=$(openssl rand -hex 32)
ok "INTERNAL_OPS_TOKEN gerado: $INTERNAL_OPS_TOKEN"
echo "  (salve esse valor — você vai precisar para smoke test)"
echo ""

# ─────────────────────────────────────────────
# FUNÇÃO: setar env var no Render via API
render_set_env() {
  local KEY="$1"
  local VALUE="$2"
  curl -sf -X PUT \
    "https://api.render.com/v1/services/$RENDER_SERVICE_ID/env-vars" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    --data-raw "{\"envVars\":[{\"key\":\"$KEY\",\"value\":\"$VALUE\"}]}" \
    > /dev/null \
    && ok "Render env: $KEY" \
    || fail "Falhou ao setar $KEY no Render"
}

# ─────────────────────────────────────────────
# CONFIGURAR ENVS NO RENDER
echo "Configurando variáveis de ambiente no Render..."
echo ""

render_set_env "APP_ENV"                   "production"
render_set_env "NODE_ENV"                  "production"
render_set_env "DATABASE_URL"              "$DATABASE_URL"
render_set_env "MIGRATIONS_DATABASE_URL"   "$MIGRATIONS_DATABASE_URL"
render_set_env "CLERK_SECRET_KEY"          "$CLERK_SECRET_KEY"
render_set_env "REDIS_URL"                 "$REDIS_URL"
render_set_env "OPENAI_API_KEY"            "$OPENAI_API_KEY"
render_set_env "STRIPE_SECRET_KEY"         "$STRIPE_SECRET_KEY"
render_set_env "STRIPE_WEBHOOK_SECRET"     "$STRIPE_WEBHOOK_SECRET"
render_set_env "FRONTEND_URL"              "$FRONTEND_URL"
render_set_env "CORS_ORIGINS"              "$CORS_ORIGINS"
render_set_env "INTERNAL_OPS_TOKEN"        "$INTERNAL_OPS_TOKEN"

echo ""
ok "Todas as variáveis configuradas no Render"

# ─────────────────────────────────────────────
# TRIGGERAR DEPLOY NO RENDER (clear cache)
echo ""
info "Triggerando deploy no Render (clear cache)..."

DEPLOY_RESPONSE=$(curl -sf -X POST \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  --data-raw '{"clearCache":"clear"}')

DEPLOY_ID=$(echo "$DEPLOY_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
ok "Deploy iniciado — ID: $DEPLOY_ID"

# ─────────────────────────────────────────────
# AGUARDAR DEPLOY FICAR LIVE (polling até 10 min)
echo ""
info "Aguardando deploy ficar live (max 10 min)..."

RENDER_URL=""
for i in $(seq 1 60); do
  sleep 10
  STATUS_RESP=$(curl -sf \
    "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys/$DEPLOY_ID" \
    -H "Authorization: Bearer $RENDER_API_KEY" 2>/dev/null || echo '{"status":"unknown"}')

  DEPLOY_STATUS=$(echo "$STATUS_RESP" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "  [${i}/${60}] Status: $DEPLOY_STATUS"

  if [ "$DEPLOY_STATUS" = "live" ]; then
    ok "Deploy live!"
    break
  elif [ "$DEPLOY_STATUS" = "failed" ]; then
    fail "Deploy falhou. Verifique os logs em dashboard.render.com"
  fi
done

# Obter URL do serviço
SERVICE_RESP=$(curl -sf \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID" \
  -H "Authorization: Bearer $RENDER_API_KEY")
RENDER_URL=$(echo "$SERVICE_RESP" | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$RENDER_URL" ]; then
  warn "Não foi possível obter URL do serviço automaticamente."
  read -rp "Cole a URL do backend Render manualmente (ex: https://xxx.onrender.com): " RENDER_URL
fi

ok "Backend URL: $RENDER_URL"

# ─────────────────────────────────────────────
# CONFIGURAR VERCEL (frontend)
echo ""
info "Configurando Vercel..."

if command -v vercel &>/dev/null; then
  read -rp "🔑 VITE_CLERK_PUBLISHABLE_KEY: " VITE_CLERK_PUBLISHABLE_KEY

  echo "$RENDER_URL" | vercel env add VITE_API_URL production --force 2>/dev/null \
    && ok "Vercel: VITE_API_URL" || warn "Falhou VITE_API_URL — configure manualmente"

  echo "$VITE_CLERK_PUBLISHABLE_KEY" | vercel env add VITE_CLERK_PUBLISHABLE_KEY production --force 2>/dev/null \
    && ok "Vercel: VITE_CLERK_PUBLISHABLE_KEY" || warn "Falhou VITE_CLERK_PUBLISHABLE_KEY — configure manualmente"

  info "Triggerando redeploy Vercel..."
  vercel --prod --yes 2>/dev/null && ok "Vercel redeploy iniciado" || warn "Redeploy Vercel manual necessário"
else
  warn "Vercel CLI não encontrada. Configure manualmente:"
  echo "  VITE_API_URL = $RENDER_URL"
  echo "  VITE_CLERK_PUBLISHABLE_KEY = [sua chave]"
fi

# ─────────────────────────────────────────────
# SMOKE TESTS FINAIS
echo ""
echo "═══════════════════════════════════════════"
echo "  SMOKE TESTS"
echo "═══════════════════════════════════════════"
echo ""

sleep 5 # dar tempo para o serviço estabilizar

run_test() {
  local NAME="$1"
  local EXPECTED="$2"
  local ACTUAL="$3"
  if [ "$ACTUAL" = "$EXPECTED" ]; then
    ok "PASS: $NAME (→ $ACTUAL)"
  else
    echo -e "${RED}❌ FAIL: $NAME (esperado $EXPECTED, got $ACTUAL)${NC}"
    FAILED=1
  fi
}

FAILED=0

# Test 1 — liveness
BODY=$(curl -sf "$RENDER_URL/api/health/live" 2>/dev/null || echo "")
echo "$BODY" | grep -q '"status":"ok"' \
  && ok "PASS: /health/live → 200 {status:ok}" \
  || { echo -e "${RED}❌ FAIL: /health/live — body: $BODY${NC}"; FAILED=1; }

# Test 2 — ready sem token → 403
run_test "/health/ready sem token → 403" "403" \
  "$(curl -s -o /dev/null -w "%{http_code}" "$RENDER_URL/api/health/ready")"

# Test 3 — ready com token → 200
run_test "/health/ready com token → 200" "200" \
  "$(curl -s -o /dev/null -w "%{http_code}" -H "x-ops-token: $INTERNAL_OPS_TOKEN" "$RENDER_URL/api/health/ready")"

# Test 4 — auth sem token → 401
run_test "/auth/me sem token → 401" "401" \
  "$(curl -s -o /dev/null -w "%{http_code}" "$RENDER_URL/api/auth/me")"

# Test 5 — token forjado → 401
FORGED="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmb3JnZWQiLCJpYXQiOjE3MDB9.invalidsig"
run_test "token forjado → 401" "401" \
  "$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $FORGED" "$RENDER_URL/api/auth/me")"

# Test 6 — helmet headers
curl -sI "$RENDER_URL/api/health/live" | grep -qi "x-frame-options" \
  && ok "PASS: X-Frame-Options presente" || { echo -e "${RED}❌ FAIL: X-Frame-Options ausente${NC}"; FAILED=1; }

curl -sI "$RENDER_URL/api/health/live" | grep -qi "x-content-type-options" \
  && ok "PASS: X-Content-Type-Options presente" || { echo -e "${RED}❌ FAIL: X-Content-Type-Options ausente${NC}"; FAILED=1; }

# ─────────────────────────────────────────────
# RESULTADO FINAL
echo ""
echo "═══════════════════════════════════════════"
if [ "$FAILED" = "0" ]; then
  echo -e "${GREEN}  STATUS: GO ✅  — PRODUÇÃO OK${NC}"
  echo ""
  echo "  Backend: $RENDER_URL"
  echo "  INTERNAL_OPS_TOKEN: $INTERNAL_OPS_TOKEN"
  echo "  (salve o token acima em local seguro)"
else
  echo -e "${RED}  STATUS: NO-GO ❌  — VER FALHAS ACIMA${NC}"
fi
echo "═══════════════════════════════════════════"
