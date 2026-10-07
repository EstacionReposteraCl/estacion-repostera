# Operaciones principales: flujo, reglas, quién puede, dónde vive el código

Convención: **P** = planificador puro en `src/domain` (probado hoy) · **S** = servicio en `src/services` · **R** = repositorio (contrato en `src/repositories/ports.ts`; implementación Prisma pendiente) · **BD** = regla en `prisma/sql/20_reglas.sql`.

## Productos
- Crear/editar: ADMINISTRADOR (`product.write`). Búsqueda por nombre **o** código de barras: ambos roles (`product.read.public`), con DTO sin costos.
- SERVICE (Envío, Despacho…): sin stock, costo, movimientos ni presentaciones (**BD** triggers `forbid_service_*`; **P** `planSale`).
- Unidad base inmutable si ya hay movimientos (**S** pendiente). Precio con IVA incluido; cambios de precio → AuditLog.
- "Eliminar" = archivar (`archivedAt`, `isActive=false`); nunca borrado físico (FK `Restrict`).
- Contrato: `ProductService` en `src/services/contracts.ts`.

## Inventario
- Fuente de verdad: `ProductCost.inventoryValue` (pesos enteros). Promedio = valor ÷ cantidad, **derivado, nunca guardado** (`averageCostDisplay`).
- Salida: `round(valor × salida ÷ stock)`; si sale todo, se lleva el valor restante (**P** `outflowCost`, probado: C, D, D2, D3).
- Solo una ruta escribe StockLevel/ProductCost (`Tx.inventory.saveState`) y siempre con su `StockMovement` (append-only, `seq` por sucursal+producto).
- Mermas, conteos y correcciones: ADMINISTRADOR, nota obligatoria (**BD** `mov_note_required`). Corrección de costo: cantidad 0, excepcional, AuditLog (**P** `planCostCorrection`).
- Cuadratura (prueba K): `reconcile()` **P**.

## Compras
- ADMINISTRADOR. Factura: `costBasis` = neto; boleta: total (**P** `planPurchaseLine`). Costo unitario derivado, no guardado.
- Anti-duplicado: `normalizeDocNumber` + `buildDocumentKey` (**P**) + búsqueda explícita en el servicio + `documentKey @unique` (**BD**, red de seguridad ante concurrencia).
- Anulación (**P** `planPurchaseVoid`): EXACT si la compra fue el último movimiento; si no, bloqueada salvo ADJUSTED explícito (vista previa, varianza, motivo, doble auditoría); siempre bloqueada si stock < comprado. Libera `documentKey`.
- Contrato: `PurchaseService`. Implementación pendiente.

## Ventas (implementado contra contratos: `createSalesService`)
Transacción única: idempotencia → folio atómico → por producto (orden estable, `FOR UPDATE`): `planOutflow` → `SaleItemCost` congelado → `StockMovement` → cargos por regla → `SaleFinancial`.
- Todas las líneas son Product activo; presentaciones solo en envases enteros; el vendedor no envía precio ni descuento (**P**, probado).
- Neto/IVA sobre el total afecto; líneas por mayor resto: Σ = total exacto (**P**, 200.000 casos aleatorios).
- Cualquier fallo revierte todo (probado con la base en memoria; el bloqueo real lo probará la integración).
- El vendedor recibe `SellerSaleDTO` (sin costos/margen/cargos), solo ventas propias del día (**política** `canViewSale`).

## Anulación de venta
- Solo ADMINISTRADOR, motivo obligatorio. Restaura cantidad y el **costo congelado** (no el promedio actual). Venta VOIDED; `SaleFinancial` se conserva; no admite cargos; AuditLog (`voidSale`, probado en memoria).

## Cargos posteriores (Mercado Libre, Rappi, envío asumido, otros)
- Solo ADMINISTRADOR, venta COMPLETED. `addLateCharge`: inserta cargo `addedAfterClose=true`, recalcula `totalCharges` y `realProfit`, deja `recalculatedAt/By` y AuditLog antes/después. No toca `netTotal`, `costOfGoodsSold`, `grossProfit` (**BD** `sf_immutable`, `check_charges_total`, `check_late_charge`). Un cargo equivocado se **anula** con motivo (`voidCharge`), nunca se borra.
- Se aplican **todas** las reglas que correspondan y se suman (canal + medio de pago + otros). Reglas "manual por venta" no generan cargo al cierre.

## Usuarios y roles
- Sin registro público; el administrador crea usuarios (`mustChangePassword`). Desactivar = `banned` + revocar sesiones; no se desactiva al último administrador ni a uno mismo. Contrato: `UserAdminService`. Configuración Better Auth: `src/core/auth/auth.ts` (**no verificada**).

## Reportes
- VENDEDOR: solo conteo y total de sus ventas de hoy (`dashboard.seller`). ADMINISTRADOR: financieros (`report.financial`); ventas VOIDED no cuentan. Contrato: `ReportService`.

## Bloque 2: servicios implementados contra puertos (probados en memoria)
`createServices(ports)` (`src/services/composition.ts`) cablea: **sales** (cierre, reimpresión, listado, anulación, cargos, resultado financiero), **purchases** (registro con anti-duplicado, vista previa y anulación EXACT/ADJUSTED con reparto por línea y doble auditoría), **inventory** (saldo inicial, conteo, merma, corrección de costo, cuadratura), **products** (búsqueda segura, unidad inmutable con movimientos, precio auditado, archivar), **reports**, **users**. Los contratos son `src/repositories/ports.ts`; la implementación Prisma es PENDIENTE.

## Ajuste por conteo (sobrante/faltante) e idempotencia
- Conteo: diferencia = contado − sistema. Faltante → salida al costo promedio. Sobrante con costo previo → entrada al promedio. Sobrante con stock 0 → el ADMINISTRADOR debe ingresar costo unitario; sin él, la operación se rechaza.
- Venta: `idempotencyKey` igual y operación idéntica → resultado anterior; operación distinta → conflicto (CONFLICT) auditado, sin cambios en datos.
