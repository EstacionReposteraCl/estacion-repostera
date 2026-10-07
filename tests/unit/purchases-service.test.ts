import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, B, code, sale, fact } from '../helpers/world.ts';
import { reconcile, type MovementRow } from '../../src/domain/inventory/inventory.ts';
const rows = (db: ReturnType<typeof world>['db'], p = 'az'): MovementRow[] => db.movements.filter((m) => m.productId === p).map((m) => ({ seq: m.seq, quantity: m.quantity, valueChange: m.valueChange, qtyBefore: m.quantityBefore, qtyAfter: m.quantityAfter, valueAfter: m.valueAfter }));
const L = (quantity: string, lineAmount: number, extra = {}) => ({ productId: 'az', quantity, lineAmount, ...extra });

test('A/B: dos compras de factura suman costBasis (neto) al inventario', async () => {
  const { db, svc } = world();
  await svc.purchases.register(admin, fact('123', [L('10', 50000)])); await svc.purchases.register(admin, fact('124', [L('5', 50000)]));
  assert.deepEqual(db.inv.get('main|az'), { qty: 15000n, value: 100000, seq: 2 });
  const p = [...db.purchases.values()][0].purchase; assert.deepEqual([p.netAmount, p.vatAmount, p.totalAmount, p.vatRecoverable], [50000, 9500, 59500, true]);
  assert.deepEqual(reconcile(rows(db), db.inv.get('main|az')!), []);
});
test('boleta: costBasis = total (IVA no recuperable)', async () => {
  const { db, svc } = world();
  await svc.purchases.register(admin, { docType: 'BOLETA', docNumber: '55', docDate: '2026-10-01', pricesIncludeVat: true, lines: [L('10', 59500)] });
  assert.deepEqual(db.inv.get('main|az'), { qty: 10000n, value: 59500, seq: 1 });
});
test('presentación: 2 bolsas de 500 g = 1,000 kg; cantidad no entera de envases se rechaza', async () => {
  const { db, svc } = world();
  await svc.purchases.register(admin, fact('1', [{ productId: 'az', presentationId: 'b500', quantity: '2', lineAmount: 6000 }])); assert.equal(db.inv.get('main|az')!.qty, 1000n);
  assert.equal(await code(svc.purchases.register(admin, fact('2', [{ productId: 'az', presentationId: 'b500', quantity: '1,5', lineAmount: 100 }]))), 'VALIDATION');
});
test('validaciones: vendedor, factura sin número, servicio, costo ambiguo, sin líneas', async () => {
  const { svc } = world();
  assert.equal(await code(svc.purchases.register(s1, fact('1', [L('1', 100)]))), 'FORBIDDEN');
  assert.equal(await code(svc.purchases.register(admin, fact(' ', [L('1', 100)]))), 'VALIDATION');
  assert.equal(await code(svc.purchases.register(admin, fact('1', [{ productId: 'envio', quantity: '1', lineAmount: 100 }]))), 'BUSINESS_RULE');
  assert.equal(await code(svc.purchases.register(admin, fact('1', [{ productId: 'az', quantity: '1', lineAmount: 100, unitCost: 100 }]))), 'VALIDATION');
  assert.equal(await code(svc.purchases.register(admin, fact('1', []))), 'VALIDATION');
});
test('O1/O2/O3/O4: documento duplicado, sin proveedor, otro tipo/proveedor, anulada libera', async () => {
  const { db, svc } = world();
  const first = await svc.purchases.register(admin, fact('123', [L('1', 1000)]));
  assert.equal(await code(svc.purchases.register(admin, fact(' 0123', [L('1', 1000)]))), 'DUPLICATE_DOCUMENT');
  await svc.purchases.register(admin, { docType: 'BOLETA', docNumber: '9', docDate: '2026-10-01', pricesIncludeVat: true, lines: [L('1', 1190)] });
  assert.equal(await code(svc.purchases.register(admin, { docType: 'BOLETA', docNumber: '9', docDate: '2026-10-01', pricesIncludeVat: true, lines: [L('1', 1190)] })), 'DUPLICATE_DOCUMENT');
  await svc.purchases.register(admin, fact('123', [L('1', 1000)], { docType: 'BOLETA', pricesIncludeVat: true })); // otro tipo
  await svc.purchases.register(admin, fact('123', [L('1', 1000)], { supplierId: 'sup2' }));                          // otro proveedor
  await svc.purchases.void(admin, first.id, { adjusted: true, reason: 'error de digitación' });
  await svc.purchases.register(admin, fact('123', [L('1', 1000)]));                                                   // libera documentKey
  assert.ok(db.purchases.size >= 5);
});
test('O5: dos registros simultáneos del mismo documento -> solo uno', async () => {
  const { db, svc } = world();
  const r = await Promise.allSettled([svc.purchases.register(admin, fact('77', [L('1', 1000)])), svc.purchases.register(admin, fact('77', [L('1', 1000)]))]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1); assert.equal(db.purchases.size, 1); assert.equal(db.movements.length, 1);
});
test('J1: anular compra que fue el último movimiento -> EXACT, vuelve a 0/0 y libera el documento', async () => {
  const { db, svc } = world(); const p = await svc.purchases.register(admin, fact('1', [L('10', 50000)]));
  assert.equal(await code(svc.purchases.void(s1, p.id, { adjusted: false, reason: 'x' })), 'FORBIDDEN');
  assert.equal(await code(svc.purchases.void(admin, p.id, { adjusted: false, reason: ' ' })), 'BUSINESS_RULE');
  await svc.purchases.void(admin, p.id, { adjusted: false, reason: 'duplicada' });
  assert.deepEqual(db.inv.get('main|az'), { qty: 0n, value: 0, seq: 2 }); const pr = db.purchases.get(p.id)!.purchase;
  assert.deepEqual([pr.status, pr.voidMode, pr.voidVariance, pr.documentKey], ['VOIDED', 'EXACT', 0, null]);
  assert.equal(await code(svc.purchases.void(admin, p.id, { adjusted: false, reason: 'otra' })), 'BUSINESS_RULE');
  assert.deepEqual(reconcile(rows(db), db.inv.get('main|az')!), []);
});
test('J2: tras la venta C queda bloqueada; ADJUSTED retira 33.333, varianza 16.667 -> 9,920 kg / 66.134 y audita dos veces', async () => {
  const { db, svc } = world(); await svc.purchases.register(admin, fact('1', [L('10', 50000)])); const b = await svc.purchases.register(admin, fact('2', [L('5', 50000)]));
  await svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '0,080' }], 960, 'k1'));
  assert.deepEqual(db.inv.get('main|az'), { qty: 14920n, value: 99467, seq: 3 });
  assert.equal(await code(svc.purchases.void(admin, b.id, { adjusted: false, reason: 'x' })), 'BUSINESS_RULE');
  assert.equal((db.inv.get('main|az')!).seq, 3);                                                     // bloqueo no escribe nada
  const prev = await svc.purchases.previewVoid(admin, b.id, true); assert.equal(prev.status, 'ok'); if (prev.status === 'ok') assert.equal(prev.totalVariance, 16667);
  await svc.purchases.void(admin, b.id, { adjusted: true, reason: 'factura mal ingresada' });
  assert.deepEqual(db.inv.get('main|az'), { qty: 9920n, value: 66134, seq: 4 }); assert.equal(db.purchases.get(b.id)!.purchase.voidVariance, 16667);
  assert.equal(db.audit.filter((a) => a.action === 'purchase.void_adjusted').length, 1); assert.deepEqual(reconcile(rows(db), db.inv.get('main|az')!), []);
});
test('J3: ya se vendió más de lo que quedaría -> bloqueada aun con ADJUSTED', async () => {
  const { db, svc } = world(); const p = await svc.purchases.register(admin, fact('1', [L('10', 50000)]));
  await svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '7' }], 84000, 'k1'));
  assert.equal(await code(svc.purchases.void(admin, p.id, { adjusted: true, reason: 'x' })), 'BUSINESS_RULE'); assert.equal(db.purchases.get(p.id)!.purchase.status, 'CONFIRMED');
});
test('anular compra con dos líneas del mismo producto (EXACT) deja 0/0 y cuadra', async () => {
  const { db, svc } = world(); const p = await svc.purchases.register(admin, fact('1', [L('1', 1000), L('2', 2500)]));
  await svc.purchases.void(admin, p.id, { adjusted: false, reason: 'x' }); assert.deepEqual(db.inv.get('main|az'), { qty: 0n, value: 0, seq: 4 }); assert.deepEqual(reconcile(rows(db), db.inv.get('main|az')!), []);
});
test('anulación ADJUSTED con dos líneas del mismo producto: reparte el valor retirado y cuadra', async () => {
  const { db, svc } = world(); const p = await svc.purchases.register(admin, fact('1', [L('1', 1000), L('2', 2500)]));
  await svc.purchases.register(admin, fact('2', [L('1', 2000)]));                       // movimiento posterior: 4 kg / $5.500
  assert.equal(await code(svc.purchases.void(admin, p.id, { adjusted: false, reason: 'x' })), 'BUSINESS_RULE');
  await svc.purchases.void(admin, p.id, { adjusted: true, reason: 'x' });
  assert.deepEqual(db.inv.get('main|az'), { qty: 1000n, value: 1375, seq: 5 });          // retira round(5500×3/4)=4.125; varianza 3.500−4.125=−625
  assert.equal(db.purchases.get(p.id)!.purchase.voidVariance, -625); assert.deepEqual(reconcile(rows(db), db.inv.get('main|az')!), []);
});
