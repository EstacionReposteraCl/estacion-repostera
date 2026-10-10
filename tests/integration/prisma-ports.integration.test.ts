// Servicios REALES + repositorios Prisma contra PostgreSQL con la migración real y el rol app_user (como en producción).
// Preparar: scripts/setup-it-db.sh  ·  Ejecutar: npm run test:integration
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '../../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { createPrismaPorts } from '../../src/repositories/prisma/index.ts';
import { createServices } from '../../src/services/composition.ts';
import { AppError } from '../../src/core/errors/index.ts';
import type { Actor } from '../../src/core/permissions/permissions.ts';

const URL_APP = process.env.IT_DATABASE_URL ?? 'postgresql://app_user:AppDev2026@localhost:5432/estacion_repostera_it';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL_APP }) });
const db2 = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL_APP }) });   // segunda conexión real (concurrencia)
const svc = createServices(createPrismaPorts(db));
const svc2 = createServices(createPrismaPorts(db2));
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e instanceof AppError ? e.code : 'OTHER:' + (e as Error).message.slice(0, 160); } return 'NONE'; };
let admin: Actor, seller: Actor, ids: Record<string, string> = {};
const run = Date.now().toString(36);

before(async () => {
  const branch = await db.branch.findFirstOrThrow({ where: { isMain: true } });
  const a = await db.user.create({ data: { id: `adm-${run}`, name: 'Admin IT', email: `adm-${run}@it.cl`, role: 'ADMINISTRADOR' } });
  const s = await db.user.create({ data: { id: `sel-${run}`, name: 'Vend IT', email: `sel-${run}@it.cl`, role: 'VENDEDOR' } });
  admin = { userId: a.id, role: 'ADMINISTRADOR', email: a.email, branchId: branch.id, banned: false };
  seller = { userId: s.id, role: 'VENDEDOR', email: s.email, branchId: branch.id, banned: false };
  for (const c of ['LOCAL', 'MERCADO_LIBRE']) ids[c] = (await db.saleChannel.findUniqueOrThrow({ where: { code: c } })).id;
  for (const c of ['DEBIT', 'CASH']) ids[c] = (await db.paymentMethod.findUniqueOrThrow({ where: { code: c } })).id;
  await db.feeRule.update({ where: { paymentMethodId: ids.DEBIT }, data: { percent: '1.500', isManualPerSale: false } });
});
after(async () => { await db.$disconnect(); await db2.$disconnect(); });

