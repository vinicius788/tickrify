#!/usr/bin/env bash

set -euo pipefail

BACKEND_URL="${1:-${BACKEND_URL:-}}"
FRONTEND_URL="${2:-${FRONTEND_URL:-}}"
SMOKE_AUTH_TOKEN="${SMOKE_AUTH_TOKEN:-}"
VERCEL_PROTECTION_BYPASS="${VERCEL_PROTECTION_BYPASS:-}"

if [ -z "$BACKEND_URL" ]; then
  echo "Usage: bash scripts/smoke.sh <BACKEND_URL> [FRONTEND_URL]"
  echo "Example: bash scripts/smoke.sh https://api-staging.tickrify.com https://app-staging.tickrify.com"
  exit 1
fi

BACKEND_URL="${BACKEND_URL%/}"
if [ -n "$FRONTEND_URL" ]; then
  FRONTEND_URL="${FRONTEND_URL%/}"
fi

echo "[smoke] backend=${BACKEND_URL}"
if [ -n "$FRONTEND_URL" ]; then
  echo "[smoke] frontend=${FRONTEND_URL}"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

request() {
  local method="$1"
  local url="$2"
  local body_file="$3"
  shift 3
  curl -sS -o "$body_file" -w "%{http_code}" -X "$method" "$url" "$@"
}

assert_status_200() {
  local status="$1"
  local endpoint="$2"
  local body_file="$3"
  if [ "$status" != "200" ]; then
    echo "[smoke] FAIL ${endpoint} -> HTTP ${status}"
    echo "Body:"
    sed -n '1,120p' "$body_file"
    exit 1
  fi
}

HEALTH_PREFIX=""

detect_health_prefix() {
  local candidate_prefix
  local live_path
  local ready_path
  local live_body
  local ready_body
  local live_status
  local ready_status
  local diagnostics=()
  local idx=0

  for candidate_prefix in "/api" ""; do
    idx=$((idx + 1))
    live_path="${candidate_prefix}/health/live"
    ready_path="${candidate_prefix}/health/ready"
    live_body="${TMP_DIR}/live_${idx}.txt"
    ready_body="${TMP_DIR}/ready_${idx}.txt"

    live_status="$(request GET "${BACKEND_URL}${live_path}" "$live_body" -H "accept: application/json")"
    ready_status="$(request GET "${BACKEND_URL}${ready_path}" "$ready_body" -H "accept: application/json")"

    if [ "$live_status" = "200" ] && [ "$ready_status" = "200" ]; then
      HEALTH_PREFIX="$candidate_prefix"
      echo "[smoke] OK ${live_path}"
      echo "[smoke] OK ${ready_path}"
      echo "[smoke] Prefixo detectado: ${HEALTH_PREFIX:-/}"
      return 0
    fi

    diagnostics+=("${live_path} -> HTTP ${live_status} | $(head -n 1 "$live_body" || true)")
    diagnostics+=("${ready_path} -> HTTP ${ready_status} | $(head -n 1 "$ready_body" || true)")
  done

  echo "[smoke] FAIL não foi possível detectar endpoint de health"
  for entry in "${diagnostics[@]}"; do
    echo "[smoke] ${entry}"
  done
  echo "[smoke] Recomendação: URL base errada ou serviço errado; pegue a URL do serviço WEB (API) no Render."
  exit 1
}

detect_health_prefix

if [ -n "$SMOKE_AUTH_TOKEN" ]; then
  AUTH_BODY="${TMP_DIR}/auth_me.json"
  AUTH_STATUS="$(
    request GET "${BACKEND_URL}${HEALTH_PREFIX}/auth/me" "$AUTH_BODY" \
      -H "accept: application/json" \
      -H "authorization: Bearer ${SMOKE_AUTH_TOKEN}"
  )"
  assert_status_200 "$AUTH_STATUS" "${HEALTH_PREFIX}/auth/me" "$AUTH_BODY"
  echo "[smoke] OK ${HEALTH_PREFIX}/auth/me"
else
  echo "[smoke] SKIP ${HEALTH_PREFIX}/auth/me (set SMOKE_AUTH_TOKEN to enable)"
fi

if [ -n "$FRONTEND_URL" ]; then
  FRONT_BODY="${TMP_DIR}/frontend.txt"
  if [ -n "$VERCEL_PROTECTION_BYPASS" ]; then
    FRONT_STATUS="$(
      request GET "$FRONTEND_URL" "$FRONT_BODY" \
        -H "x-vercel-protection-bypass: ${VERCEL_PROTECTION_BYPASS}"
    )"
  else
    FRONT_STATUS="$(request GET "$FRONTEND_URL" "$FRONT_BODY")"
  fi

  if [ "$FRONT_STATUS" = "200" ]; then
    echo "[smoke] OK frontend reachable"
  else
    echo "[smoke] FAIL frontend -> HTTP ${FRONT_STATUS}"
    if [ "$FRONT_STATUS" = "401" ]; then
      echo "[smoke] Hint: Vercel deployment protection is active for this URL."
    fi
    sed -n '1,60p' "$FRONT_BODY"
    exit 1
  fi
fi

echo "[smoke] PASS"
