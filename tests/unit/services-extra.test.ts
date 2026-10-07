import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { world, admin, admin2, s1, s2, code, sale, fact } from '../helpers/world.ts';
import { findSensitiveKeys } from '../../src/dto/sensitive.ts';
import { PERMISSIONS } from '../../src/core/permissions/permissions.ts';
import { reconcile } from '../../src/domain/inventory/inventory.ts';

const seed = async (w = world(), qty = '10', amount = 50000) => { await w.svc.purchases.register(admin, fact('S' + Math.random(), [{ productId: 'az', quantity: qty, lineAmount: amount }])); return w; };

// ---------- inventario ----------
test('inventario: saldo inicial una sola vez; vendedor solo ve cantidad', async () => {
  const { db, svc } = world();
  await svc.inventory.openingBalance(admin, { productId: 'az', qty: '10', totalValue: 25000 });
  assert.deepEqual(db.inv.get('main|az'), { qty: 10000n, value: 25000, seq: 1 }); assert.equal(db.movements[0].type, 'OPENING_BALANCE');
  assert.equal(await code(svc.inventory.openingBalance(admin, { productId: 'az', qty: '1', totalValue: 1 })), 'BUSINESS_RULE');
  assert.deepEqual(await svc.inventory.stockOf(s1, 'az'), { qty: '10.000' });
  assert.equal(await code(svc.inventory.openingBalance(s1, { productId: 'az', qty: '1', totalValue: 1 })), 'FORBIDDEN');
  assert.equal(await code(svc.inventory.stockOf(s1, 'envio')), 'BUSINESS_RULE');
});
test('conteo físico: faltante cuesta a promedio; sobrante valorado a promedio; nota obligatoria; sin stock previo no se valora', async () => {
  const w = await seed(); const { db, svc } = w;                                              // 10 kg / $50.000
  assert.equal(await code(svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '9', note: ' ' })), 'VALIDATION');
  await svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '9', note: 'conteo' }); assert.deepEqual(db.inv.get('main|az'), { qty: 9000n, value: 45000, seq: 2 });
  await svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '10', note: 'conteo' }); assert.deepEqual(db.inv.get('main|az'), { qty: 10000n, value: 50000, seq: 3 });
  assert.equal(db.movements.at(-1)!.type, 'ADJUSTMENT'); assert.equal(await code(svc.inventory.countAdjust(s1, { productId: 'az', countedQty: '1', note: 'x' })), 'FORBIDDEN');
  const empty = world(); assert.equal(await code(empty.svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '3', note: 'x' })), 'BUSINESS_RULE');
});
test('merma y corrección de costo: motivo, auditoría y cuadratura', async () => {
  const w = await seed(); const { db, svc } = w;
  assert.equal(await code(svc.inventory.registerWaste(admin, { productId: 'az', qty: '1', reason: 'EXPIRED', note: '' })), 'VALIDATION');
  await svc.inventory.registerWaste(admin, { productId: 'az', qty: '1', reason: 'EXPIRED', note: 'vencido' }); assert.deepEqual(db.inv.get('main|az'), { qty: 9000n, value: 45000, seq: 2 });
  assert.equal(await code(svc.inventory.registerWaste(admin, { productId: 'az', qty: '99', reason: 'OTHER', note: 'x' })), 'INSUFFICIENT_STOCK');
  await svc.inventory.correctCost(admin, { productId: 'az', newInventoryValue: 50000, note: 'costo mal ingresado' });
  assert.deepEqual(db.inv.get('main|az'), { qty: 9000n, value: 50000, seq: 3 }); assert.equal(db.movements.at(-1)!.quantity, 0n);
  const a = db.audit.find((x) => x.action === 'cost.correction')!; assert.deepEqual([a.before, a.after], [{ inventoryValue: 45000 }, { inventoryValue: 50000 }]);
  assert.equal(await code(svc.inventory.correctCost(s1, { productId: 'az', newInventoryValue: 1, note: 'x' })), 'FORBIDDEN');
  assert.deepEqual(await svc.inventory.reconcile(admin, 'az'), { ok: true, errors: [] });
  assert.equal(await code(svc.inventory.reconcile(s1, 'az')), 'FORBIDDEN');
  db.setStock('main', 'az', 9000n, 1); assert.equal((await svc.inventory.reconcile(admin, 'az')).ok, false);
});