test('productos: crear, SKU/código duplicados, búsqueda por código, precio auditado, archivar y restaurar', async () => {
  const cat = await db.category.create({ data: { name: `Chocolates ${run}` } });
  const p = await svc.products.save(admin, { sku: `CH-${run}`, name: `Chocolate IT ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 5990, vatTreatment: 'AFECTO', categoryId: cat.id, brand: 'Caravella', barcodes: [`78${run}`] });
  ids.prod = p.id;
  assert.equal(await code(svc.products.save(admin, { sku: `CH-${run}`, name: 'otro', unitCode: 'UN', kind: 'GOODS', salePrice: 1, vatTreatment: 'AFECTO' })), 'VALIDATION');
  assert.equal(await code(svc.products.save(admin, { sku: `X-${run}`, name: 'otro', unitCode: 'UN', kind: 'GOODS', salePrice: 1, vatTreatment: 'AFECTO', barcodes: [`78${run}`] })), 'VALIDATION');
  const byCode = await svc.products.search(seller, `78${run}`);
  assert.equal(byCode[0].id, p.id); assert.equal(byCode[0].stock, '0.000');
  assert.ok(!('avgCost' in byCode[0]) && !('inventoryValue' in byCode[0]), 'el vendedor no ve costos');
  await svc.products.save(admin, { id: p.id, sku: `CH-${run}`, name: `Chocolate IT ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 6490, vatTreatment: 'AFECTO', categoryId: cat.id, brand: 'Caravella', barcodes: [`78${run}`, `79${run}`] });
  const a = await svc.products.getAdmin(admin, p.id);
  assert.equal(a.salePrice, 6490); assert.deepEqual(a.barcodes.sort(), [`78${run}`, `79${run}`]); assert.equal(a.brand, 'Caravella'); assert.equal(a.category, cat.name);
  assert.equal(await db.auditLog.count({ where: { action: 'product.price_change', entityId: p.id } }), 1);
  const list = await svc.products.listAdmin(admin, { q: `Chocolate IT ${run}` }); assert.equal(list.total, 1);
  assert.equal(await code(svc.products.listAdmin(seller, {})), 'FORBIDDEN');
  const tmp = await svc.products.save(admin, { sku: `TMP-${run}`, name: `Temporal ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 100, vatTreatment: 'AFECTO' });
  await svc.products.archive(admin, tmp.id, 'prueba');
  assert.equal((await svc.products.search(seller, `Temporal ${run}`)).length, 0);
  await svc.products.restore(admin, tmp.id);
  assert.equal((await svc.products.search(seller, `Temporal ${run}`)).length, 1);
});

test('inventario: saldo inicial y un segundo saldo inicial se rechaza', async () => {
  await svc.inventory.openingBalance(admin, { productId: ids.prod, qty: '10', totalValue: 30000 });
  assert.equal((await svc.inventory.stockOf(seller, ids.prod)).qty, '10.000');
  assert.equal(await code(svc.inventory.openingBalance(admin, { productId: ids.prod, qty: '1', totalValue: 1 })), 'BUSINESS_RULE');
  const a = await svc.products.getAdmin(admin, ids.prod); assert.equal(a.inventoryValue, 30000); assert.equal(a.avgCost, '3000.00');
});

test('compras: factura suma stock y valor; duplicado bloqueado; anulación EXACT revierte', async () => {
  const sup = await db.supplier.create({ data: { name: `Prov ${run}` } });
  const r = await svc.purchases.register(admin, { supplierId: sup.id, docType: 'FACTURA', docNumber: `F-${run}`, docDate: '2026-10-01', pricesIncludeVat: false, lines: [{ productId: ids.prod, quantity: '5', unitCost: 3600 }] });
  assert.equal((await svc.inventory.stockOf(admin, ids.prod)).qty, '15.000');
  assert.equal((await svc.products.getAdmin(admin, ids.prod)).inventoryValue, 48000);
  assert.equal(await code(svc.purchases.register(admin, { supplierId: sup.id, docType: 'FACTURA', docNumber: ` f-${run} `, docDate: '2026-10-01', pricesIncludeVat: false, lines: [{ productId: ids.prod, quantity: '1', unitCost: 1 }] })), 'DUPLICATE_DOCUMENT');
  await svc.purchases.void(admin, r.id, { adjusted: false, reason: 'error de digitación' });
  assert.equal((await svc.inventory.stockOf(admin, ids.prod)).qty, '10.000');
  assert.equal((await svc.products.getAdmin(admin, ids.prod)).inventoryValue, 30000);
});

test('ventas: cierre con comisión de débito, costo congelado, idempotencia, sin stock revierte todo', async () => {
  const sale = { lines: [{ productId: ids.prod, quantity: '2' }], channelId: ids.LOCAL, payments: [{ methodId: ids.DEBIT, amount: 12980 }], idempotencyKey: `k1-${run}` };
  const s = await svc.sales.closeSale(seller, sale);
  assert.equal(s.total, 12980); assert.equal(s.subtotal + s.vat, 12980); assert.ok(s.folio >= 1);
  assert.equal((await svc.inventory.stockOf(seller, ids.prod)).qty, '8.000');
  const fin = await svc.sales.getSaleFinancial(admin, s.id);
  assert.equal(fin.financial.costOfGoodsSold, 6000); assert.equal(fin.charges.length, 1); assert.equal(fin.charges[0].amount, 195);   // 1,5 % de 12.980
  assert.equal(fin.financial.realProfit, fin.financial.netTotal - 6000 - 195);
  const again = await svc.sales.closeSale(seller, sale); assert.equal(again.id, s.id);                                   // reintento idéntico
  assert.equal(await code(svc.sales.closeSale(seller, { ...sale, payments: [{ methodId: ids.CASH, amount: 12980 }] })), 'CONFLICT');
  assert.equal(await db.auditLog.count({ where: { action: 'sale.idempotency_conflict', entityId: s.id } }), 1);
  const before = await db.sale.count();
  assert.equal(await code(svc.sales.closeSale(seller, { lines: [{ productId: ids.prod, quantity: '99' }], channelId: ids.LOCAL, payments: [{ methodId: ids.CASH, amount: 642510 }], idempotencyKey: `k2-${run}` })), 'INSUFFICIENT_STOCK');
  assert.equal(await db.sale.count(), before, 'no quedó venta a medias'); assert.equal((await svc.inventory.stockOf(seller, ids.prod)).qty, '8.000');
  assert.equal(await code(svc.sales.getSaleFinancial(seller, s.id)), 'FORBIDDEN');
  ids.sale = s.id;
});

test('ventas: cargo posterior y su anulación recalculan; anular la venta restaura el costo congelado', async () => {
  await svc.sales.addLateCharge(admin, ids.sale, { type: 'SHIPPING_COST', amount: 2500, reason: 'envío asumido' });
  let fin = await svc.sales.getSaleFinancial(admin, ids.sale); assert.equal(fin.financial.totalCharges, 2695);
  const late = fin.charges.find((c) => c.addedAfterClose)!;
  await svc.sales.voidCharge(admin, late.id, ids.sale, 'no correspondía');
  fin = await svc.sales.getSaleFinancial(admin, ids.sale); assert.equal(fin.financial.totalCharges, 195);
  assert.equal(await code(svc.sales.voidSale(seller, ids.sale, 'x')), 'FORBIDDEN');
  await svc.sales.voidSale(admin, ids.sale, 'cliente se arrepintió');
  assert.equal((await svc.inventory.stockOf(admin, ids.prod)).qty, '10.000');
  assert.equal((await svc.products.getAdmin(admin, ids.prod)).inventoryValue, 30000);
  assert.equal(await code(svc.sales.addLateCharge(admin, ids.sale, { type: 'OTHER', amount: 1, reason: 'x' })), 'BUSINESS_RULE');
  const rec = await svc.inventory.reconcile(admin, ids.prod); assert.deepEqual(rec, { ok: true, errors: [] });
});

test('concurrencia real (prueba E): dos conexiones venden las últimas unidades a la vez → una sola gana, stock nunca negativo', async () => {
  const p = await svc.products.save(admin, { sku: `LAST-${run}`, name: `Última unidad ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 1000, vatTreatment: 'AFECTO' });
  await svc.inventory.openingBalance(admin, { productId: p.id, qty: '3', totalValue: 1000 });
  const mk = (k: string) => ({ lines: [{ productId: p.id, quantity: '2' }], channelId: ids.LOCAL, payments: [{ methodId: ids.CASH, amount: 2000 }], idempotencyKey: `${k}-${run}` });
  const res = await Promise.all([code(svc.sales.closeSale(seller, mk('c1'))), code(svc2.sales.closeSale(admin, mk('c2')))]);
  assert.deepEqual(res.sort(), ['INSUFFICIENT_STOCK', 'NONE']);
  assert.equal((await svc.inventory.stockOf(admin, p.id)).qty, '1.000');
  // misma clave desde dos conexiones: una sola venta
  const same = mk('same'); same.lines[0].quantity = '1'; same.payments[0].amount = 1000;
  const r2 = await Promise.all([svc.sales.closeSale(seller, same).then((x) => x.id, (e) => 'ERR:' + e.code), svc2.sales.closeSale(seller, same).then((x) => x.id, (e) => 'ERR:' + e.code)]);
  assert.equal(await db.sale.count({ where: { idempotencyKey: `same-${run}` } }), 1, JSON.stringify(r2));
  assert.equal(r2[0], r2[1], 'ambas peticiones reciben la MISMA venta (no un error): ' + JSON.stringify(r2));
  assert.equal((await svc.inventory.stockOf(admin, p.id)).qty, '0.000');
  assert.equal((await svc.products.getAdmin(admin, p.id)).inventoryValue, 0, 'la última salida se lleva todo el valor');
  assert.deepEqual(await svc.inventory.reconcile(admin, p.id), { ok: true, errors: [] });
});

