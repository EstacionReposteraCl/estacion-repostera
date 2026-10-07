#!/usr/bin/env bash
# Base de PRUEBAS de integración (local): migración real + datos base del seed (sin usuarios). Se recrea desde cero.
# Uso: PGPASSWORD=... scripts/setup-it-db.sh   (requiere PostgreSQL local y el rol app_user con contraseña, ver docs/COMANDOS.md)
set -euo pipefail
DB=${IT_DB:-estacion_repostera_it}; OWNER=${IT_OWNER_URL:-postgresql://postgres:${PGPASSWORD}@localhost:5432}; APP=${IT_APP_URL:-postgresql://app_user:AppDev2026@localhost:5432}
psql "$OWNER/postgres" -qc "DROP DATABASE IF EXISTS $DB" -qc "CREATE DATABASE $DB TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'"
DIRECT_URL="$OWNER/$DB" npx prisma migrate deploy >/dev/null
DATABASE_URL="$APP/$DB" DIRECT_URL="$OWNER/$DB" SEED_ADMIN_EMAIL= SEED_SELLER_EMAIL= npx tsx prisma/seed.ts
echo "Base de integración lista: $DB"