// ---------- productos y DTO del vendedor ----------
test('SEGURIDAD: la búsqueda del vendedor no filtra costos aunque la fila cruda los traiga (valor centinela)', async () => {
  const { db, svc } = world(); db.setStock('main', 'az', 5000n, 987654321, 3);
  const res = await svc.products.search(s1, 'azú'); assert.equal(res.length, 1);
  const json = JSON.stringify(res); assert.ok(!json.includes('987654321') && !/adminOnly|inventoryValue|avgCost|cost/i.test(json)); assert.deepEqual(findSensitiveKeys(res), []);
  assert.equal(res[0].stock, '5.000'); assert.equal(res[0].presentations[0].salePrice, 6000);       // bolsa 500 g proporcional
  assert.equal((await svc.products.search(s1, 'AZ-1')).length, 1);                                   // por SKU / código
  assert.deepEqual(await svc.products.search(s1, '   '), []);
  const adm = await svc.products.getAdmin(admin, 'az'); assert.equal(adm.inventoryValue, 987654321); assert.equal(adm.avgCost, '197530864.20');
  assert.equal(await code(svc.products.getAdmin(s1, 'az')), 'FORBIDDEN'); assert.equal(await code(svc.products.getAdmin(admin, 'nope')), 'NOT_FOUND');
});
test('productos: unidad inmutable con movimientos, cambio de precio auditado, archivar con motivo, vendedor sin acceso', async () => {
  const w = await seed(); const { db, svc } = w; const base = { id: 'az', sku: 'AZ-1', name: 'Azúcar', unitCode: 'KG', kind: 'GOODS' as const, salePrice: 12000, vatTreatment: 'AFECTO' as const };
  assert.equal(await code(svc.products.save(admin, { ...base, unitCode: 'G' })), 'BUSINESS_RULE'); assert.equal(await code(svc.products.save(admin, { ...base, kind: 'SERVICE' })), 'BUSINESS_RULE');
  await svc.products.save(admin, { ...base, salePrice: 13000 }); const a = db.audit.find((x) => x.action === 'product.price_change')!; assert.deepEqual([a.before, a.after], [{ salePrice: 12000 }, { salePrice: 13000 }]);
  assert.equal(await code(svc.products.save(s1, base)), 'FORBIDDEN'); assert.equal(await code(svc.products.save(admin, { ...base, salePrice: 10.5 })), 'VALIDATION');
  assert.equal(await code(svc.products.archive(admin, 'az', ' ')), 'VALIDATION'); await svc.products.archive(admin, 'az', 'descontinuado'); assert.equal(db.prodRows.get('az')!.isActive, false);
  assert.equal(await code(svc.products.archive(s1, 'az', 'x')), 'FORBIDDEN');
});

// ---------- ventas: extras ----------
test('ventas: canal o medio de pago inactivo/inexistente se rechaza antes de tocar inventario', async () => {
  const w = await seed(); const { db, svc } = w; db.channels.set('ML', { id: 'ML', isActive: false });
  assert.equal(await code(svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '1' }], 12000, 'k1', 'DEBIT', 'ML'))), 'BUSINESS_RULE');
  assert.equal(await code(svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '1' }], 12000, 'k2', 'DEBIT', 'NOPE'))), 'VALIDATION');
  assert.equal(await code(svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '1' }], 12000, 'k3', 'TARJETA'))), 'VALIDATION');
  db.methods.set('CASH', { id: 'CASH', isActive: false }); assert.equal(await code(svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '1' }], 12000, 'k4', 'CASH'))), 'BUSINESS_RULE');
  assert.equal(db.sales.size, 0); assert.equal(db.inv.get('main|az')!.seq, 1);
});
test('ventas: reimpresión y listado respetan el alcance del vendedor; reimpresión se audita', async () => {
  const w = await seed(); const { db, svc } = w;
  const a = await svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '1' }], 12000, 'a')); const b = await svc.sales.closeSale(s2, sale([{ productId: 'az', quantity: '1' }], 12000, 'b'));
  assert.equal((await svc.sales.reprintSale(s1, a.id)).id, a.id); assert.equal(await code(svc.sales.reprintSale(s1, b.id)), 'NOT_FOUND');
  assert.equal(db.audit.filter((x) => x.action === 'sale.reprint').length, 1); assert.equal((await svc.sales.reprintSale(admin, b.id)).id, b.id);
  assert.deepEqual((await svc.sales.listSales(s1)).map((x) => x.id), [a.id]); assert.equal((await svc.sales.listSales(admin)).length, 2);
  db.clock = new Date('2026-10-07T15:00:00Z'); assert.deepEqual(await svc.sales.listSales(s1), []); assert.equal(await code(svc.sales.reprintSale(s1, a.id)), 'NOT_FOUND');
});
test('ventas: resultado financiero solo para administrador; incluye cargos', async () => {
  const w = await seed(); const { svc } = w; const a = await svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '0,5' }], 6000, 'a'));
  assert.equal(await code(svc.sales.getSaleFinancial(s1, a.id)), 'FORBIDDEN');
  const f = await svc.sales.getSaleFinancial(admin, a.id); assert.equal(f.financial.totalCharges, 90); assert.equal(f.charges[0].type, 'PAYMENT_FEE'); assert.equal(await code(svc.sales.getSaleFinancial(admin, 'nope')), 'NOT_FOUND');
});