test('reportes y folios: vendedor ve solo conteo/total de hoy; folios consecutivos sin repetir', async () => {
  const r = await svc.reports.sellerToday(seller); assert.ok(r.count >= 1 && typeof r.total === 'number');
  assert.deepEqual(Object.keys(r).sort(), ['count', 'total']);
  const folios = (await db.sale.findMany({ select: { folio: true } })).map((s) => s.folio);
  assert.equal(new Set(folios).size, folios.length);
  const mine = await svc.sales.listSales(seller); assert.ok(mine.every((x) => x.status === 'COMPLETED' || x.status === 'VOIDED'));
});

test('ventas (pantallas): opciones de caja, listado del admin con vendedor/pagos y datos del comprobante con alcance del vendedor', async () => {
  const o = await svc.sales.posOptions(seller);
  assert.ok(o.channels.some((c) => c.code === 'LOCAL') && o.methods.some((m) => m.code === 'CASH'));
  const p = await svc.products.save(admin, { sku: `POS-${run}`, name: `Caja ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 2000, vatTreatment: 'AFECTO' });
  await svc.inventory.openingBalance(admin, { productId: p.id, qty: '5', totalValue: 5000 });
  const s = await svc.sales.closeSale(seller, { lines: [{ productId: p.id, quantity: '2' }], channelId: ids.LOCAL, payments: [{ methodId: ids.DEBIT, amount: 1000 }, { methodId: ids.CASH, amount: 3000 }], idempotencyKey: `pos-${run}` });
  const list = await svc.sales.listAdmin(admin, {});
  const row = list.rows.find((r) => r.id === s.id)!;
  assert.equal(row.seller, 'Vend IT'); assert.deepEqual(row.payments.map((x) => x.amount), [1000, 3000]);
  assert.ok(list.totals.total >= 4000);
  assert.equal(await code(svc.sales.listAdmin(seller, {})), 'FORBIDDEN');
  const meta = await svc.sales.metaForActor(seller, s.id); assert.equal(meta.channel, 'Local'); assert.equal(meta.payments.length, 2);
  const other = await db.user.create({ data: { id: `sel2-${run}`, name: 'Otro', email: `sel2-${run}@it.cl`, role: 'VENDEDOR' } });
  assert.equal(await code(svc.sales.metaForActor({ ...seller, userId: other.id }, s.id)), 'NOT_FOUND', 'otro vendedor no ve la venta');
  const fin = await svc.sales.getSaleFinancial(admin, s.id);
  assert.equal(fin.charges.find((c) => c.type === 'PAYMENT_FEE')?.amount, 15, '1,5 % solo sobre la parte pagada con débito');
});

test('configuración: datos del negocio, comisión de canal automática que se aplica a la venta siguiente y canal inactivo bloquea la caja', async () => {
  const o = await svc.settings.overview(admin);
  assert.ok(o.feeRules.some((r) => r.target === 'CHANNEL' && r.targetCode === 'MERCADO_LIBRE'));
  await svc.settings.updateBusiness(admin, { legalName: `Estación Repostera ${run}`, taxId: '78485985-1', receiptFooter: 'Gracias' });
  assert.equal((await svc.settings.overview(admin)).business.taxId, '78.485.985-1');
  await svc.settings.saveFeeRule(admin, { target: 'CHANNEL', targetId: ids.MERCADO_LIBRE, percent: '13', fixedAmount: 700, isManualPerSale: false, isActive: true });
  const p = await svc.products.save(admin, { sku: `ML-${run}`, name: `ML ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 10000, vatTreatment: 'AFECTO' });
  await svc.inventory.openingBalance(admin, { productId: p.id, qty: '2', totalValue: 8000 });
  const s = await svc.sales.closeSale(admin, { lines: [{ productId: p.id, quantity: '1' }], channelId: ids.MERCADO_LIBRE, payments: [{ methodId: ids.CASH, amount: 10000 }], idempotencyKey: `ml-${run}`, externalRef: `ML-${run}` });
  assert.equal(s.issuer.legalName, `Estación Repostera ${run}`, 'el comprobante nuevo usa los datos nuevos');
  const fin = await svc.sales.getSaleFinancial(admin, s.id);
  assert.deepEqual(fin.charges.map((c) => [c.type, c.amount]).sort(), [['CHANNEL_COMMISSION', 1300], ['CHANNEL_FIXED_FEE', 700]]);
  assert.equal(await db.auditLog.count({ where: { action: { in: ['settings.business', 'feerule.update'] } } }) >= 2, true);
  await svc.settings.saveFeeRule(admin, { target: 'CHANNEL', targetId: ids.MERCADO_LIBRE, percent: '0', fixedAmount: 0, isManualPerSale: true, isActive: true });
  await svc.settings.updateEntry(admin, 'channel', ids.MERCADO_LIBRE, { name: 'Mercado Libre', isActive: false });
  assert.equal(await code(svc.sales.closeSale(admin, { lines: [{ productId: p.id, quantity: '1' }], channelId: ids.MERCADO_LIBRE, payments: [{ methodId: ids.CASH, amount: 10000 }], idempotencyKey: `ml2-${run}` })), 'BUSINESS_RULE');
  assert.ok(!(await svc.sales.posOptions(seller)).channels.some((c) => c.id === ids.MERCADO_LIBRE));
  await svc.settings.updateEntry(admin, 'channel', ids.MERCADO_LIBRE, { name: 'Mercado Libre', isActive: true });
  assert.equal(await code(svc.settings.overview(seller)), 'FORBIDDEN');
});

