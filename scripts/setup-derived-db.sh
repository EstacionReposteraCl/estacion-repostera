#!/usr/bin/env bash
# Crea la base `rules_derived` (DDL DERIVADO + roles + reglas) para ensayar las 63 reglas SIN Prisma. Requiere PostgreSQL local y python3.
# ⚠ No es la migración de Prisma. Uso: scripts/setup-derived-db.sh [db] ; PSQL="sudo -u postgres psql" por defecto "psql".
set -euo pipefail
DB="${1:-rules_derived}"; PSQL="${PSQL:-psql}"; cd "$(dirname "$0")/.."
python3 scripts/gen-derived-ddl.py prisma/schema.prisma > tests/integration/sql/derived-ddl.sql
$PSQL -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
for f in tests/integration/sql/derived-ddl.sql prisma/sql/10_roles.sql prisma/sql/20_reglas.sql; do $PSQL -d "$DB" -v ON_ERROR_STOP=1 -q -f - < "$f"; done
echo "OK: base $DB lista. Ejecutar: PSQL_CMD=\"$PSQL -d $DB -v ON_ERROR_STOP=1 -q -f -\" python3 tests/integration/sql/run.py"
