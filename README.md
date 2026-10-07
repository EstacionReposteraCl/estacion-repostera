# Estación Repostera — v0.1.0, primera versión funcional

Congelados y sin cambios: `prisma/schema.prisma` v0.5 y `docs/reglas-y-pruebas.md` (verificado con `cmp`).
Next.js 16 + Prisma 7 + Better Auth + PostgreSQL 16. Se puede iniciar sesión en el navegador (http://localhost:3000).

> Windows: ver docs/GUIA-WINDOWS.md · Resultados reales de esta versión: docs/RESULTADOS-v0.1.md

## Estado real
| Pieza | Estado |
|---|---|
| `prisma validate`, `generate`, migración real (`prisma/migrations/…_init`, con reglas SQL anexadas) | ✔ ejecutado; `migrate diff` sin diferencias |
| 63 reglas SQL sobre la **migración real** | ✔ **63/63** |
| 110 pruebas de aplicación · type-check completo · check:schema | ✔ |
| Better Auth: login, sin registro público, desactivación, límite de intentos, roles enum | ✔ probado en navegador y HTTP |
| Seed (admin + vendedor de prueba, idempotente) | ✔ |
| UI: `/login`, `/cambiar-clave`, `/` por rol | ✔ |
| Repositorios Prisma y pantallas de módulos | ✖ PENDIENTE |

## Comandos
```bash
npm ci                     # instala versiones fijadas
npm run setup              # prisma generate + prisma migrate deploy
npm run db:seed            # usuarios y datos base (idempotente)
npm run dev                # http://localhost:3000   (Ctrl+C para detener)
npm run build && npm start # modo producción local
npm run test:unit · npm run typecheck · npm run check:schema
PSQL_CMD="psql -d estacion_repostera_dev -v ON_ERROR_STOP=1 -q -f -" npm run test:sql-rules   # 63 reglas (antes del seed)
```

## Estructura
```
prisma/          schema.prisma (congelado) · sql/10_roles.sql, 20_reglas.sql · seed-data.ts, seed-plan.ts (puros, probados) · seed.ts (sin verificar)
src/core/        money · errors · permissions · logger · time (probados) · auth · db (sin verificar)
src/domain/      inventory · sales · purchases · charges (planificadores puros)
src/services/    sales · purchases · inventory · products · reports · users  + composition.ts (cableado de puertos, sin Prisma)
src/policies/    sale.policy · user.policy
src/dto/         sensitive (guardia) · sales.dto · product.dto · sale-admin.dto
src/repositories/ports.ts (todos los contratos)  ·  prisma/ (PENDIENTE; index.ts lanza "PENDIENTE")
src/server/      container.ts (raíz de composición; lanza hasta que existan los repositorios Prisma)
src/actions/     plantilla de server action (sin verificar) · src/app/ vacío a propósito
tests/unit/      110 pruebas · tests/helpers/ (FakeDb, world) · tests/integration/sql/ (run.py, derived-ddl.sql)
docs/            REVISION-SCHEMA · REVISION-CONFIG · DECISIONES · OPERACIONES · SEGURIDAD · MAPA-PRUEBAS · COMANDOS
```
Siguiente paso real: `docs/COMANDOS.md`. Decisiones abiertas: `docs/DECISIONES.md`.