test('compras (pantallas): proveedor con RUT único, listado con totales, detalle con costo unitario derivado; anulación ajustada con varianza', async () => {
  const sup = await svc.purchases.saveSupplier(admin, { name: `Distribuidora ${run}`, taxId: '76.086.428-5' }).catch(async () => (await svc.purchases.suppliers(admin, true)).find((s) => s.taxId === '76.086.428-5')!);
  assert.equal(await code(svc.purchases.saveSupplier(admin, { name: 'Copia', taxId: '76086428-5' })), 'VALIDATION', 'RUT de proveedor no se repite');
  assert.equal(await code(svc.purchases.saveSupplier(admin, { name: 'Malo', taxId: '76086428-4' })), 'VALIDATION', 'dígito verificador');
  assert.equal(await code(svc.purchases.suppliers(seller)), 'FORBIDDEN');
  const p = await svc.products.save(admin, { sku: `PC-${run}`, name: `Compra ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 3000, vatTreatment: 'AFECTO' });
  const r = await svc.purchases.register(admin, { supplierId: sup.id, docType: 'BOLETA', docNumber: `B-${run}`, docDate: '2026-10-02', pricesIncludeVat: true, lines: [{ productId: p.id, quantity: '6', lineAmount: 11900 }] });
  const d = await svc.purchases.detail(admin, r.id);
  assert.equal(d.items[0].costBasis, 11900, 'boleta: el costo es el total pagado'); assert.equal(d.unitCosts[0], '1983.33'); assert.equal(d.supplier, (sup as { name: string }).name);
  const list = await svc.purchases.list(admin, { from: '2026-10-01', to: '2026-10-31', supplierId: sup.id });
  assert.ok(list.rows.some((x) => x.id === r.id && x.items === 1)); assert.ok(list.totals.total >= 11900);
  // venta posterior => la anulación exacta queda bloqueada y la ajustada calcula varianza
  await svc.sales.closeSale(seller, { lines: [{ productId: p.id, quantity: '1' }], channelId: ids.LOCAL, payments: [{ methodId: ids.CASH, amount: 3000 }], idempotencyKey: `pc-${run}` });
  const exact = await svc.purchases.previewVoid(admin, r.id, false); assert.equal(exact.status, 'blocked');
  assert.equal(exact.status === 'blocked' && exact.reason, 'STOCK_BELOW_PURCHASED', 'se vendió parte: nunca se puede anular');
  const p2 = await svc.products.save(admin, { sku: `PC2-${run}`, name: `Compra2 ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 3000, vatTreatment: 'AFECTO' });
  const r2 = await svc.purchases.register(admin, { docType: 'OTRO', docDate: '2026-10-02', pricesIncludeVat: true, lines: [{ productId: p2.id, quantity: '3', lineAmount: 3000 }] });
  await svc.purchases.register(admin, { docType: 'OTRO', docDate: '2026-10-03', pricesIncludeVat: true, lines: [{ productId: p2.id, quantity: '3', lineAmount: 6000 }] });
  const adj = await svc.purchases.previewVoid(admin, r2.id, true);
  assert.equal(adj.status, 'ok'); assert.equal(adj.status === 'ok' && adj.mode, 'ADJUSTED'); assert.equal(adj.status === 'ok' && adj.totalVariance, -1500, '3.000 − retiro a promedio 4.500');
  await svc.purchases.void(admin, r2.id, { reason: 'devuelta al proveedor', adjusted: true });
  const after = await svc.products.getAdmin(admin, p2.id); assert.equal(after.stock, '3.000'); assert.equal(after.inventoryValue, 4500);
  assert.deepEqual(await svc.inventory.reconcile(admin, p2.id), { ok: true, errors: [] });
});

