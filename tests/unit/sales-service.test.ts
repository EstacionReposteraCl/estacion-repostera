import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from '../helpers/fake-db.ts';
import { createServices } from '../../src/services/composition.ts';
import { FACTOR_SCALE, type UnitDef } from '../../src/core/money/quantity.ts';
import { reconcile, type MovementRow } from '../../src/domain/inventory/inventory.ts';
import { findSensitiveKeys } from '../../src/dto/sensitive.ts';
import type { Actor } from '../../src/core/permissions/permissions.ts';
import { AppError } from '../../src/core/errors/index.ts';

const U = (code: string, dim: UnitDef['dimension'], f: bigint, d: number): UnitDef => ({ code, dimension: dim, factorToBase: f * FACTOR_SCALE, maxDecimals: d });
const B = 'main';
const admin: Actor = { userId: 'adm', role: 'ADMINISTRADOR', email: 'a@x.cl', branchId: B, banned: false };
const s1: Actor = { userId: 's1', role: 'VENDEDOR', email: 's1@x.cl', branchId: B, banned: false };
const s2: Actor = { ...s1, userId: 's2' };
const NOW = new Date('2026-10-06T15:00:00Z');

function setup() {
  const db = new FakeDb();
  db.units = new Map([['UN', U('UN', 'COUNT', 1n, 0)], ['G', U('G', 'MASS', 1n, 0)], ['KG', U('KG', 'MASS', 1000n, 3)]]);
  const base = { sku: 'x', isActive: true, vatTreatment: 'AFECTO' as const, presentations: [] };
  db.products.set('az', { ...base, id: 'az', name: 'Azúcar', kind: 'GOODS', salePrice: 12000, unit: db.units.get('KG')! });
  db.products.set('envio', { ...base, id: 'envio', name: 'Envío', kind: 'SERVICE', salePrice: 2500, unit: db.units.get('UN')! });
  db.rules = [{ id: 'r1', paymentMethodId: 'DEBIT', channelId: null, percentMilli: 1500, fixedAmount: 0, isManualPerSale: false, isActive: true }];
  db.setStock(B, 'az', 15000n, 100000, 2);
  const svc = createServices(db.ports).sales;
  return { db, svc };
}
const mk = (lines: any[], total: number, key: string, method = 'DEBIT') => ({ lines, channelId: 'LOCAL', payments: [{ methodId: method, amount: total }], idempotencyKey: key });
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e instanceof AppError ? e.code : 'OTHER'; } return 'NONE'; };

