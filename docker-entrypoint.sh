#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] Running migrations..."
  npm run migrate:deploy -w apps/backend
else
  echo "[entrypoint] Skipping migrations (RUN_MIGRATIONS_ON_START=false)"
fi

echo "[entrypoint] Starting API..."
exec "$@"
