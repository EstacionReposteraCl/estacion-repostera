#!/usr/bin/env python3
"""63 pruebas de las reglas SQL (reglas-y-pruebas.md) con FILAS COMPLETAS (todas las columnas NOT NULL y claves foráneas).
Se ejecutan contra la base indicada en PSQL_CMD. Dos usos:
  1) HOY: base `rules_derived` = DDL DERIVADO de schema.prisma (scripts/gen-derived-ddl.py) + prisma/sql/10_roles.sql + 20_reglas.sql.
     ⚠ NO es la migración de Prisma: este resultado NO cuenta como aprobación de la migración real.
  2) CUANDO EXISTA la migración real: el MISMO script contra esa base (cambiar solo PSQL_CMD).
Cada prueba corre en BEGIN … SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK."""
import subprocess, sys, os, re
PSQL = os.environ.get("PSQL_CMD", "psql -d rules_derived -v ON_ERROR_STOP=1 -q -f -").split()
BASE_PSQL = [x for x in PSQL if x not in ('-f', '-')]            # para consultas -At
def q(sql):
    r = subprocess.run(BASE_PSQL + ['-At', '-F', '|', '-c', sql], capture_output=True, text=True)
    if r.returncode: sys.exit('error de introspección: ' + r.stderr)
    return [l.split('|') for l in r.stdout.splitlines() if l]
# ---- introspección: columnas obligatorias sin default, FK y etiquetas de enum
REQ = {}; ENUM1 = {}; FK = {}
for t, c, dt, udt in q("select table_name,column_name,data_type,udt_name from information_schema.columns where table_schema='public' and is_nullable='NO' and column_default is null order by table_name,ordinal_position"):
    REQ.setdefault(t, []).append((c, dt, udt))
for tn, label in q("select t.typname, min(e.enumlabel) from pg_type t join pg_enum e on e.enumtypid=t.oid group by 1"): ENUM1[tn] = label
for t, c, rt in q("select cl.relname, a.attname, rcl.relname from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_class rcl on rcl.oid=con.confrelid join pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1] where con.contype='f' and array_length(con.conkey,1)=1"):
    FK[(t, c)] = rt
BASE_ID = {'branches': 'b1', 'users': 'adm', 'sale_channels': 'LOCAL', 'units': 'u1', 'products': 'pA', 'payment_methods': 'pm1'}
_n = [0]
def lit(v):
    if v is None: return 'NULL'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"
def ins(table, **kw):
    """INSERT con todas las columnas obligatorias: las no indicadas se completan (FK -> fila base; texto único por id; números 0)."""
    cols = dict(kw); _n[0] += 1
    for c, dt, udt in REQ[table]:
        if c in cols: continue
        if (table, c) in FK:
            if FK[(table, c)] not in BASE_ID: raise SystemExit(f'{table}.{c}: falta indicar la fila referenciada ({FK[(table, c)]})')
            cols[c] = BASE_ID[FK[(table, c)]]
        elif dt == 'USER-DEFINED': cols[c] = ENUM1[udt]
        elif dt in ('integer', 'bigint', 'numeric'): cols[c] = _n[0] if c in ('folio', 'seq', 'lineNumber') else 0
        elif dt == 'boolean': cols[c] = False
        elif dt.startswith('timestamp'): cols[c] = 'now()'
        elif dt == 'date': cols[c] = 'current_date'
        elif dt == 'jsonb': cols[c] = '{}'
        else: cols[c] = f'{table}.{c}.{cols.get("id", _n[0])}'
    vals = ['now()' if v == 'now()' and not isinstance(v, bool) else ('current_date' if v == 'current_date' else lit(v)) for v in cols.values()]
    return f'INSERT INTO {table}({",".join(chr(34)+c+chr(34) for c in cols)}) VALUES({",".join(vals)});'