// ---------- reportes y usuarios ----------
test('reportes: vendedor solo su conteo/total de hoy (sin anuladas); financiero solo administrador y sin anuladas', async () => {
  const w = await seed(); const { svc } = w;
  const a = await svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '1' }], 12000, 'a')); await svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '2' }], 24000, 'b')); await svc.sales.closeSale(s2, sale([{ productId: 'az', quantity: '1' }], 12000, 'c'));
  assert.deepEqual(await svc.reports.sellerToday(s1), { count: 2, total: 36000 });
  await svc.sales.voidSale(admin, a.id, 'x'); assert.deepEqual(await svc.reports.sellerToday(s1), { count: 1, total: 24000 });
  assert.equal(await code(svc.reports.financial(s1, { from: '2026-10-01', to: '2026-10-31' })), 'FORBIDDEN');
  const r = await svc.reports.financial(admin, { from: '2026-10-01', to: '2026-10-31' }); assert.equal(r.sales, 2); assert.equal(await code(svc.reports.financial(admin, { from: '2026-10-31', to: '2026-10-01' })), 'VALIDATION');
  assert.deepEqual(Object.keys(await svc.reports.sellerToday(s1)).sort(), ['count', 'total']);
});
test('usuarios: solo administrador; no se queda sin administradores; no se desactiva a sí mismo; desactivar revoca sesiones', async () => {
  const { db, svc } = world();
  assert.equal(await code(svc.users.create(s1, { name: 'x', email: 'x@y.cl', role: 'VENDEDOR', tempPassword: '1234567890' })), 'FORBIDDEN');
  assert.equal(await code(svc.users.create(admin, { name: 'x', email: 'malo', role: 'VENDEDOR', tempPassword: '1234567890' })), 'VALIDATION');
  assert.equal(await code(svc.users.create(admin, { name: 'x', email: 'x@y.cl', role: 'VENDEDOR', tempPassword: 'corta' })), 'VALIDATION');
  const u = await svc.users.create(admin, { name: 'Nuevo', email: ' Nuevo@Y.cl ', role: 'VENDEDOR', tempPassword: '1234567890' }); assert.equal(db.users.get(u.id)!.email, 'nuevo@y.cl');
  assert.equal(await code(svc.users.deactivate(admin, 'adm', 'x')), 'BUSINESS_RULE');
  await svc.users.deactivate(admin, 'adm2', 'se fue'); assert.deepEqual(db.sessionsRevoked, ['adm2']);
  assert.equal(await code(svc.users.setRole(admin, 'adm', 'VENDEDOR')), 'BUSINESS_RULE'); assert.equal(await code(svc.users.deactivate(admin2, 'adm', 'x')), 'BUSINESS_RULE');
  await svc.users.setRole(admin, u.id, 'ADMINISTRADOR'); assert.equal(db.users.get(u.id)!.role, 'ADMINISTRADOR'); assert.ok(db.audit.some((a) => a.action === 'user.set_role'));
  assert.equal(await code(svc.users.deactivate(admin, 'nope', 'x')), 'NOT_FOUND');
});

// ---------- análisis estático de la capa de servicios ----------
test('estático: todo método público de servicio con `actor` llama a assertCan con un permiso existente', () => {
  const dir = new URL('../../src/services/', import.meta.url); let methods = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.service.ts'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/assertCan\(actor,\s*(?:actor\?\.role === 'ADMINISTRADOR' \? )?'([a-z_.]+)'(?: : '([a-z_.]+)')?\)/g)) for (const p of [m[1], m[2]].filter(Boolean)) assert.ok((PERMISSIONS as readonly string[]).includes(p), `${f}: permiso inexistente ${p}`);
    const parts = src.split(/\n    async (\w+)\(actor: Actor \| null/).slice(1);
    for (let i = 0; i < parts.length; i += 2) { methods++; assert.ok(/assertCan\(/.test(parts[i + 1].split(/\n    async \w+\(/)[0]), `${f}: ${parts[i]} no llama a assertCan`); }
    assert.ok(!/generated|@prisma/.test(src), `${f}: un servicio no debe importar Prisma`);
  }
  assert.ok(methods >= 25, `solo se analizaron ${methods} métodos`);
});
test('estático: el DTO público de producto nunca lee adminOnly ni campos de costo', () => {
  const src = readFileSync(new URL('../../src/dto/product.dto.ts', import.meta.url), 'utf8');
  const pub = src.slice(src.indexOf('export function toProductPublicDTO'), src.indexOf('/** Solo se llama tras'));
  assert.ok(pub.length > 100 && !/adminOnly|inventoryValue|avgCost/.test(pub));
});
test('composition: createServices expone todos los servicios (la implementación Prisma se prueba en tests/integration/prisma-ports)', async () => {
  const { svc } = world(); assert.deepEqual(Object.keys(svc).sort(), ['expenses', 'inventory', 'products', 'purchases', 'reports', 'sales', 'settings', 'users']);
});
