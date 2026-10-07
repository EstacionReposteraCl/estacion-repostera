-- Extraído tal cual de docs/reglas-y-pruebas.md (sección B) — APROBADO v0.5. NO editar aquí: editar el documento aprobado.
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