def BASE():
    return ''.join([
        ins('users', id='adm', name='Admin', email='adm@x.cl', role='ADMINISTRADOR'), ins('users', id='sel', name='Vend', email='sel@x.cl', role='VENDEDOR'),
        ins('branches', id='b1', code='MAIN', name='Principal'), ins('units', id='u1', code='KG', name='Kilo', symbol='kg', dimension='MASS'),
        ins('sale_channels', id='LOCAL', code='LOCAL', name='Local'), ins('sale_channels', id='ML', code='ML', name='Mercado Libre'), ins('sale_channels', id='ch1', code='CH1', name='Otro'),
        ins('payment_methods', id='pm1', code='PM1', name='Pago 1'), ins('payment_methods', id='CARD', code='CARD', name='Tarjeta'),
        ins('products', id='pA', sku='pA', name='A', kind='GOODS', unitId='u1', salePrice=12000), ins('products', id='pB', sku='pB', name='B', kind='GOODS', unitId='u1', salePrice=12000),
        ins('products', id='sv', sku='sv', name='Envío', kind='SERVICE', unitId='u1', salePrice=2500),
        ins('product_presentations', id='presA', productId='pA', name='Bolsa 500 g', baseQuantity=0.5), ins('product_presentations', id='presB', productId='pB', name='Bolsa 500 g', baseQuantity=0.5)])
# ---- constructores (mismos nombres y firmas que pruebas-sql/run_tests.py)
def sale(i, total, net, vat, status='COMPLETED'):
    return ins('sales', id=i, status=status, netTotal=net, vatTotal=vat, total=total, voidReason=('motivo' if status == 'VOIDED' else None))
def item(i, s, p, total, net, vat, qty=1, pres=None, presp=None, basis='PER_BASE_UNIT', entered=None, pbq=None):
    return ins('sale_items', id=i, saleId=s, productId=p, presentationId=pres, presentationProductId=presp, presentationBaseQuantity=pbq, priceBasis=basis,
               enteredQuantity=(entered if entered is not None else qty), quantity=qty, lineTotal=total, lineNet=net, lineVat=vat)
