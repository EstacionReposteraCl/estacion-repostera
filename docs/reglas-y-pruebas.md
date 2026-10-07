# Estación Repostera · Reglas SQL y pruebas · acompaña a schema.prisma v0.4

Documento de revisión. No se ejecutó nada, no hay proyecto ni conexión.
El SQL va dentro de la primera migración (que todavía no existe).

Convenciones: dinero en pesos enteros; cantidades en unidad base con 3 decimales, calculadas en **milésimas enteras**; redondeo "mitad hacia arriba" con aritmética entera (sin flotantes).

---

## Reglas aprobadas explícitas (v0.5)

**1. FeeRule: un destino por regla, pero los cargos se suman.**
Cada `FeeRule` pertenece a **un solo destino**: un medio de pago **o** un canal (CHECK `fee_one_target`). Eso no hace que una regla excluya a la otra. Al cerrar una venta el servicio aplica **todas** las reglas que correspondan y crea una fila de `SaleCharge` por cada una; `totalCharges` es la suma. Ejemplo: Mercado Libre pagada con tarjeta genera `CHANNEL_COMMISSION` (regla del canal) + `PAYMENT_FEE` (regla de la tarjeta) + otros cargos que existan. Probado en la base: una regla de canal y una de medio de pago coexisten (prueba 62) y una venta recibe ambos cargos sumados (prueba 43).

**2. SaleFinancial.**
- **Inmutables:** `netTotal`, `costOfGoodsSold`, `grossProfit`. Un trigger rechaza cualquier cambio, incluso uno coherente (prueba 37).
- **Modificables solo por acción administrativa auditada:** `totalCharges` y `realProfit`. El servicio exige ADMINISTRADOR, escribe `AuditLog` y registra `recalculatedAt`/`recalculatedById`. La base verifica que `totalCharges` siempre sea la suma de los cargos no anulados (pruebas 40, 41 y 45).
- Los cargos posteriores nunca modifican el costo histórico de lo vendido ni `grossProfit`.

---

## B. Reglas SQL

