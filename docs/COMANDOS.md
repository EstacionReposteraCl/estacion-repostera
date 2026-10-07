# Checklist exacto cuando npm vuelva a estar disponible

**Regla:** cada paso se ejecuta de verdad y se registra su salida. Un paso que falle se detiene y se informa; no se "arregla" el diseño en silencio. Schema v0.5 y reglas siguen congelados salvo error real (en ese caso: detenerse y mostrarlo).

## 0. Precondiciones
```bash
node -v            # >= 22
npm -v && npm ping # debe responder; si no, NO continuar
psql --version     # PostgreSQL 16 local
sudo -u postgres createdb estacion_repostera_dev   # (o equivalente)
```

## 1. Next.js + TypeScript (en carpeta temporal, luego se fusiona; este esqueleto ya tiene src/, tests/, prisma/)
```bash
npx create-next-app@latest _next-tmp --ts --app --src-dir --eslint --import-alias "@/*" --use-npm --no-turbopack
# mover a la raíz: package.json, package-lock.json, next.config.*, tsconfig.json, eslint config, public/, src/app/{layout,page,globals.css}
# fusionar scripts de package.json (test:unit, typecheck:core, check:schema) y en tsconfig.json agregar:
#   "allowImportingTsExtensions": true   (el núcleo importa con ".ts")
rm -rf _next-tmp
```

## 2. Dependencias (anotar las versiones instaladas)
```bash
npm i prisma @prisma/client @prisma/adapter-pg pg dotenv better-auth zod
npm i -D tsx @types/pg
npx prisma --version
```

## 3. Prisma
```bash
cp .env.example .env   # completar DATABASE_URL, DIRECT_URL, BETTER_AUTH_SECRET (local)
npx prisma validate    # RESULTADO OBLIGATORIO A MOSTRAR
npx prisma generate    # -> src/generated/prisma
```
Si `prisma.config.ts` falla (API distinta en la versión instalada): corregir **solo ese archivo**.

## 4. Migración real (con las reglas SQL dentro)
```bash
npx prisma migrate dev --create-only --name init
# Anexar al FINAL de prisma/migrations/<ts>_init/migration.sql, en este orden:
cat prisma/sql/10_roles.sql prisma/sql/20_reglas.sql >> prisma/migrations/*_init/migration.sql
npx prisma migrate dev            # aplica; la base sombra repite todo
npx prisma migrate status
psql "$DIRECT_URL" -c "\dt" -c "\df check_*" -c "\dy"  # tablas, funciones y triggers presentes
psql "$DIRECT_URL" -c "ALTER ROLE app_user LOGIN PASSWORD '...'"
```
Verificar: nombres de constraint ≤ 63 (`python3 scripts/check-schema.py` ya los calculó; comparar con `\d`), triggers creados, GRANT/REVOKE efectivos.

## 4b. Comprobar que la migración real no difiere del schema
```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code   # sintaxis a confirmar con la versión instalada
```

## 5. Pruebas SQL sobre la base REAL (no sobre el DDL derivado)
Los fixtures ya están portados (filas completas) en `tests/integration/sql/run.py`; contra la migración real solo cambia la base:
```bash
PSQL_CMD="psql -d estacion_repostera_dev -v ON_ERROR_STOP=1 -q -f -" npm run test:sql-rules     # debe dar 63/63
```
- Si alguna falla por una columna/clave que el DDL derivado no imitaba, se ajusta el *fixture* (no el schema) y se informa.
- Las pruebas 44–50 usan `SET LOCAL ROLE app_user` (el rol debe existir: `10_roles.sql`).
- Hasta que dé 63/63 sobre la migración real, **no cuentan como aprobadas** (hoy: 63/63 solo sobre DDL derivado).

## 6. Better Auth
```bash
npx @better-auth/cli generate   # compara con el bloque de autenticación de schema.prisma; NO sobrescribir
```
Probar: login, usuario desactivado, rol ADMINISTRADOR/VENDEDOR guardado en la columna enum, rate limit, sin registro público.

## 7. Seed
```bash
npx prisma db seed                         # base (idempotente: ejecutar dos veces)
SEED_DEMO=1 npx prisma db seed             # demo opcional
```
Mostrar conteos por tabla.

## 8. Pruebas de aplicación
```bash
npm run test:unit        # 110 pruebas; requiere Node >= 22.18 (o 22.6+ con el flag que ya lleva el script)
npm run typecheck:core   # usa el TypeScript y @types/node de devDependencies (npm i); ya no depende de herramientas globales
npx tsc --noEmit         # proyecto completo (incluye archivos que hoy no se pudieron verificar)
npm run build
```
Implementar `src/repositories/prisma/*` y correr el MISMO conjunto de `tests/unit/sales-service.test.ts` contra ellos + concurrencia real (dos conexiones, prueba E).

## 9. DETENERSE y mostrar
estructura de carpetas · package.json · prisma.config.ts · schema.prisma · migraciones · resultado de `prisma validate` · resultado de pruebas (SQL sobre migración real + app) · resultado del seed. No construir pantallas.
