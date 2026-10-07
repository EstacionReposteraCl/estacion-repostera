# Decisiones que necesito de ti (ninguna cambia schema v0.5 ni las reglas SQL)

Implementé lo siguiente con un criterio provisional, marcado en el código. Dime si lo mantengo o lo cambio.

1. **Valoración de un sobrante en conteo físico.** Hoy: se valora al **costo promedio vigente** (valor ÷ cantidad); si no había stock previo se **rechaza** (no hay costo que usar: debe registrarse una compra o un saldo inicial). El faltante cuesta como cualquier salida. *Alternativa:* valorar sobrantes a 0 y corregir el costo después.
2. **Misma `idempotencyKey` con contenido distinto.** Hoy se devuelve la venta ya creada, sin comparar el contenido. *Alternativa:* guardar un hash del pedido y responder conflicto si difiere.
3. **Costo ingresado en compras por presentación.** Hoy el costo unitario ingresado es **por unidad base** (por kg), no por envase; para precio por envase se ingresa el **total de la línea**. Evita ambigüedad.
4. **Devoluciones (`SaleReturn*`).** No se implementan: el SQL aprobado no tiene reglas ni pruebas para ellas. Necesito sus reglas antes de escribirlas.
5. **Usuarios sin sucursal** (ya anotado en REVISION-SCHEMA §1): v1 usa la sucursal principal.
6. **Base de la comisión** (con IVA incluido) y su tratamiento de IVA: pendiente con el contador (ya anotado).

Sin problemas que obliguen a modificar el schema v0.5: no se encontró ninguno.

## Bloque 3 — decisiones aprobadas (resolución)

1. **Sobrante en conteo físico** (`planCountAdjustment`, `inventory.service.countAdjust`; solo ADMINISTRADOR, nota obligatoria, auditado `inventory.adjust`).
   - Con stock y valor previos: el sobrante se valora al **costo promedio vigente** (valor × sobrante ÷ cantidad, half-up).
   - Con stock 0 (o valor 0): **no se valora en $0 ni se inventa costo**. Se rechaza con `BUSINESS_RULE` (`requiresUnitCost`) salvo que el ADMINISTRADOR entregue `unitCost` explícito (pesos por unidad base, entero > 0).
   - `unitCost` explícito no se acepta cuando ya hay costo promedio ni en faltantes (evita valoraciones ambiguas).
   - Se registra como movimiento `ADJUSTMENT` con `valueChange` y nota; la auditoría guarda antes/después y `valuation` (`SURPLUS_AT_AVERAGE` / `SURPLUS_EXPLICIT_UNIT_COST` / `OUTFLOW_AT_AVERAGE`). El schema v0.5 alcanzó; no se modificó.
2. **idempotencyKey**: se calcula una huella canónica (usuario, canal, referencia externa, nota, líneas ordenadas, pagos ordenados) desde la solicitud y desde la venta guardada (sin columna nueva). Misma key + misma huella → devuelve la venta original. Misma key + huella distinta → `CONFLICT`, no modifica la venta existente, no crea otra, y deja `AuditLog` `sale.idempotency_conflict`. Key vacía → `VALIDATION`. Antes de este cambio se devolvía la original en silencio (defecto comprobado).
3. **Costo de compra por presentación**: se mantiene. El costo ingresado es el TOTAL de la línea; el costo por unidad base se deriva (10 × 500 g por $20.000 = 5 kg = $4.000/kg). Con presentación, `unitCost` se rechaza (`VALIDATION`).
4. **Devoluciones: FUERA DE ESTA FASE, no implementadas.** Reglas por definir explícitamente: stock, costo de la devolución, impacto en COGS, impacto en grossProfit/realProfit, IVA, cargos/comisiones, devolución parcial, total, estados, auditoría, eventual documento tributario. No se inventó ninguna.
