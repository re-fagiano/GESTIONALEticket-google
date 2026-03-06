#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL rilevato: eseguo prisma migrate deploy..."
  pnpm prisma:deploy
else
  echo "DATABASE_URL non impostato: salto prisma migrate deploy durante la build."
fi

pnpm build
