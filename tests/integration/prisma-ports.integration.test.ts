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
