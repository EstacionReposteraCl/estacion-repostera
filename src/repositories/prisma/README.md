# Repositorios Prisma (pendiente de implementar al instalar)
Único lugar que importa `src/generated/prisma`. Implementan `Tx`, `UnitOfWork` y `CatalogReader` de `../ports.ts`.
- Convertir `Decimal` ↔ milésimas con `decimalToMilli` / `formatQuantity` (nunca `Number`).
- `lockState`: `SELECT ... FOR UPDATE` sobre StockLevel y ProductCost del par (sucursal, producto).
- `saveState`: ÚNICA vía que escribe StockLevel/ProductCost; incrementa `movementSeq` en la misma sentencia.
- `nextFolio`: `UPDATE document_sequences SET "nextNumber" = "nextNumber" + 1 ... RETURNING`.
- Toda consulta de ventas aplica `saleScopeFor(actor, today)` (src/policies/sale.policy.ts).
- Los DTO se construyen campo a campo (src/dto); jamás `return prismaRow`.
Cada implementación debe pasar los mismos tests que usan `tests/helpers/fake-db.ts`, más `tests/integration` contra PostgreSQL real.

## Reglas adicionales para la implementación (derivadas de las pruebas de servicio)
- `Tx.inventory.lockState` crea StockLevel + ProductCost en 0/0 si no existen (producto GOODS nuevo) y devuelve el estado bloqueado.
- Idempotencia: si dos peticiones con la misma `idempotencyKey` chocan con la restricción única, capturar el error de unicidad y devolver la venta existente (no un error).
- `purchases.insert` debe fallar con error de unicidad si `documentKey` ya existe (red de seguridad de la prueba O5); el servicio ya hace la búsqueda explícita primero.
- `purchases.markVoided` pone `documentKey = NULL` en la misma sentencia que cambia el estado a VOIDED.
- `ProductReader.search` puede traer `adminOnly` solo si `withAdminData`; el vendedor siempre pasa `withAdminData: false` (el DTO público además nunca lo lee).
- Decimal ↔ milésimas siempre por texto (`decimalToMilli`/`formatQuantity`).
- Cada método de `Ports` debe pasar el MISMO conjunto de pruebas de tests/unit con una BD real de pruebas.

## Idempotencia (regla para la implementación Prisma — PENDIENTE)
Ante violación de unicidad de `idempotencyKey`, cargar la venta original, comparar la huella (`fingerprintOfStored` vs solicitud) y devolver la original solo si coincide; si no, lanzar `idempotencyConflict` y auditar. No sobrescribir ni crear otra venta.