```sql
-- ============ 1. Stock y valor del inventario ============
ALTER TABLE stock_levels  ADD CONSTRAINT stock_nonneg CHECK (quantity >= 0);
ALTER TABLE product_costs ADD CONSTRAINT value_nonneg CHECK ("inventoryValue" >= 0);
ALTER TABLE stock_movements ADD CONSTRAINT mov_qty_math
  CHECK ("quantityAfter" = "quantityBefore" + quantity);
ALTER TABLE stock_movements ADD CONSTRAINT mov_nonzero
  CHECK (quantity <> 0 OR type = 'COST_CORRECTION');
ALTER TABLE stock_movements ADD CONSTRAINT mov_cost_correction_qty
  CHECK (type <> 'COST_CORRECTION' OR quantity = 0);
ALTER TABLE stock_movements ADD CONSTRAINT mov_note_required
  CHECK (type NOT IN ('COST_CORRECTION','ADJUSTMENT','WASTE','CORRECTION') OR COALESCE(length(trim(note)), 0) > 0);

-- Invariante entre dos tablas: stock = 0 <=> valor = 0. Trigger de restricción DIFERIDO (al confirmar).
CREATE FUNCTION check_inventory_invariant() RETURNS trigger AS $$
DECLARE q numeric; v int;
BEGIN
  SELECT sl.quantity, pc."inventoryValue" INTO q, v
  FROM stock_levels sl JOIN product_costs pc
    ON pc."branchId" = sl."branchId" AND pc."productId" = sl."productId"
  WHERE sl."branchId" = NEW."branchId" AND sl."productId" = NEW."productId";
  IF FOUND AND ((q = 0 AND v <> 0) OR (q > 0 AND v < 0)) THEN
    RAISE EXCEPTION 'Inventario inconsistente: producto % cantidad % valor %', NEW."productId", q, v;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER inv_invariant_sl AFTER INSERT OR UPDATE ON stock_levels
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_invariant();
CREATE CONSTRAINT TRIGGER inv_invariant_pc AFTER INSERT OR UPDATE ON product_costs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_invariant();

-- ============ 2. SERVICE nunca toca inventario ============
CREATE FUNCTION forbid_service_inventory() RETURNS trigger AS $$
BEGIN
  IF (SELECT kind FROM products WHERE id = NEW."productId") <> 'GOODS' THEN
    RAISE EXCEPTION 'Un producto SERVICE no puede tener inventario, movimientos ni presentaciones';
  END IF; RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_sl BEFORE INSERT OR UPDATE ON stock_levels          FOR EACH ROW EXECUTE FUNCTION forbid_service_inventory();
CREATE TRIGGER t_pc BEFORE INSERT OR UPDATE ON product_costs         FOR EACH ROW EXECUTE FUNCTION forbid_service_inventory();
CREATE TRIGGER t_sm BEFORE INSERT           ON stock_movements       FOR EACH ROW EXECUTE FUNCTION forbid_service_inventory();
CREATE TRIGGER t_pp BEFORE INSERT OR UPDATE ON product_presentations FOR EACH ROW EXECUTE FUNCTION forbid_service_inventory();

-- Una línea de venta de un SERVICE no tiene costo de inventario
CREATE FUNCTION forbid_service_item_cost() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sale_items si JOIN products p ON p.id = si."productId"
             WHERE si.id = NEW."saleItemId" AND p.kind <> 'GOODS') THEN
    RAISE EXCEPTION 'Una línea de SERVICE no genera SaleItemCost';
  END IF; RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_sic BEFORE INSERT ON sale_item_costs FOR EACH ROW EXECUTE FUNCTION forbid_service_item_cost();

-- ============ 3. Presentación y producto coherentes; presentaciones enteras ============
ALTER TABLE product_barcodes ADD CONSTRAINT bc_pres_ok CHECK (
  ("presentationId" IS NULL AND "presentationProductId" IS NULL) OR
  ("presentationId" IS NOT NULL AND "presentationProductId" = "productId"));
ALTER TABLE purchase_items ADD CONSTRAINT pi_pres_ok CHECK (
  ("presentationId" IS NULL AND "presentationProductId" IS NULL) OR
  ("presentationId" IS NOT NULL AND "presentationProductId" = "productId"));
ALTER TABLE sale_items ADD CONSTRAINT si_pres_ok CHECK (
  ("presentationId" IS NULL AND "presentationProductId" IS NULL) OR
  ("presentationId" IS NOT NULL AND "presentationProductId" = "productId"));
ALTER TABLE sale_items ADD CONSTRAINT si_packs_integer CHECK (
  "priceBasis" <> 'PER_PRESENTATION' OR (
    "presentationId" IS NOT NULL AND "presentationBaseQuantity" > 0
    AND "enteredQuantity" >= 1 AND "enteredQuantity" = trunc("enteredQuantity")
    AND quantity = "enteredQuantity" * "presentationBaseQuantity"));
ALTER TABLE purchase_items ADD CONSTRAINT pi_packs_integer CHECK (
  "presentationId" IS NULL OR ("enteredQuantity" >= 1 AND "enteredQuantity" = trunc("enteredQuantity")));
ALTER TABLE product_presentations ADD CONSTRAINT pp_qty_pos CHECK ("baseQuantity" > 0);

-- ============ 4. IVA y totales de la venta (suma exacta, sin diferencias de $1) ============
ALTER TABLE sale_items ADD CONSTRAINT si_line_sum CHECK ("lineNet" + "lineVat" = "lineTotal" AND quantity > 0 AND "lineTotal" >= 0);
ALTER TABLE sales      ADD CONSTRAINT sale_sum     CHECK ("netTotal" + "vatTotal" = total AND total >= 0);
ALTER TABLE sales      ADD CONSTRAINT sale_void_reason CHECK (status <> 'VOIDED' OR COALESCE(length(trim("voidReason")), 0) > 0);

-- Σ de las líneas = totales de la venta, verificado al confirmar la transacción
CREATE FUNCTION check_sale_lines_sum() RETURNS trigger AS $$
DECLARE sid text;
BEGIN
  IF TG_TABLE_NAME = 'sales' THEN sid := NEW.id; ELSE sid := NEW."saleId"; END IF;
  IF EXISTS (
    SELECT 1 FROM sales s
    JOIN (SELECT "saleId", SUM("lineTotal") t, SUM("lineNet") n, SUM("lineVat") v FROM sale_items GROUP BY "saleId") x
      ON x."saleId" = s.id
    WHERE s.id = sid AND (x.t <> s.total OR x.n <> s."netTotal" OR x.v <> s."vatTotal")) THEN
    RAISE EXCEPTION 'La suma de las líneas no coincide con el total de la venta %', sid;
  END IF; RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER sale_sum_s  AFTER INSERT OR UPDATE ON sales      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_sale_lines_sum();
CREATE CONSTRAINT TRIGGER sale_sum_si AFTER INSERT OR UPDATE ON sale_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_sale_lines_sum();

-- ============ 5. Resultado financiero congelado ============
ALTER TABLE sale_financials ADD CONSTRAINT sf_gross CHECK ("grossProfit" = "netTotal" - "costOfGoodsSold");
ALTER TABLE sale_financials ADD CONSTRAINT sf_real  CHECK ("realProfit"  = "grossProfit" - "totalCharges");
ALTER TABLE sale_financials ADD CONSTRAINT sf_charges_nonneg CHECK ("totalCharges" >= 0);

-- netTotal copiado = el de la venta
CREATE FUNCTION check_sf_net() RETURNS trigger AS $$
BEGIN
  IF NEW."netTotal" <> (SELECT "netTotal" FROM sales WHERE id = NEW."saleId") THEN
    RAISE EXCEPTION 'SaleFinancial.netTotal no coincide con Sale.netTotal'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sf_net BEFORE INSERT ON sale_financials FOR EACH ROW EXECUTE FUNCTION check_sf_net();

-- Inmutables: lo vendido y su costo. Solo cambian totalCharges, realProfit y los datos de recálculo.
CREATE FUNCTION sf_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."saleId" <> OLD."saleId" OR NEW."netTotal" <> OLD."netTotal"
     OR NEW."costOfGoodsSold" <> OLD."costOfGoodsSold" OR NEW."grossProfit" <> OLD."grossProfit" THEN
    RAISE EXCEPTION 'El costo vendido y la ganancia bruta de una venta no se modifican';
  END IF; RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sf_imm BEFORE UPDATE ON sale_financials FOR EACH ROW EXECUTE FUNCTION sf_immutable();
REVOKE UPDATE, DELETE ON sale_item_costs FROM app_user;      -- el costo vendido nunca cambia
REVOKE DELETE ON sale_financials FROM app_user;

-- totalCharges = Σ cargos NO anulados (verificado al confirmar; cubre altas y anulaciones de cargos)
CREATE FUNCTION check_charges_total() RETURNS trigger AS $$
DECLARE sid text := NEW."saleId";
BEGIN
  IF EXISTS (SELECT 1 FROM sale_financials f
             WHERE f."saleId" = sid AND f."totalCharges" <>
               COALESCE((SELECT SUM(amount) FROM sale_charges c WHERE c."saleId" = sid AND c."voidedAt" IS NULL), 0)) THEN
    RAISE EXCEPTION 'totalCharges no coincide con los cargos de la venta %', sid;
  END IF; RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER chg_total_c AFTER INSERT OR UPDATE ON sale_charges    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_charges_total();
CREATE CONSTRAINT TRIGGER chg_total_f AFTER INSERT OR UPDATE ON sale_financials DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_charges_total();

-- ============ 6. Cargos posteriores: solo ADMINISTRADOR, nunca borrados ============
ALTER TABLE sale_charges ADD CONSTRAINT chg_amount_nonneg CHECK (amount >= 0);
CREATE FUNCTION check_late_charge() RETURNS trigger AS $$
BEGIN
  IF NEW."addedAfterClose" THEN
    IF (SELECT role FROM users WHERE id = NEW."createdById") <> 'ADMINISTRADOR' THEN
      RAISE EXCEPTION 'Solo un ADMINISTRADOR puede agregar cargos posteriores'; END IF;
    IF (SELECT status FROM sales WHERE id = NEW."saleId") <> 'COMPLETED' THEN
      RAISE EXCEPTION 'No se pueden agregar cargos a una venta anulada'; END IF;
  END IF; RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER chg_late BEFORE INSERT ON sale_charges FOR EACH ROW EXECUTE FUNCTION check_late_charge();
REVOKE UPDATE, DELETE ON sale_charges FROM app_user;
GRANT  UPDATE ("voidedAt", "voidedById", "voidReason") ON sale_charges TO app_user;  -- solo anular, con motivo

-- ============ 7. Compras: documento duplicado y consistencia ============
-- documentKey (único en Prisma) = '<supplierId o ->|<docType>|<n° normalizado>' mientras la compra esté CONFIRMED
-- y tenga n°; NULL en otro caso (así una compra anulada permite re-registrar el documento corregido).
ALTER TABLE purchases ADD CONSTRAINT pur_key_state CHECK ("documentKey" IS NULL OR (status = 'CONFIRMED' AND "docNumber" IS NOT NULL));
ALTER TABLE purchases ADD CONSTRAINT pur_key_present CHECK (status <> 'CONFIRMED' OR "docNumber" IS NULL OR "documentKey" IS NOT NULL);
ALTER TABLE purchases ADD CONSTRAINT pur_doc_required CHECK ("docType" NOT IN ('FACTURA','BOLETA') OR COALESCE(length(trim("docNumber")), 0) > 0);
ALTER TABLE purchases ADD CONSTRAINT pur_sum CHECK ("netAmount" + "vatAmount" = "totalAmount");
ALTER TABLE purchase_items ADD CONSTRAINT pi_sum CHECK ("lineNet" + "lineVat" = "lineTotal" AND quantity > 0 AND "costBasis" >= 0);

-- ============ 8. Solo agregar / no borrar ============
REVOKE UPDATE, DELETE ON stock_movements, audit_logs FROM app_user;
ALTER TABLE fee_rules ADD CONSTRAINT fee_one_target CHECK (("paymentMethodId" IS NULL) <> ("channelId" IS NULL));
```