test('reportes: el desglose por día, vendedor, canal y producto cuadra con los totales; anuladas fuera; solo ADMINISTRADOR', async () => {
  const d = await svc.reports.today(admin);
  const r = await svc.reports.overview(admin, { from: d, to: d });
  const sum = (xs: { net: number }[]) => xs.reduce((a, x) => a + x.net, 0);
  assert.ok(r.totals.sales > 0);
  assert.equal(sum(r.breakdown.byDay), r.totals.netTotal); assert.equal(sum(r.breakdown.bySeller), r.totals.netTotal); assert.equal(sum(r.breakdown.byChannel), r.totals.netTotal);
  assert.equal(sum(r.breakdown.byProduct), r.totals.netTotal, 'Σ neto por producto = neto del período');
  assert.equal(r.breakdown.byProduct.reduce((a, x) => a + x.cost, 0), r.totals.costOfGoodsSold, 'Σ costo por producto = costo vendido');
  assert.equal(r.breakdown.charges.reduce((a, x) => a + x.amount, 0), r.totals.totalCharges, 'Σ cargos vigentes = cargos del período');
  const paid = r.breakdown.byPayment.reduce((a, x) => a + x.amount, 0); const tot = r.breakdown.byDay.reduce((a, x) => a + x.total, 0); assert.equal(paid, tot, 'Σ pagos = Σ totales');
  assert.ok(r.breakdown.voided.count >= 1, 'hay anuladas y no se suman');
  assert.ok(r.inventory.inventoryValue > 0 && r.inventory.productsWithStock > 0);
  assert.equal(await code(svc.reports.overview(seller, { from: d, to: d })), 'FORBIDDEN');
  assert.equal(await code(svc.reports.overview(admin, { from: d, to: '2000-01-01' })), 'VALIDATION');
});

