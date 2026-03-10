#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] Running migrations..."
  npm run migrate:deploy -w apps/backend
else
  echo "[entrypoint] Skipping migrations (RUN_MIGRATIONS_ON_START=false)"
fi

WORKER_PID=""
if [ "${RUN_EMBEDDED_WORKER:-true}" = "true" ]; then
  echo "[entrypoint] Starting embedded worker..."
  npm run worker:prod -w apps/backend &
  WORKER_PID=$!
else
  echo "[entrypoint] Skipping embedded worker (RUN_EMBEDDED_WORKER=false)"
fi

echo "[entrypoint] Starting API..."
"$@" &
API_PID=$!

wait "$API_PID"
API_EXIT_CODE=$?

if [ -n "$WORKER_PID" ]; then
  kill "$WORKER_PID" 2>/dev/null || true
fi

exit "$API_EXIT_CODE"