**Sobre las compras (punto 3).** `@@unique([supplierId, docType, docNumber])` no protegía nada cuando `supplierId` o `docNumber` eran nulos, porque Postgres trata cada nulo como distinto. Lo reemplacé por `documentKey`, una clave única calculada por el servicio. Así el control no depende de una peculiaridad de la base y, además, una compra anulada libera el documento para registrarlo de nuevo corregido.

---

## Reglas del servicio (lo que SQL no puede hacer solo)

**Registrar compra.** El servicio, dentro de la transacción: normaliza el n° (quita espacios, mayúsculas, ceros a la izquierda), arma `documentKey`, **busca explícitamente** un duplicado y responde "Ese documento ya fue registrado (compra del dd-mm-aaaa)". La restricción única es la red de seguridad si dos personas lo intentan a la vez. Factura y boleta exigen n°. Un documento tipo OTRO sin número no se puede verificar y el sistema lo avisa.

**IVA con precio incluido (regla de negocio).**
Para producto afecto al 19%: `neto = redondeo(total ÷ 1,19)` e `iva = total − neto`, con redondeo mitad hacia arriba en enteros (`(total × 100 × 2 + 119) ÷ 238`).
1. Cada línea tiene `lineTotal` entero: precio × cantidad redondeado al peso.
2. `Sale.total = Σ lineTotal`. El neto y el IVA se calculan **sobre el total afecto de la venta** (los exentos suman íntegros al neto con IVA 0). Es el mismo criterio de un documento con IVA incluido.
3. El neto de cada línea se reparte por **mayor resto** para que `Σ lineNet = netTotal` exacto. Cada línea queda a lo más $1 de su redondeo individual, pero el documento nunca difiere.
4. Ejemplo: 3 líneas de $1.000. Redondeando cada una por separado darían neto 840 × 3 = 2.520; sobre el total, 3.000 ÷ 1,19 = **2.521** (IVA 479). El reparto da 841 + 840 + 840 = 2.521. Sin diferencia de $1.