test('Rappi: medio de pago nuevo + precio manual del ADMINISTRADOR (auditado); comisión del canal sobre el precio real; vendedor no puede', async () => {
  const pm = await svc.settings.createEntry(admin, 'paymentMethod', 'Rappi').catch(async () => (await svc.settings.overview(admin)).paymentMethods.find((m) => m.code === 'RAPPI')!);
  assert.equal(pm.code, 'RAPPI'); assert.ok((await svc.sales.posOptions(seller)).methods.some((m) => m.code === 'RAPPI'));
  const rappi = (await db.saleChannel.findUniqueOrThrow({ where: { code: 'RAPPI' } })).id;
  await svc.settings.saveFeeRule(admin, { target: 'CHANNEL', targetId: rappi, percent: '20', fixedAmount: 0, isManualPerSale: false, isActive: true });
  const p = await svc.products.save(admin, { sku: `RP-${run}`, name: `Rappi ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 5000, vatTreatment: 'AFECTO' });
  await svc.inventory.openingBalance(admin, { productId: p.id, qty: '3', totalValue: 6000 });
  const line = { productId: p.id, quantity: '1', manualUnitPrice: 6500 };
  assert.equal(await code(svc.sales.closeSale(seller, { lines: [line], channelId: rappi, payments: [{ methodId: pm.id, amount: 6500 }], idempotencyKey: `rp-s-${run}` })), 'FORBIDDEN');
  const s = await svc.sales.closeSale(admin, { lines: [line], channelId: rappi, payments: [{ methodId: pm.id, amount: 6500 }], idempotencyKey: `rp-${run}`, externalRef: `R-${run}` });
  assert.equal(s.total, 6500); assert.equal(s.lines[0].unitPrice, 6500);
  const item = await db.saleItem.findFirstOrThrow({ where: { saleId: s.id } }); assert.equal(item.isManualPrice, true);
  const fin = await svc.sales.getSaleFinancial(admin, s.id);
  assert.deepEqual(fin.charges.map((c) => [c.type, c.amount]), [['CHANNEL_COMMISSION', 1300]], '20 % de 6.500');
  assert.equal(fin.financial.costOfGoodsSold, 2000); assert.equal(fin.financial.realProfit, fin.financial.netTotal - 2000 - 1300);
  const a = await db.auditLog.findFirstOrThrow({ where: { action: 'sale.price_override', entityId: s.id } });
  assert.deepEqual((a.metadata as { lines: { catalogPrice: number; appliedPrice: number }[] }).lines.map((l) => [l.catalogPrice, l.appliedPrice]), [[5000, 6500]]);
  await svc.settings.saveFeeRule(admin, { target: 'CHANNEL', targetId: rappi, percent: '0', fixedAmount: 0, isManualPerSale: true, isActive: true });
});

test('gastos: registro con factura (IVA recuperable), duplicado bloqueado, anulación, y utilidad del negocio en el reporte', async () => {
  const d = await svc.reports.today(admin);
  const cat = (await svc.expenses.categories(admin)).find((c) => c.name === 'Arriendo')!;
  const before = await svc.reports.overview(admin, { from: d, to: d });
  const f = await svc.expenses.create(admin, { categoryId: cat.id, description: `Luz ${run}`, expenseDate: d, totalAmount: 119000, docType: 'FACTURA', docNumber: `E-${run}` });
  await svc.expenses.create(admin, { categoryId: cat.id, description: `Feria ${run}`, expenseDate: d, totalAmount: 20000 });
  assert.equal(await code(svc.expenses.create(admin, { categoryId: cat.id, description: 'dup', expenseDate: d, totalAmount: 1000, docType: 'FACTURA', docNumber: `e-${run}` })), 'BUSINESS_RULE');
  assert.equal(await code(svc.expenses.create(seller, { categoryId: cat.id, description: 'x', expenseDate: d, totalAmount: 1 })), 'FORBIDDEN');
  const after = await svc.reports.overview(admin, { from: d, to: d });
  assert.equal(after.expenses.resultCost - before.expenses.resultCost, 100000 + 20000, 'factura a neto + gasto sin documento al total');
  assert.equal(after.businessProfit, after.totals.realProfit - after.expenses.resultCost);
  await svc.expenses.void(admin, f.id, 'duplicado en papel');
  const v = await svc.expenses.get(admin, f.id); assert.equal(v.status, 'VOIDED'); assert.equal(v.voidReason, 'duplicado en papel');
  const again = await svc.reports.overview(admin, { from: d, to: d });
  assert.equal(again.expenses.resultCost - before.expenses.resultCost, 20000, 'el gasto anulado sale del resultado');
  assert.ok((await svc.expenses.list(admin, { from: d, to: d, status: 'VOIDED' })).some((x) => x.id === f.id));
  assert.equal(await db.auditLog.count({ where: { entity: 'Expense', entityId: f.id } }), 2);
});

test('compras con centavos en Postgres real: IVA sobre el total y pur_sum/pi_sum se cumplen', async () => {
  const p = await svc.products.save(admin, { sku: `PD-${run}`, name: `Decimal ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 3000, vatTreatment: 'AFECTO' });
  const r = await svc.purchases.register(admin, { docType: 'FACTURA', docNumber: `FD-${run}`, docDate: '2026-10-03', pricesIncludeVat: false,
    lines: [{ productId: p.id, quantity: '6', unitCost: 1508.5 }, { productId: p.id, quantity: '7', unitCost: 1508.5 }] });
  const d = await svc.purchases.detail(admin, r.id);
  assert.deepEqual(d.items.map((i) => i.lineNet), [9051, 10560]);
  assert.deepEqual([d.purchase.netAmount, d.purchase.vatAmount, d.purchase.totalAmount], [19611, 3726, 23337]);   // IVA = redondeo(19.611 × 0,19 = 3.726,09)
});

