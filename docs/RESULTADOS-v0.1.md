# Resultados reales — primera versión funcional (v0.1.0, 2026-10-07)

Entorno: Linux x64 · Node 22.22.0 · npm 10.9.4 · PostgreSQL 16.15 · Python 3.13. `npm view prisma version` respondió (sin 403).

## Versiones instaladas
next 16.4.0 · react/react-dom 19.3.0 · prisma / @prisma/client / @prisma/adapter-pg 7.10.0 · better-auth 1.7.7 · pg 8.23.1 · dotenv 18.0.6 · zod 3.25.76 · tsx 4.23.15 · typescript 5.9.3 · @types/node 22.20.5.
(Prisma `latest` en npm es 8.0.0-rc.20, una versión candidata; se usó `prisma@7` como pedía la guía.)

## Pasos y salida
| Paso | Resultado |
|---|---|
| `npx prisma validate` | `The schema at prisma/schema.prisma is valid` — `prisma.config.ts` funcionó **sin cambios** |
| `npx prisma generate` | `Generated Prisma Client (7.10.0) to ./src/generated/prisma` |
| `migrate dev --create-only` + anexar 10_roles.sql y 20_reglas.sql + `migrate dev` | aplicada `20261007010534_init` (base sombra incluida); 34 tablas, 14 triggers |
| `migrate diff --from-config-datasource --to-schema … --exit-code` | `No difference detected.` (exit 0) |
| **63 pruebas SQL sobre la migración real** | **63/63 correctas** (antes del seed). Repetido sobre una base recreada desde cero con `migrate deploy`: 63/63 |
| `npm run test:unit` | 110 / 110 pass |
| `npm run typecheck:core` · `npx tsc --noEmit` (proyecto completo) | 0 errores |
| `npm run check:schema` | 0 avisos, 0 errores |
| `npx prisma db seed` (dos veces) + `SEED_DEMO=1` | usuarios creados la 1.ª vez, "ya existe" la 2.ª. Conteos: users 2, accounts 2, branches 1, units 5, sale_channels 5, payment_methods 5, fee_rules 5, products 3 (demo), stock_movements 2 (demo) |
| `npm run build` | compila; rutas `/`, `/login`, `/cambiar-clave`, `/api/auth/[...all]` |
| Navegador (Chromium, `npm start`) | 12/12 comprobaciones: redirección sin sesión, clave incorrecta, cambio obligatorio de clave, no se puede saltar, vendedor ve solo Ventas y Productos, rol desde la columna enum, cerrar sesión, ingreso con clave nueva, admin ve 6 módulos |
| Registro público `POST /api/auth/sign-up/email` | 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` |
| Usuario desactivado (`banned=true`) | 403 `BANNED_USER` |
| Límite de intentos | 5 × 401 y el 6.º → 429; fila en `rate_limits` (`127.0.0.1|/sign-in/email`) |
| `lastLoginAt` (hook de sesión) | se registra al ingresar |

Archivos congelados verificados con `cmp` contra el ZIP recibido: `prisma/schema.prisma`, `docs/reglas-y-pruebas.md`, `prisma/sql/10_roles.sql`, `prisma/sql/20_reglas.sql` — idénticos.

## Cambios necesarios (fuera de los congelados)
1. `src/core/auth/auth.ts`: el plugin admin rechazó `adminRoles: ["ADMINISTRADOR"]` (`Invalid admin roles`) porque exige definir los roles. Se definieron `ADMINISTRADOR` y `VENDEDOR` con `createAccessControl`; ADMINISTRADOR **sin** permiso `impersonate` (impersonación deshabilitada).
2. `prisma/seed.ts`: `signUpEmail` queda bloqueado por `disableSignUp`; se usa `auth.api.createUser` llamado desde el servidor (sin headers no exige sesión). Se agregó un VENDEDOR de prueba opcional (`SEED_SELLER_EMAIL` / `SEED_SELLER_PASSWORD`).
3. Next.js 16 fusionado (package.json, tsconfig.json con `allowImportingTsExtensions`, next.config.ts con `cacheComponents` desactivado, eslint). Nuevas pantallas: `/login`, `/cambiar-clave`, `/` (inicio por rol) y `src/lib/session.ts` (rol y estado releídos de la BD en cada petición).

## Pendiente (no cambia el alcance de esta versión)
- Repositorios Prisma (`src/repositories/prisma`) y pantallas de cada módulo: `src/server/container.ts` sigue lanzando "PENDIENTE".
- `npm run lint`: 7 errores `no-explicit-any` en pruebas preexistentes (`tests/unit`); el código nuevo no tiene errores.
- Límite de intentos por IP: si varios vendedores ingresan desde la misma red, comparten los 5 intentos/minuto.