**Cerrar la venta (una transacción).**
1. Valida que **toda línea sea de un Product activo** (no hay ítems libres), cantidades enteras en presentaciones y decimales válidos por unidad; el vendedor no envía precios.
2. Reserva el folio, descuenta inventario (solo GOODS), crea `SaleItemCost` por línea con costo congelado.
3. Calcula los cargos por regla (medio de pago y canal) y crea los `SaleCharge` con `addedAfterClose = false`.
4. Crea `SaleFinancial`: `netTotal`, `costOfGoodsSold`, `grossProfit = netTotal − costOfGoodsSold`, `totalCharges = Σ cargos`, `realProfit = grossProfit − totalCharges`. **Quedan congelados.**

**Cargo posterior (Mercado Libre, Rappi, envío asumido, otros).** Solo ADMINISTRADOR, sobre una venta COMPLETED. En una transacción, con la fila de `SaleFinancial` bloqueada:
1. Inserta `SaleCharge` (`addedAfterClose = true`, usuario, fecha, monto, tipo, motivo).
2. Recalcula **explícitamente** `totalCharges = Σ cargos no anulados` y `realProfit = grossProfit − totalCharges`; guarda `recalculatedAt` y `recalculatedById`.
3. Escribe `AuditLog` (`sale.charge_added`) con antes/después de `totalCharges` y `realProfit`, el cargo, el usuario y la IP.
4. **No toca** `SaleItemCost`, `costOfGoodsSold` ni `grossProfit`, y **no elimina** cargos anteriores. Los triggers de la sección 5 lo hacen cumplir.
5. Anular un cargo equivocado (con motivo, solo administrador) repite los pasos 2 y 3 con la acción `sale.charge_voided`.

