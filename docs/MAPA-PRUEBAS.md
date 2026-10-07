# Mapa de pruebas: 63 reglas SQL → pruebas de aplicación

Estado honesto: **ninguna de las 63 se ha ejecutado contra la migración real de Prisma** (todavía no existe).
- Sobre un DDL *mínimo* (entregado antes, `pruebas-sql/run_tests.py`): 63/63.
- Sobre un **DDL derivado del schema completo** (todas las columnas, enums, claves foráneas; `tests/integration/sql/run.py`): **63/63**. Sin las reglas SQL pasan solo 18/63 (control negativo). Sigue sin ser la migración de Prisma.

Columna 3 = prueba de aplicación (en `tests/unit`) que **ya corre y pasa** y cubre la *misma regla* a nivel de código.
Esas pruebas validan los planificadores y servicios con una base **en memoria**; no demuestran que PostgreSQL rechace nada.
Desde el bloque 2 hay además pruebas de servicio (compras, inventario, productos, reportes, usuarios) en `tests/unit/purchases-service.test.ts` y `services-extra.test.ts`. Las filas con «—» solo las puede verificar la base de datos (CHECK, triggers, claves foráneas, permisos): son el motivo de la fase de integración.

| SQL | Regla | Cobertura de aplicación HOY (verificada) | Falta |
|---|---|---|---|
| 1 | vender todo: stock 0 y valor 0 | inventory.test: C/D (última salida 0/0) | integración sobre migración real |
| 2 | stock 0 con valor > 0 (invariante, diferido) | inventory.test: D4 (assertInvariant) | integración sobre migración real |
| 3 | stock negativo | inventory.test: E (no se vende más de lo que hay) | integración sobre migración real |
| 4 | valor negativo | inventory.test: D4 | integración sobre migración real |
| 5 | vender todo el stock pero dejar valor residual | inventory.test: D/D2/D3 | integración sobre migración real |
| 6 | movimiento con antes+cantidad ≠ después | inventory.test: K (cuadratura) | integración sobre migración real |
| 7 | COST_CORRECTION con cantidad 0 y nota | inventory.test: corrección de costo | integración sobre migración real |
| 8 | COST_CORRECTION con cantidad ≠ 0 | inventory.test: corrección de costo (cantidad 0) | integración sobre migración real |
| 9 | ajuste sin nota | inventory.test: corrección exige motivo | integración sobre migración real |
| 10 | merma con nota en blanco | inventory.test: corrección exige motivo | integración sobre migración real |
| 11 | SERVICE con StockLevel | — | integración sobre migración real (única barrera) |
| 12 | SERVICE con ProductCost | — | integración sobre migración real (única barrera) |
| 13 | SERVICE con StockMovement | — | integración sobre migración real (única barrera) |
| 14 | SERVICE con presentación | — | integración sobre migración real (única barrera) |
| 15 | venta de SERVICE (Envío $2.500: neto 2.101, IVA 399) sin SaleItemCost | sale-plan.test: F/N3; sales-service.test: F | integración sobre migración real |
| 16 | SaleItemCost para línea de SERVICE | — | integración sobre migración real (única barrera) |
| 17 | SaleItemCost para línea de producto GOODS | sales-service.test: C (costo congelado) | integración sobre migración real |
| 18 | 2 bolsas de 500 g = 1,000 kg ($16.000: neto 13.445, IVA 2.555) | sale-plan.test: G; money.test: G | integración sobre migración real |
| 19 | 1,5 bolsas | sale-plan.test: H | integración sobre migración real |
| 20 | 2,3 bolsas | sale-plan.test: H | integración sobre migración real |
| 21 | 2 bolsas pero cantidad base ≠ 2 × 0,5 | sale-plan.test: G (cantidad base) | integración sobre migración real |
| 22 | Producto A + presentación del producto B (columna declarada = B) | sale-plan.test: H2 | integración sobre migración real |
| 23 | Producto A + presentación de B (declarando A) | sale-plan.test: H2 | integración sobre migración real |
| 24 | Código de barras: producto A con presentación de B | — | integración sobre migración real (única barrera) |
| 25 | Compra: producto A con presentación de B | — | integración sobre migración real (única barrera) |
| 26 | Compra con presentación en cantidad no entera | — | integración sobre migración real (única barrera) |
| 27 | presentación con contenido 0 | — | integración sobre migración real (única barrera) |
| 28 | 3 líneas de $1.000: neto 2.521 = 841+840+840 | money.test: M1; sale-plan.test: M1 | integración sobre migración real |
| 29 | mismo caso redondeando cada línea (840×3 = 2.520) | money.test: M1 (reparto por mayor resto) | integración sobre migración real |
| 30 | venta con neto + IVA ≠ total | — | integración sobre migración real (única barrera) |
| 31 | línea con neto + IVA ≠ total | — | integración sobre migración real (única barrera) |
| 32 | suma de totales de líneas ≠ total de la venta | — | integración sobre migración real (única barrera) |
| 33 | resultado congelado (C): bruta 274, cargos 14, real 260 | purchases-charges.test: C; sales-service.test: C | integración sobre migración real |
| 34 | grossProfit ≠ netTotal − costo | purchases-charges.test: C | integración sobre migración real |
| 35 | realProfit ≠ grossProfit − totalCharges | purchases-charges.test: C | integración sobre migración real |
| 36 | SaleFinancial.netTotal ≠ Sale.netTotal | — | integración sobre migración real (única barrera) |
| 37 | cambiar costOfGoodsSold y grossProfit coherentes | — | integración sobre migración real (única barrera) |
| 38 | cargo posterior ADMIN + recálculo: totalCharges 2.900, real 184 | purchases-charges.test: L1; sales-service.test: L1 | integración sobre migración real |
| 39 | cargo posterior de un VENDEDOR | purchases-charges.test: L2; sales-service.test: L2 | integración sobre migración real |
| 40 | cargo posterior sin recalcular SaleFinancial | sales-service.test: L1 (recalcula) | integración sobre migración real |
| 41 | cambiar totalCharges sin un cargo que lo respalde | — | integración sobre migración real (única barrera) |
| 42b | venta anulada sin motivo (NULL) | — | integración sobre migración real (única barrera) |
| 42 | cargo posterior en venta anulada | purchases-charges.test: L5; sales-service.test: L5 | integración sobre migración real |
| 43 | comisión de canal + comisión de medio de pago a la vez (ML + tarjeta) | purchases-charges.test: P1 | integración sobre migración real |
| 44 | anular un cargo (app_user) y recalcular | purchases-charges.test: L4; sales-service.test: L4 | integración sobre migración real |
| 45 | anular un cargo sin recalcular | — | integración sobre migración real (única barrera) |
| 46 | borrar un cargo (app_user) | — | integración sobre migración real (única barrera) |
| 47 | editar el monto de un cargo (app_user) | — | integración sobre migración real (única barrera) |
| 48 | modificar SaleItemCost (app_user) | — | integración sobre migración real (única barrera) |
| 49 | borrar un movimiento de stock (app_user) | — | integración sobre migración real (única barrera) |
| 50 | editar auditoría (app_user) | — | integración sobre migración real (única barrera) |
| 51 | factura con documentKey | purchases-charges.test: O (documentKey) | integración sobre migración real |
| 52 | mismo documento dos veces (concurrencia) | purchases-charges.test: O | integración sobre migración real |
| 53 | mismo documento sin proveedor | purchases-charges.test: O2 | integración sobre migración real |
| 54 | mismo n° con otro tipo o proveedor | purchases-charges.test: O3 | integración sobre migración real |
| 55 | compra anulada libera el documento | purchases-charges.test: O4 | integración sobre migración real |
| 56 | compra anulada que conserva documentKey | — | integración sobre migración real (única barrera) |
| 57 | compra confirmada con n° pero sin documentKey | — | integración sobre migración real (única barrera) |
| 58 | factura sin número | purchases-charges.test: assertDocNumberRequired | integración sobre migración real |
| 59 | neto + IVA ≠ total en la compra | — | integración sobre migración real (única barrera) |
| 60 | FeeRule con medio de pago Y canal | — | integración sobre migración real (única barrera) |
| 61 | FeeRule sin destino | — | integración sobre migración real (única barrera) |
| 62 | regla de canal + regla de medio de pago coexisten | purchases-charges.test: P1 | integración sobre migración real |

## Fase de integración (cuando haya npm + PostgreSQL)
1. Crear la migración real y anexar `prisma/sql/10_roles.sql` y `20_reglas.sql` (ver COMANDOS.md §4).
2. **Fixtures: ya portados** (`tests/integration/sql/run.py`, introspección de columnas obligatorias y FK).
3. Ejecutar `PSQL_CMD=... npm run test:sql-rules` contra la base de la migración real: debe dar 63/63.
4. Conectar los repositorios Prisma y repetir `tests/unit/*-service*.test.ts` contra la BD real + concurrencia con dos conexiones (prueba E).
