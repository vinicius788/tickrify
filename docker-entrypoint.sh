#!/bin/sh
set -e

# 1. Start API first so Render detects an open port quickly.
echo "[entrypoint] Starting API..."
"$@" &
API_PID=$!

# 2. Run migrations in background (don't block API startup).
if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] Running migrations in background..."
  npm run migrate:deploy -w apps/backend &
  MIGRATE_PID=$!
  wait "$MIGRATE_PID" && echo "[entrypoint] Migrations done." \
    || echo "[entrypoint] WARNING: migrations failed, app already running"
else
  echo "[entrypoint] Skipping migrations (RUN_MIGRATIONS_ON_START=false)"
fi

# 3. Start worker in background after migrations.
if [ "${RUN_EMBEDDED_WORKER:-true}" = "true" ]; then
  echo "[entrypoint] Starting embedded worker..."
  npm run worker:prod -w apps/backend &
else
  echo "[entrypoint] Skipping embedded worker (RUN_EMBEDDED_WORKER=false)"
fi

# Keep process alive while API process is alive.
wait "$API_PID"