**Inventario, compras y anulaciones** (sin cambios respecto a v0.3):
- Una salida cuesta `round(valor × cantidad ÷ stock)`; si vende todo el stock se lleva exactamente el valor restante.
- Compra: costo unitario = `costBasis ÷ cantidad`, nunca almacenado.
- Anular compra: `EXACT` si fue el último movimiento; si hubo movimientos posteriores se bloquea, salvo `ADJUSTED` explícito del administrador (vista previa, varianza, motivo, auditoría); siempre se bloquea si el stock actual es menor que lo comprado.
- Anular venta: restaura cantidad y el **costo congelado**; la venta queda VOIDED y deja de contar en los informes, pero su `SaleFinancial` se conserva como historia. No admite cargos nuevos.

**Servicios y trazabilidad.** Envío, Despacho y otros servicios son `Product` de tipo SERVICE con precio fijo definido por el administrador. Como el vendedor no puede modificar precios, un envío con valores distintos requiere un producto por tarifa ("Envío $2.500", "Envío $3.500"). Una venta sin producto exigirá un permiso específico futuro.

---

## C. Pruebas A-J (actualizadas) y nuevas

Cifras verificadas con aritmética entera. Se ejecutan contra una base de pruebas real, sin mocks.

| ID | Escenario | Resultado esperado |
|---|---|---|
| **A** | Compra 10 kg a $5.000/kg = $50.000 | stock 10,000; valor $50.000; 1 movimiento PURCHASE; costo unitario derivado $5.000/kg |
| **B** | Segunda compra 5 kg a $10.000/kg = $50.000 | stock 15,000; valor $100.000; promedio matemático $6.666,67/kg (no se guarda) |
| **C** | Venta de 0,080 kg de un producto a $12.000/kg, pago con débito 1,5% | total $960; neto **807**, IVA **153**; costo de salida **$533**; stock 14,920; valor $99.467; `SaleItemCost` 533; cargo del medio de pago **$14**. **SaleFinancial congelado:** netTotal 807, COGS 533, grossProfit **274**, totalCharges **14**, realProfit **260** |
| **D** | Venta de todo el stock restante (14,920 kg) | costo $99.467 exactos; **stock 0 y valor 0**. Extras: D2 (3 salidas de 5 kg sobre $100.000 = 33.333 + 33.334 + 33.333), D3 (1 kg vendido en 143 salidas de 7 g, siempre ≥ 0 y cierra en 0), D4 (SQL directo que deje stock 0 con valor ≠ 0 → el trigger diferido aborta) |
| **E** | Dos vendedores intentan vender a la vez el último 1 kg | **exactamente una** venta se completa; la otra falla por stock insuficiente; stock 0, valor 0; un solo movimiento SALE; mismo `idempotencyKey` enviado dos veces crea una sola venta |
| **F** | Venta de SERVICE "Envío" $2.500 | neto **2.101**, IVA **399**; **0** StockMovement; ningún stock ni valor cambia; **sin SaleItemCost**; COGS 0; SaleFinancial: grossProfit 2.101. Intentar crear StockLevel/ProductCost/StockMovement de un SERVICE falla |
| **G** | Presentación "Bolsa 500 g" ×2, producto a $16.000/kg | descuenta **1,000 kg**; bolsa proporcional $8.000; total $16.000, neto **13.445**, IVA **2.555** |
| **H** | Vender 1,5 bolsas y 2,3 bolsas | rechazado por el **servicio de ventas** y, si se salta el servicio, por el CHECK; nada se descuenta. **H2:** presentación de otro producto en SaleItem, PurchaseItem o ProductBarcode → rechazada (clave compuesta + CHECK) |
| **I** | Anulación de venta (con una compra posterior que cambió el promedio) | stock +cantidad; valor +**costo congelado**; movimiento SALE_VOID; venta VOIDED con motivo; segunda anulación rechazada; el vendedor no puede anular; SaleFinancial se conserva y la venta no suma en informes; no admite cargos nuevos |
| **J** | Anulación de compra. **J1** (último movimiento): vuelve a 10 kg / $50.000. **J2** (tras la venta C): bloqueada por defecto; en ADJUSTED retira $33.333, varianza **$16.667**, queda 9,920 kg / $66.134. **J3** (ya se vendieron 12 kg, quedan 3 < 5): bloqueada | stock, valor y movimientos cuadran en cada caso |
| **K** | Cuadratura | por producto: `StockLevel.quantity = Σ movimientos` y `inventoryValue = Σ valueChange`; falla ante cualquier diferencia |