test('editar fecha/N° de una compra en Postgres real: documentKey se recalcula y el anti-duplicado funciona', async () => {
  const p = await svc.products.save(admin, { sku: `PE-${run}`, name: `Editar ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 3000, vatTreatment: 'AFECTO' });
  const a = await svc.purchases.register(admin, { docType: 'FACTURA', docNumber: `EA-${run}`, docDate: '2026-10-05', pricesIncludeVat: false, lines: [{ productId: p.id, quantity: '1', lineAmount: 1000 }] });
  await svc.purchases.register(admin, { docType: 'FACTURA', docNumber: `EB-${run}`, docDate: '2026-10-05', pricesIncludeVat: false, lines: [{ productId: p.id, quantity: '1', lineAmount: 1000 }] });
  await svc.purchases.editHeader(admin, a.id, { docDate: '2026-09-29', docNumber: `EC-${run}`, supplierId: null, note: 'corregida' });
  const d = await svc.purchases.detail(admin, a.id);
  assert.deepEqual([d.purchase.docDate, d.purchase.docNumber, d.purchase.note, d.purchase.totalAmount], ['2026-09-29', `EC-${run}`.toUpperCase(), 'corregida', 1190]);
  assert.equal(await code(svc.purchases.editHeader(admin, a.id, { docDate: '2026-09-29', docNumber: `EB-${run}` })), 'DUPLICATE_DOCUMENT');
});

test('cierre de caja en Postgres real: tramo desde el último cierre, efectivo por medio de pago, vendedor a ciegas', async () => {
  const p = await svc.products.save(admin, { sku: `CJ-${run}`, name: `Caja ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 2000, vatTreatment: 'AFECTO' });
  await svc.purchases.register(admin, { docType: 'OTRO', docDate: '2026-10-01', pricesIncludeVat: true, lines: [{ productId: p.id, quantity: '10', lineAmount: 10000 }] });
  await svc.cash.close(admin, { float: 0, counted: 0 });                                  // deja el tramo vacío (corta lo de pruebas anteriores)
  const st0 = await svc.cash.status(admin); assert.equal(st0.salesCount, 0); assert.ok(st0.since);
  await svc.sales.closeSale(seller, { lines: [{ productId: p.id, quantity: '2' }], channelId: ids.LOCAL, payments: [{ methodId: ids.CASH, amount: 4000 }], idempotencyKey: `cj1-${run}` });
  await svc.sales.closeSale(seller, { lines: [{ productId: p.id, quantity: '1' }], channelId: ids.LOCAL, payments: [{ methodId: ids.DEBIT, amount: 2000 }], idempotencyKey: `cj2-${run}` });
  const st = await svc.cash.status(admin);
  assert.equal(st.salesCount, 2); assert.equal(st.summary!.cash, 4000); assert.equal(st.summary!.total, 6000); assert.equal(st.suggestedFloat, 0);
  const sst = await svc.cash.status(seller); assert.equal(sst.summary, null); assert.equal(sst.salesCount, 2);
  const blindRec = await svc.cash.close(seller, { float: 10000, counted: 13500, withdrawals: 0, note: 'faltan 500' });
  assert.ok(!('diff' in blindRec)); assert.equal(blindRec.counted, 13500);
  const h = await svc.cash.history(admin); assert.equal(h.review, true);
  const mine = h.rows.find((r) => r.id === blindRec.id)!;
  assert.deepEqual([mine.expectedCash, mine.diff, mine.salesCount, mine.role, mine.userName], [14000, -500, 2, 'VENDEDOR', 'Vend IT']);
  assert.equal((await svc.cash.status(admin)).salesCount, 0, 'el siguiente tramo empieza vacío');
  const hs = await svc.cash.history(seller); assert.equal(hs.review, false); assert.ok(hs.rows.every((r) => !('diff' in r)));
});

