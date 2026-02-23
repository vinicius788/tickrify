#!/bin/sh
set -eu

cd /app/apps/backend

if [ -z "${DATABASE_URL:-}" ] && [ -n "${DIRECT_URL:-}" ]; then
  export DATABASE_URL="$DIRECT_URL"
fi

if [ -z "${DIRECT_URL:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  export DIRECT_URL="$DATABASE_URL"
fi

echo "[entrypoint] Generating Prisma client..."
npx prisma generate --schema=./prisma/schema.prisma

echo "[entrypoint] Running Prisma migrations..."
npm run migrate:deploy

echo "[entrypoint] Starting backend..."
if [ "$#" -eq 0 ]; then
  exec npm run start:prod
fi

exec "$@"