def fin(s, net, cogs, gross, tc, real): return ins('sale_financials', id='f_' + s, saleId=s, netTotal=net, costOfGoodsSold=cogs, grossProfit=gross, totalCharges=tc, realProfit=real)
def chg(i, s, amt, by='sel', late='false', typ='PAYMENT_FEE'): return ins('sale_charges', id=i, saleId=s, type=typ, amount=amt, addedAfterClose=(late == 'true'), createdById=by)
def inv(qv, v, p='pA', b='b1'): return ins('stock_levels', id='sl_' + p, branchId=b, productId=p, quantity=qv) + ins('product_costs', id='pc_' + p, branchId=b, productId=p, inventoryValue=v)
def mov(i, p, typ, qv, b, a, note=None): return ins('stock_movements', id=i, branchId='b1', productId=p, type=typ, quantity=qv, quantityBefore=b, quantityAfter=a, note=note)
def pur(i, typ, num, key, net=100, vat=19, tot=119, st='CONFIRMED'): return ins('purchases', id=i, docType=typ, docNumber=num, status=st, documentKey=key, netAmount=net, vatAmount=vat, totalAmount=tot)
OK, FAIL = "ok", "fail"; T = []
def t(name, exp, sql, err=None): T.append((name, exp, sql, err))
# ---- Inventario
t("1  vender todo: stock 0 y valor 0", OK, inv(10, 50000) + "UPDATE stock_levels SET quantity=0; UPDATE product_costs SET \"inventoryValue\"=0;")
t("2  stock 0 con valor > 0 (invariante, diferido)", FAIL, inv(0, 5), "inconsistente")
t("3  stock negativo", FAIL, inv(-1, 0), "stock_nonneg")
t("4  valor negativo", FAIL, inv(5, -1), "value_nonneg")
t("5  vender todo el stock pero dejar valor residual", FAIL, inv(10, 50000) + "UPDATE stock_levels SET quantity=0; UPDATE product_costs SET \"inventoryValue\"=1;", "inconsistente")
t("6  movimiento con antes+cantidad ≠ después", FAIL, mov('m', 'pA', 'PURCHASE', 5, 10, 14), "mov_qty_math")
t("7  COST_CORRECTION con cantidad 0 y nota", OK, mov('m', 'pA', 'COST_CORRECTION', 0, 10, 10, 'corrección autorizada'))
t("8  COST_CORRECTION con cantidad ≠ 0", FAIL, mov('m', 'pA', 'COST_CORRECTION', 2, 10, 12, 'x'), "mov_cost_correction_qty")
t("9  ajuste sin nota", FAIL, mov('m', 'pA', 'ADJUSTMENT', -1, 10, 9), "mov_note_required")
t("10 merma con nota en blanco", FAIL, mov('m', 'pA', 'WASTE', -1, 10, 9, '   '), "mov_note_required")
# ---- Servicios
t("11 SERVICE con StockLevel", FAIL, ins('stock_levels', id='x', branchId='b1', productId='sv', quantity=0), "SERVICE")
t("12 SERVICE con ProductCost", FAIL, ins('product_costs', id='x', branchId='b1', productId='sv'), "SERVICE")
t("13 SERVICE con StockMovement", FAIL, mov('m', 'sv', 'SALE', -1, 1, 0), "SERVICE")
t("14 SERVICE con presentación", FAIL, ins('product_presentations', id='pp', productId='sv', baseQuantity=1), "SERVICE")
t("15 venta de SERVICE (Envío $2.500: neto 2.101, IVA 399) sin SaleItemCost", OK, sale('s', 2500, 2101, 399) + item('i', 's', 'sv', 2500, 2101, 399))
t("16 SaleItemCost para línea de SERVICE", FAIL, sale('s', 2500, 2101, 399) + item('i', 's', 'sv', 2500, 2101, 399) + ins('sale_item_costs', id='c', saleItemId='i', lineCost=0), "SERVICE")
t("17 SaleItemCost para línea de producto GOODS", OK, sale('s', 960, 807, 153) + item('i', 's', 'pA', 960, 807, 153, qty=0.08) + ins('sale_item_costs', id='c', saleItemId='i', lineCost=533))
# ---- Presentaciones
t("18 2 bolsas de 500 g = 1,000 kg ($16.000: neto 13.445, IVA 2.555)", OK, sale('s', 16000, 13445, 2555) + item('i', 's', 'pA', 16000, 13445, 2555, qty=1.0, pres='presA', presp='pA', basis='PER_PRESENTATION', entered=2, pbq=0.5))
t("19 1,5 bolsas", FAIL, sale('s', 12000, 10084, 1916) + item('i', 's', 'pA', 12000, 10084, 1916, qty=0.75, pres='presA', presp='pA', basis='PER_PRESENTATION', entered=1.5, pbq=0.5), "si_packs_integer")
t("20 2,3 bolsas", FAIL, sale('s', 12000, 10084, 1916) + item('i', 's', 'pA', 12000, 10084, 1916, qty=1.15, pres='presA', presp='pA', basis='PER_PRESENTATION', entered=2.3, pbq=0.5), "si_packs_integer")
t("21 2 bolsas pero cantidad base ≠ 2 × 0,5", FAIL, sale('s', 16000, 13445, 2555) + item('i', 's', 'pA', 16000, 13445, 2555, qty=0.5, pres='presA', presp='pA', basis='PER_PRESENTATION', entered=2, pbq=0.5), "si_packs_integer")
t("22 Producto A + presentación del producto B (columna declarada = B)", FAIL, sale('s', 100, 84, 16) + item('i', 's', 'pA', 100, 84, 16, pres='presB', presp='pB'), "si_pres_ok")
t("23 Producto A + presentación de B (declarando A)", FAIL, sale('s', 100, 84, 16) + item('i', 's', 'pA', 100, 84, 16, pres='presB', presp='pA'), "foreign key")
t("24 Código de barras: producto A con presentación de B", FAIL, ins('product_barcodes', id='bc', productId='pA', presentationId='presB', presentationProductId='pA'), "foreign key")
t("25 Compra: producto A con presentación de B", FAIL, pur('p', 'FACTURA', '1', 'k1') + ins('purchase_items', id='pi', purchaseId='p', productId='pA', presentationId='presB', presentationProductId='pB', enteredQuantity=1, quantity=1, lineNet=100, lineVat=19, lineTotal=119, costBasis=100), "pi_pres_ok")
t("26 Compra con presentación en cantidad no entera", FAIL, pur('p', 'FACTURA', '1', 'k1') + ins('purchase_items', id='pi', purchaseId='p', productId='pA', presentationId='presA', presentationProductId='pA', enteredQuantity=1.5, quantity=0.75, lineNet=100, lineVat=19, lineTotal=119, costBasis=100), "pi_packs_integer")
t("27 presentación con contenido 0", FAIL, ins('product_presentations', id='pz', productId='pA', name='cero', baseQuantity=0), "pp_qty_pos")
# ---- IVA
t("28 3 líneas de $1.000: neto 2.521 = 841+840+840", OK, sale('s', 3000, 2521, 479) + item('i1', 's', 'pA', 1000, 841, 159) + item('i2', 's', 'pA', 1000, 840, 160) + item('i3', 's', 'pA', 1000, 840, 160))
t("29 mismo caso redondeando cada línea (840×3 = 2.520)", FAIL, sale('s', 3000, 2521, 479) + item('i1', 's', 'pA', 1000, 840, 160) + item('i2', 's', 'pA', 1000, 840, 160) + item('i3', 's', 'pA', 1000, 840, 160), "no coincide")
t("30 venta con neto + IVA ≠ total", FAIL, sale('s', 3000, 2521, 478), "sale_sum")
t("31 línea con neto + IVA ≠ total", FAIL, sale('s', 1000, 840, 160) + item('i', 's', 'pA', 1000, 840, 159), "si_line_sum")
t("32 suma de totales de líneas ≠ total de la venta", FAIL, sale('s', 2000, 1681, 319) + item('i', 's', 'pA', 1000, 840, 160), "no coincide")
# ---- SaleFinancial y cargos
base = sale('s', 960, 807, 153)
t("33 resultado congelado (C): bruta 274, cargos 14, real 260", OK, base + chg('c1', 's', 14) + fin('s', 807, 533, 274, 14, 260))
t("34 grossProfit ≠ netTotal − costo", FAIL, base + fin('s', 807, 533, 300, 0, 300), "sf_gross")
t("35 realProfit ≠ grossProfit − totalCharges", FAIL, base + chg('c1', 's', 14) + fin('s', 807, 533, 274, 14, 259), "sf_real")
t("36 SaleFinancial.netTotal ≠ Sale.netTotal", FAIL, base + fin('s', 800, 526, 274, 0, 274), "no coincide con Sale")
t("37 cambiar costOfGoodsSold y grossProfit coherentes", FAIL, base + fin('s', 807, 533, 274, 0, 274) + "UPDATE sale_financials SET \"costOfGoodsSold\"=600,\"grossProfit\"=207,\"realProfit\"=207;", "no se modifican")
ml = sale('s', 12000, 10084, 1916) + chg('c0', 's', 300) + fin('s', 10084, 7000, 3084, 300, 2784)
t("38 cargo posterior ADMIN + recálculo: totalCharges 2.900, real 184", OK, ml + chg('c1', 's', 1700, 'adm', 'true', 'CHANNEL_COMMISSION') + chg('c2', 's', 900, 'adm', 'true', 'SHIPPING_COST') + "UPDATE sale_financials SET \"totalCharges\"=2900,\"realProfit\"=184,\"recalculatedAt\"=now(),\"recalculatedById\"='adm';")
t("39 cargo posterior de un VENDEDOR", FAIL, ml + chg('c1', 's', 1700, 'sel', 'true', 'CHANNEL_COMMISSION'), "ADMINISTRADOR")
t("40 cargo posterior sin recalcular SaleFinancial", FAIL, ml + chg('c1', 's', 1700, 'adm', 'true', 'CHANNEL_COMMISSION'), "totalCharges no coincide")
t("41 cambiar totalCharges sin un cargo que lo respalde", FAIL, ml + "UPDATE sale_financials SET \"totalCharges\"=999,\"realProfit\"=2085;", "totalCharges no coincide")
t("42b venta anulada sin motivo (NULL)", FAIL, ins('sales', id='s', status='VOIDED', netTotal=1, vatTotal=0, total=1), "sale_void_reason")
t("42 cargo posterior en venta anulada", FAIL, sale('s', 12000, 10084, 1916, 'VOIDED') + chg('c1', 's', 100, 'adm', 'true'), "anulada")
t("43 comisión de canal + comisión de medio de pago a la vez (ML + tarjeta)", OK, sale('s', 12000, 10084, 1916) + chg('c1', 's', 1700, 'sel', 'false', 'CHANNEL_COMMISSION') + chg('c2', 's', 300, 'sel', 'false', 'PAYMENT_FEE') + fin('s', 10084, 7000, 3084, 2000, 1084))
t("44 anular un cargo (app_user) y recalcular", OK, ml + chg('c1', 's', 1700, 'adm', 'true', 'CHANNEL_COMMISSION') + "UPDATE sale_financials SET \"totalCharges\"=2000,\"realProfit\"=1084;SET LOCAL ROLE app_user; UPDATE sale_charges SET \"voidedAt\"=now(),\"voidedById\"='adm',\"voidReason\"='error' WHERE id='c1'; UPDATE sale_financials SET \"totalCharges\"=300,\"realProfit\"=2784; RESET ROLE;")
t("45 anular un cargo sin recalcular", FAIL, ml + chg('c1', 's', 1700, 'adm', 'true', 'CHANNEL_COMMISSION') + "UPDATE sale_financials SET \"totalCharges\"=2000,\"realProfit\"=1084;SET LOCAL ROLE app_user; UPDATE sale_charges SET \"voidedAt\"=now(),\"voidedById\"='adm',\"voidReason\"='error' WHERE id='c1'; RESET ROLE;", "totalCharges no coincide")
t("46 borrar un cargo (app_user)", FAIL, ml + "SET LOCAL ROLE app_user; DELETE FROM sale_charges WHERE id='c0';", "permission denied")
t("47 editar el monto de un cargo (app_user)", FAIL, ml + "SET LOCAL ROLE app_user; UPDATE sale_charges SET amount=1 WHERE id='c0';", "permission denied")
t("48 modificar SaleItemCost (app_user)", FAIL, sale('s', 960, 807, 153) + item('i', 's', 'pA', 960, 807, 153) + ins('sale_item_costs', id='c', saleItemId='i', lineCost=533) + "SET LOCAL ROLE app_user; UPDATE sale_item_costs SET \"lineCost\"=1;", "permission denied")
t("49 borrar un movimiento de stock (app_user)", FAIL, mov('m', 'pA', 'PURCHASE', 5, 0, 5) + "SET LOCAL ROLE app_user; DELETE FROM stock_movements;", "permission denied")
t("50 editar auditoría (app_user)", FAIL, ins('audit_logs', id='a', action='x', entity='Sale') + "SET LOCAL ROLE app_user; UPDATE audit_logs SET action='y';", "permission denied")
# ---- Compras
t("51 factura con documentKey", OK, pur('p', 'FACTURA', '123', 'sup1|FACTURA|123'))
t("52 mismo documento dos veces (concurrencia)", FAIL, pur('p1', 'FACTURA', '123', 'sup1|FACTURA|123') + pur('p2', 'FACTURA', '123', 'sup1|FACTURA|123'), "duplicate key")
t("53 mismo documento sin proveedor", FAIL, pur('p1', 'BOLETA', '55', '-|BOLETA|55') + pur('p2', 'BOLETA', '55', '-|BOLETA|55'), "duplicate key")
t("54 mismo n° con otro tipo o proveedor", OK, pur('p1', 'FACTURA', '123', 'sup1|FACTURA|123') + pur('p2', 'BOLETA', '123', 'sup1|BOLETA|123') + pur('p3', 'FACTURA', '123', 'sup2|FACTURA|123'))
t("55 compra anulada libera el documento", OK, pur('p1', 'FACTURA', '123', None, st='VOIDED') + pur('p2', 'FACTURA', '123', 'sup1|FACTURA|123'))
t("56 compra anulada que conserva documentKey", FAIL, pur('p1', 'FACTURA', '123', 'sup1|FACTURA|123', st='VOIDED'), "pur_key_state")
t("57 compra confirmada con n° pero sin documentKey", FAIL, pur('p1', 'FACTURA', '123', None), "pur_key_present")
t("58 factura sin número", FAIL, pur('p1', 'FACTURA', None, None), "pur_doc_required")
t("59 neto + IVA ≠ total en la compra", FAIL, pur('p1', 'OTRO', None, None, 100, 19, 120), "pur_sum")
# ---- FeeRule
t("60 FeeRule con medio de pago Y canal", FAIL, ins('fee_rules', id='r', paymentMethodId='pm1', channelId='ch1'), "fee_one_target")
t("61 FeeRule sin destino", FAIL, ins('fee_rules', id='r', paymentMethodId=None, channelId=None), "fee_one_target")
t("62 regla de canal + regla de medio de pago coexisten", OK, ins('fee_rules', id='r1', paymentMethodId=None, channelId='ML') + ins('fee_rules', id='r2', paymentMethodId='CARD', channelId=None))
if __name__ == '__main__':
    bad = 0; base_sql = BASE()
    for name, exp, sql, err in T:
        r = subprocess.run(PSQL, input="BEGIN;\n" + base_sql + "\n" + sql + "\nSET CONSTRAINTS ALL IMMEDIATE;\nROLLBACK;\n", capture_output=True, text=True)
        got = OK if r.returncode == 0 else FAIL
        good = (got == exp) and (exp == OK or err is None or err.lower() in r.stderr.lower())
        if not good: bad += 1; print("✗", name, "| esperado", exp, "obtuvo", got, "|", r.stderr.strip().replace("\n", " ")[:260])
        else: print("✓", name)
    print(f"\n{len(T)-bad}/{len(T)} correctas  (base: {' '.join(PSQL)})"); sys.exit(1 if bad else 0)