test('apertura de caja en Postgres real: fija el fondo del cierre', async () => {
  const st0 = await svc.cash.status(admin);
  if (st0.open) await svc.cash.close(admin, { counted: 0 });
  await svc.cash.open(seller, { float: 12345 });
  assert.equal((await svc.cash.status(admin)).open?.float, 12345);
  assert.equal(await code(svc.cash.open(admin, { float: 1 })), 'BUSINESS_RULE');
  const r = await svc.cash.close(admin, { float: 1, counted: 12345 });
  assert.equal(r.float, 12345); assert.equal((r as { withoutOpen?: boolean }).withoutOpen, false);
  assert.equal((await svc.cash.status(admin)).open, null);
});

test('dinero disponible en Postgres real: ventas por medio de pago, comisión TUU con IVA, "pagado con", fecha anterior no cuenta, traspasos', async () => {
  const today = await svc.expenses.today(admin);
  const y = new Date(Date.parse(today + 'T12:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  const p = await svc.products.save(admin, { sku: `DN-${run}`, name: `Dinero ${run}`, unitCode: 'UN', kind: 'GOODS', salePrice: 2000, vatTreatment: 'AFECTO' });
  await svc.purchases.register(admin, { docType: 'OTRO', docDate: today, pricesIncludeVat: true, lines: [{ productId: p.id, quantity: '10', lineAmount: 10000 }] });   // antes del punto de partida: no cuenta
  await svc.money.setStart(admin, { balances: { CAJA: 1000, BANCO: 50000, MP: 0, TUU: 0, RAPPI: 0 }, note: 'IT' });
  await new Promise((r) => setTimeout(r, 20));
  await svc.sales.closeSale(seller, { lines: [{ productId: p.id, quantity: '2' }], channelId: ids.LOCAL, payments: [{ methodId: ids.CASH, amount: 4000 }], idempotencyKey: `dn1-${run}` });
  await svc.sales.closeSale(seller, { lines: [{ productId: p.id, quantity: '1' }], channelId: ids.LOCAL, payments: [{ methodId: ids.DEBIT, amount: 2000 }], idempotencyKey: `dn2-${run}` });   // comisión 1,5% = 30 → 36 con IVA
  const pu = await svc.purchases.register(admin, { docType: 'OTRO', docDate: today, pricesIncludeVat: true, paidFrom: 'BANCO', lines: [{ productId: p.id, quantity: '1', lineAmount: 1500 }] });
  const cat = (await svc.expenses.categories(admin))[0];
  await svc.expenses.create(admin, { categoryId: cat.id, description: `viejo ${run}`, expenseDate: y, totalAmount: 9999, paidFrom: 'CAJA' });          // fecha anterior: no cuenta
  const ex = await svc.expenses.create(admin, { categoryId: cat.id, description: `film ${run}`, expenseDate: today, totalAmount: 700 });             // sin indicar
  let st = await svc.money.status(admin);
  const line = (a: string) => st.result!.lines.find((l) => l.account === a)!;
  assert.equal(st.salesCount, 2);
  assert.deepEqual([line('CAJA').expected, line('TUU').expected, line('BANCO').expected], [1000 + 4000, 2000 - 36, 50000 - 1500]);
  assert.equal(st.result!.unassigned, 700); assert.deepEqual(st.outflows.map((o) => [o.kind, o.amount, o.paidFrom]).sort(), [['EXPENSE', 700, null], ['PURCHASE', 1500, 'BANCO']]);
  assert.equal(st.outflows.find((o) => o.kind === 'PURCHASE')!.id, pu.id);
  await svc.money.setSource(admin, 'EXPENSE', ex.id, 'CAJA');
  await svc.money.addMove(admin, { date: today, from: 'TUU', to: 'BANCO', amount: 1964, note: 'abono' });
  st = await svc.money.status(admin);
  assert.equal(st.result!.unassigned, 0); assert.equal(line('CAJA').expected, 5000 - 700);
  assert.deepEqual([line('TUU').expected, line('BANCO').expected], [0, 48500 + 1964]);
  await svc.money.voidMove(admin, st.moves[0].id, 'prueba');
  st = await svc.money.status(admin); assert.equal(st.moves[0].voided, true); assert.equal(line('TUU').expected, 1964);
  assert.equal(await code(svc.money.status(seller)), 'FORBIDDEN');
});
