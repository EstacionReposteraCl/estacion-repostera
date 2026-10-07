# Revisión de `prisma.config.ts`, Better Auth y seed — NADA de esto está verificado

Ninguno de estos archivos se pudo ejecutar (npm bloqueado). Esta es una revisión **por lectura**; no afirma que funcionen.

## prisma.config.ts (PENDIENTE de ejecutar)
- Diseño: schema en `prisma/schema.prisma`, migraciones en `prisma/migrations`, seed `tsx prisma/seed.ts`, `datasource.url = env("DIRECT_URL")` (propietario, solo migraciones).
- A confirmar con Prisma 7: imports (`prisma/config`), forma de `datasource`, base sombra, lectura de `.env` (`dotenv`), que el seed use `tsx` (agregar a devDependencies al instalar).
- Riesgo conocido: sin `DIRECT_URL` definida, `prisma validate` puede fallar por la variable y no por el schema; usar una URL local ficticia al validar.

## Better Auth (`src/core/auth/*`) (PENDIENTE de instalar y probar)
Escrito de memoria; API sin verificar. Puntos de riesgo, en orden:
1. **Rol como enum:** el plugin `admin` maneja `role` como texto; la columna es enum `Role` (`ADMINISTRADOR`/`VENDEDOR`). Probar crear usuario, `setRole` y lectura.
2. **Esquema generado vs. núcleo del schema:** correr el CLI de Better Auth y *comparar* con el bloque del schema (no sobrescribir). Campos extra: `mustChangePassword`, `lastLoginAt`.
3. **Sin registro público:** `disableSignUp: true`; el seed usa `signUpEmail` por API de servidor — puede estar bloqueado por esa opción; alternativa a evaluar: crear la cuenta con el plugin admin o un script que use la API interna.
4. **`createUser/banUser/setRole` del plugin admin** exigen sesión de administrador (`headers`); `auth-admin.ts` las pasa. Revisar permisos reales.
5. **Desactivación:** debe revocar sesiones y rechazar login (`banned`). Probar.
6. **Rate limit en base de datos** (`rate_limits`) y regla `/sign-in/email`: confirmar nombres y que la tabla encaje con el modelo `RateLimit`.
7. **Impersonación:** mantener deshabilitada.
8. **Autorización:** el rol efectivo se relee de la BD en cada petición (`getActor`); no confiar en cookies/caché de sesión para el rol.
9. **Hook `lastLoginAt`:** nombre y forma de `databaseHooks` sin confirmar.

## Seed (`prisma/seed.ts`) (PENDIENTE de ejecutar)
- Verificado hoy (tests/unit/seed-data.test.ts): datos base (sucursal, IVA 19, unidades UN/G/KG/ML/L, canales, medios de pago, reglas de comisión en 0 y `UNDEFINED`) y el **plan puro** de saldos iniciales (`seed-plan.ts`) por el mismo planificador de inventario.
- Sin verificar: todas las llamadas a Prisma (upsert por claves compuestas `branchId_type`, `productId_name`; creación de StockLevel/ProductCost/StockMovement), idempotencia real (ejecutar dos veces) y creación del administrador.
- No inventa comisiones. No corre en producción. Contraseñas solo por variables de entorno.
