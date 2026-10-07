# Revisión de seguridad: VENDEDOR vs ADMINISTRADOR

Estado: lo marcado ✔ **está probado hoy** con pruebas unitarias/en memoria; lo marcado ◻ requiere la integración real (BD, Better Auth, Next).

## Capas (todas deben cumplirse; ninguna es opcional)
1. **Página/ruta/acción**: `getActor()` + `assertCan(permiso)` en cada una (no solo middleware). ◻ (Next)
2. **Servicio**: `assertCan` al inicio de cada método. ✔ (todos los servicios; un test estático lo exige y verifica que el permiso exista)
3. **Repositorio/política**: filtro de alcance obligatorio (`saleScopeFor`). ✔ política; ◻ en consultas Prisma
4. **Base de datos**: CHECK/triggers; `REVOKE UPDATE/DELETE` a `app_user` en tablas de solo agregar. ◻ (requiere migración real y conexión como `app_user`)

## Matriz
| Capacidad | VENDEDOR | ADMINISTRADOR | Probado |
|---|---|---|---|
| Vender (sin precio ni descuento) | ✔ | ✔ (precio manual solo admin) | ✔ |
| Ver/reimprimir ventas | solo propias del día; ajenas o de otro día = "no encontrado" | todas | ✔ |
| Anular venta, devoluciones | ✖ | ✔ con motivo | ✔ (anular) |
| Costos, inventoryValue, márgenes, ganancia, cargos, reglas de comisión | ✖ nunca | ✔ | ✔ (DTO + guardia) |
| Cargos posteriores / anularlos | ✖ | ✔ + AuditLog | ✔ |
| Compras, ajustes, mermas, corrección de costo | ✖ | ✔ | ✔ (permisos) |
| Usuarios, configuración, auditoría | ✖ | ✔ | ✔ (permisos) |
| Dashboard | solo conteo y total de sus ventas de hoy | completo | contrato |

## Controles verificados hoy
- Lista blanca de permisos del vendedor: exactamente 7; ningún permiso nuevo se concede por omisión (`security.test`).
- Usuario desactivado o sin sesión → `UNAUTHENTICATED`, antes de cualquier consulta.
- DTO del vendedor: se arma campo a campo y pasa por `assertNoSensitiveKeys` (claves como `cost`, `inventoryValue`, `grossProfit`, `realProfit`, `totalCharges`, `margin`…, a cualquier profundidad).
- Errores al cliente: `toClientError` nunca expone SQL, tablas ni stack.
- Logger: redacta `password`, `token`, costos y márgenes.
- Idempotencia: doble envío = una sola venta.

## Controles añadidos en el bloque 2 (probados con repositorios en memoria)
- Fuga del vendedor: la fila cruda de producto trae un valor centinela de costo (987654321) y el DTO público no lo contiene; el DTO público nunca lee `adminOnly` (test estático).
- Todo método de servicio con `actor` llama a `assertCan` con un permiso existente; ningún servicio importa Prisma.
- Usuarios: no se queda el sistema sin administradores; nadie se desactiva a sí mismo; desactivar revoca sesiones (lógica; Better Auth ◻).
- Reimpresión y listados con alcance del vendedor; reimpresión auditada. Resultado financiero y cargos: solo administrador.

## Riesgos abiertos (ver también REVISION-SCHEMA.md §6, §7, §9)
- Si la app se conecta con el rol propietario, el `REVOKE` no protege. Usar `app_user` en runtime.
- IDOR: toda consulta por id debe pasar por política de alcance; un id ajeno debe responder igual que uno inexistente.
- Next.js: las server actions son endpoints públicos; validar forma de entrada (Zod, pendiente) y autenticar siempre.
- Rate limit de login (Better Auth, tabla `rate_limits`) y política de contraseñas: configuradas pero ◻ sin probar.
- El rol sale siempre de la BD en cada petición (`getActor`), no de datos del cliente.
- El plugin `admin` de Better Auth permite *impersonar*: mantener deshabilitado (`impersonatedBy` existe en Session).

## Auditoría de conflictos de idempotencia
Un conflicto escribe `sale.idempotency_conflict` (usuario, venta existente, key) en transacción propia, de modo que persiste aunque la venta se rechace. El ajuste de conteo exige `inventory.adjust` (solo ADMINISTRADOR).