test('C: venta completa -> stock, valor, movimiento, costo congelado y SaleFinancial', async () => {
  const { db, svc } = setup();
  const dto = await svc.closeSale(s1, mk([{ productId: 'az', quantity: '0,080' }], 960, 'k1'));
  assert.deepEqual([dto.subtotal, dto.vat, dto.total, dto.folio], [807, 153, 960, 1]);
  assert.deepEqual(db.inv.get('main|az'), { qty: 14920n, value: 99467, seq: 3 });
  assert.equal(db.movements.length, 1); assert.equal(db.movements[0].type, 'SALE'); assert.equal([...db.itemCosts.values()][0], 533);
  assert.deepEqual([...db.fin.values()][0], { netTotal: 807, costOfGoodsSold: 533, grossProfit: 274, totalCharges: 14, realProfit: 260 });
  assert.equal(dto.issuer.legalName, 'OVELIX SPA'); assert.equal(dto.issuer.taxId, '78.485.985-1');
});
test('SEGURIDAD: el DTO del vendedor no contiene costos, márgenes, cargos ni reglas', async () => {
  const { svc } = setup();
  const dto = await svc.closeSale(s1, mk([{ productId: 'az', quantity: '0,080' }], 960, 'k1'));
  assert.deepEqual(findSensitiveKeys(dto), []);
  assert.ok(!/cost|profit|charge|margin|inventoryValue/i.test(JSON.stringify(dto)));
});
test('D: la última salida deja stock 0 y valor 0', async () => {
  const { db, svc } = setup(); db.setStock(B, 'az', 14920n, 99467, 3);
  await svc.closeSale(s1, mk([{ productId: 'az', quantity: '14,920' }], 179040, 'k1'));
  assert.deepEqual(db.inv.get('main|az'), { qty: 0n, value: 0, seq: 4 });
});
test('E: dos vendedores a la vez por el último 1 kg -> exactamente una venta; stock 0; un solo SALE', async () => {
  const { db, svc } = setup(); db.setStock(B, 'az', 1000n, 6667, 0);
  const r = await Promise.allSettled([svc.closeSale(s1, mk([{ productId: 'az', quantity: '1' }], 12000, 'kA')), svc.closeSale(s2, mk([{ productId: 'az', quantity: '1' }], 12000, 'kB'))]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  const bad = r.find((x) => x.status === 'rejected') as PromiseRejectedResult; assert.equal((bad.reason as AppError).code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(db.inv.get('main|az'), { qty: 0n, value: 0, seq: 1 }); assert.equal(db.movements.length, 1); assert.equal(db.sales.size, 1);
});
test('E: misma idempotencyKey dos veces -> una sola venta, mismo folio', async () => {
  const { db, svc } = setup(); const input = mk([{ productId: 'az', quantity: '1' }], 12000, 'dup');
  const [a, b] = await Promise.all([svc.closeSale(s1, input), svc.closeSale(s1, input)]);
  assert.equal(db.sales.size, 1); assert.equal(a.folio, b.folio); assert.equal(db.movements.length, 1);
});
test('venta fallida revierte todo (sin folio gastado, sin movimientos)', async () => {
  const { db, svc } = setup();
  assert.equal(await code(svc.closeSale(s1, mk([{ productId: 'envio', quantity: '1' }, { productId: 'az', quantity: '99' }], 1188000 + 2500, 'kx'))), 'INSUFFICIENT_STOCK');
  assert.equal(db.sales.size, 0); assert.equal(db.movements.length, 0); assert.equal(db.folio.get(B) ?? 0, 0); assert.deepEqual(db.inv.get('main|az'), { qty: 15000n, value: 100000, seq: 2 });
});
test('F: servicio no genera movimientos, costo ni cambia stock; grossProfit 2.101', async () => {
  const { db, svc } = setup(); await svc.closeSale(s1, mk([{ productId: 'envio', quantity: '1' }], 2500, 'k1', 'CASH'));
  assert.equal(db.movements.length, 0); assert.equal(db.itemCosts.size, 0); assert.deepEqual(db.inv.get('main|az'), { qty: 15000n, value: 100000, seq: 2 });
  assert.equal([...db.fin.values()][0].grossProfit, 2101);
});
test('I: anular venta restaura cantidad y COSTO CONGELADO aunque el promedio haya cambiado; no se anula dos veces', async () => {
  const { db, svc } = setup(); const dto = await svc.closeSale(s1, mk([{ productId: 'az', quantity: '0,080' }], 960, 'k1'));
  db.setStock(B, 'az', 14920n, 149467, 3); // simula una compra posterior que cambió el promedio
  assert.equal(await code(svc.voidSale(s1, dto.id, 'x')), 'FORBIDDEN');
  await svc.voidSale(admin, dto.id, 'cliente devolvió');
  assert.deepEqual(db.inv.get('main|az'), { qty: 15000n, value: 150000, seq: 4 }); // +533 congelado
  assert.equal(db.movements.at(-1)!.type, 'SALE_VOID'); assert.equal(db.sales.get(dto.id)!.sale.status, 'VOIDED');
  assert.equal(await code(svc.voidSale(admin, dto.id, 'otra vez')), 'BUSINESS_RULE'); assert.equal(await code(svc.voidSale(admin, dto.id, ' ')), 'BUSINESS_RULE');
  assert.equal(db.audit.filter((a) => a.action === 'sale.void').length, 1);
});
test('L1/L2/L4/L5: cargos posteriores solo admin, recalculan, auditan y no tocan lo congelado', async () => {
  const { db, svc } = setup(); const dto = await svc.closeSale(s1, mk([{ productId: 'az', quantity: '0,080' }], 960, 'k1'));
  const before = { ...[...db.fin.values()][0] };
  assert.equal(await code(svc.addLateCharge(s1, dto.id, { type: 'OTHER', amount: 5, reason: 'x' })), 'FORBIDDEN');
  await svc.addLateCharge(admin, dto.id, { type: 'CHANNEL_COMMISSION', amount: 100, reason: 'detalle ML' });
  const after = [...db.fin.values()][0];
  assert.deepEqual([after.totalCharges, after.realProfit, after.grossProfit, after.costOfGoodsSold, after.netTotal], [114, 160, before.grossProfit, before.costOfGoodsSold, before.netTotal]);
  assert.equal(after.recalculatedById, 'adm'); assert.equal(db.audit.filter((a) => a.action === 'sale.charge_added').length, 1);
  const late = db.charges.find((c) => (c as any).addedAfterClose === true)!;
  await svc.voidCharge(admin, late.id, dto.id, 'monto mal'); assert.equal([...db.fin.values()][0].realProfit, 260);
  assert.equal(db.charges.length, 2); // el cargo anulado sigue existiendo
  await svc.voidSale(admin, dto.id, 'anulada');
  assert.equal(await code(svc.addLateCharge(admin, dto.id, { type: 'OTHER', amount: 5, reason: 'x' })), 'BUSINESS_RULE');
});
test('seguridad del vendedor: solo sus ventas de hoy; ajenas/otro día = "no encontrado"', async () => {
  const { db, svc } = setup(); const dto = await svc.closeSale(s1, mk([{ productId: 'az', quantity: '1' }], 12000, 'k1'));
  assert.equal((await svc.getSaleForActor(s1, dto.id)).id, dto.id);
  assert.equal(await code(svc.getSaleForActor(s2, dto.id)), 'NOT_FOUND');
  assert.equal(await code(svc.getSaleForActor(s1, 'inexistente')), 'NOT_FOUND');
  const old = db.sales.get(dto.id)!; old.sale = { ...old.sale, businessDate: '2026-10-05' };
  assert.equal(await code(svc.getSaleForActor(s1, dto.id)), 'NOT_FOUND');
  assert.equal((await svc.getSaleForActor(admin, dto.id)).id, dto.id);
});
test('sin sesión o usuario desactivado -> UNAUTHENTICATED', async () => {
  const { svc } = setup();
  assert.equal(await code(svc.closeSale(null, mk([{ productId: 'az', quantity: '1' }], 12000, 'k'))), 'UNAUTHENTICATED');
  assert.equal(await code(svc.closeSale({ ...s1, banned: true }, mk([{ productId: 'az', quantity: '1' }], 12000, 'k'))), 'UNAUTHENTICATED');
});
test('K: cuadratura de movimientos tras varias ventas y una anulación', async () => {
  const { db, svc } = setup(); db.setStock(B, 'az', 0n, 0, 0);
  // se parte de cero con una entrada manual equivalente a una compra
  db.setStock(B, 'az', 10000n, 50000, 1); db.movements.push({ branchId: B, productId: 'az', seq: 1, type: 'PURCHASE', quantity: 10000n, quantityBefore: 0n, quantityAfter: 10000n, valueChange: 50000, valueAfter: 50000, createdById: 'adm' });
  const a = await svc.closeSale(s1, mk([{ productId: 'az', quantity: '0,5' }], 6000, 'a')); await svc.closeSale(s1, mk([{ productId: 'az', quantity: '2,25' }], 27000, 'b')); await svc.voidSale(admin, a.id, 'x');
  const rows: MovementRow[] = db.movements.map((m) => ({ seq: m.seq, quantity: m.quantity, valueChange: m.valueChange, qtyBefore: m.quantityBefore, qtyAfter: m.quantityAfter, valueAfter: m.valueAfter }));
  assert.deepEqual(reconcile(rows, db.inv.get('main|az')!), []);
});