**Nuevas por estos ajustes**

| ID | Escenario | Resultado esperado |
|---|---|---|
| **L1** | Cargo posterior de Mercado Libre. Venta $12.000 (neto 10.084, COGS 7.000, cargo al cierre 300, realProfit 2.784); luego el administrador agrega comisión $1.700 + envío asumido $900 | `totalCharges` 300 → **2.900**; `realProfit` 2.784 → **184**; `grossProfit` y `costOfGoodsSold` **sin cambio**; `SaleItemCost` sin cambio; los cargos anteriores siguen; 2 filas nuevas con usuario, fecha y `addedAfterClose = true`; `recalculatedAt` y `recalculatedById` actualizados; 1 entrada de AuditLog por recálculo con antes/después |
| **L2** | Un VENDEDOR intenta agregar un cargo posterior (por la aplicación y por SQL directo con su usuario) | rechazado por la acción del servidor y por el trigger |
| **L3** | Alterar `totalCharges` o `realProfit` sin cargo que lo respalde, o modificar `costOfGoodsSold`/`grossProfit` | el trigger diferido o el de inmutabilidad lo rechaza |
| **L4** | Anular un cargo con motivo; intentar borrarlo; intentar editar su monto | la anulación recalcula y audita; el borrado y la edición se rechazan; el cargo anulado sigue visible |
| **L5** | Agregar un cargo a una venta anulada | rechazado |
| **M1** | 3 líneas de $1.000 | neto de la venta **2.521**, IVA 479; líneas 841 + 840 + 840 = 2.521; Σ líneas = total exacto |
| **M2** | Propiedad: 200.000 ventas aleatorias (1 a 12 líneas, montos 1 a 200.000) | siempre Σ lineNet = netTotal, Σ lineVat = vatTotal, Σ lineTotal = total; cada línea difiere a lo más $1 de su redondeo individual |
| **M3** | Venta mezclada afecto y exento | el IVA se calcula solo sobre el total afecto; el exento suma íntegro al neto; cuadra exacto |
| **N1** | Venta con una línea sin producto (`productId` nulo) | rechazada por el esquema (obligatorio) y por el servicio |
| **N2** | Línea de producto inactivo o archivado | rechazada |
| **N3** | Vender "Envío", "Despacho" y otro servicio en una venta | las tres líneas quedan trazables a su Product SERVICE; ningún movimiento de stock |
| **O1** | Registrar dos veces factura n° 123 del mismo proveedor | la segunda se rechaza con mensaje claro (control del servicio), y por `documentKey` si hay concurrencia |
| **O2** | Mismo documento sin proveedor (`supplierId` nulo) con número | también se rechaza |
| **O3** | Mismo n° con otro tipo de documento, o de otro proveedor | permitido |
| **O4** | Anular la compra y registrar el documento corregido con el mismo n° | permitido (la anulada libera `documentKey`); n° con espacios o ceros a la izquierda cuenta como el mismo |
| **O5** | Dos registros simultáneos del mismo documento | solo uno se guarda |
| **P1** | Venta de Mercado Libre pagada con tarjeta | se crean `CHANNEL_COMMISSION` y `PAYMENT_FEE` en la misma venta; `totalCharges` es la suma; ninguna regla excluye a la otra |
| **P2** | Intentar crear una `FeeRule` con medio de pago y canal a la vez, o sin ninguno | rechazado (`fee_one_target`) |
| **P3** | Intentar cambiar `netTotal`, `costOfGoodsSold` o `grossProfit` de un `SaleFinancial` | rechazado; solo `totalCharges` y `realProfit` cambian, y solo con un cargo que los respalde y un AuditLog |

**De seguridad (vendedor).**
- Ninguna respuesta contiene `cost`, `inventoryValue`, `grossProfit`, `realProfit`, `totalCharges`, cargos, reglas de comisión ni márgenes.
- Solo obtiene sus ventas del día; las de otros vendedores o de otro día devuelven "no encontrado".
- No puede enviar precio, anular, ni agregar cargos.
