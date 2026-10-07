import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, s2, B, code, sale, fact } from '../helpers/world.ts';
import { planCountAdjustment } from '../../src/domain/inventory/count-adjust.ts';
import { derivedUnitCost } from '../../src/domain/purchases/purchases.ts';
import { reconcile, type MovementRow } from '../../src/domain/inventory/inventory.ts';
import { AppError } from '../../src/core/errors/index.ts';
const rows = (db: ReturnType<typeof world>['db']): MovementRow[] => db.movements.filter((m) => m.productId === 'az').map((m) => ({ seq: m.seq, quantity: m.quantity, valueChange: m.valueChange, qtyBefore: m.quantityBefore, qtyAfter: m.quantityAfter, valueAfter: m.valueAfter }));
const stocked = async () => { const w = world(); await w.svc.purchases.register(admin, fact('1', [{ productId: 'az', quantity: '10', lineAmount: 50000 }])); return w; };   // 10 kg / $50.000

// ============ 1. SOBRANTE EN CONTEO FÍSICO ============
test('sobrante con stock previo: se valora al costo promedio vigente (y un costo explícito se rechaza)', async () => {
  const { db, svc } = await stocked();
  await svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '12', note: 'conteo' });          // +2 kg a $5.000/kg
  assert.deepEqual(db.inv.get('main|az'), { qty: 12000n, value: 60000, seq: 2 }); assert.equal(db.movements.at(-1)!.type, 'ADJUSTMENT'); assert.equal(db.movements.at(-1)!.valueChange, 10000);
  assert.equal(await code(svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '13', note: 'x', unitCost: 9999 })), 'VALIDATION');
  assert.deepEqual(db.inv.get('main|az'), { qty: 12000n, value: 60000, seq: 2 });
});
test('sobrante con stock 0: NO se valora en $0 ni se inventa costo; exige costo unitario explícito del administrador', async () => {
  const { db, svc } = world();
  const err = await svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '3', note: 'apareció stock' }).catch((e: unknown) => e as AppError);
  assert.equal((err as AppError).code, 'BUSINESS_RULE'); assert.deepEqual((err as AppError).details, { requiresUnitCost: true });
  assert.equal(db.movements.length, 0); assert.equal(db.inv.get('main|az')?.qty ?? 0n, 0n);                       // nada se escribió
  assert.equal(await code(svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '3', note: 'x', unitCost: 0 })), 'VALIDATION');
  assert.equal(await code(svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '3', note: 'x', unitCost: 12.5 })), 'VALIDATION');
  assert.equal(await code(svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '0,001', note: 'x', unitCost: 1 })), 'VALIDATION');   // valor resultante $0
  assert.equal(db.movements.length, 0);
});
test('sobrante con stock 0 + costo explícito: queda como ADJUSTMENT valorado y auditado', async () => {
  const { db, svc } = world();
  await svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '3', note: 'apareció stock', unitCost: 4000 });   // 3 kg × $4.000/kg
  assert.deepEqual(db.inv.get('main|az'), { qty: 3000n, value: 12000, seq: 1 });
  const m = db.movements[0]; assert.deepEqual([m.type, m.valueChange, m.note, m.createdById], ['ADJUSTMENT', 12000, 'apareció stock', 'adm']);
  const a = db.audit.find((x) => x.action === 'inventory.adjust')!;
  assert.deepEqual(a.metadata, { note: 'apareció stock', groupId: undefined, valuation: 'SURPLUS_EXPLICIT_UNIT_COST', unitCost: 4000, valueChange: 12000 });
  assert.deepEqual(a.before, { qty: '0.000', inventoryValue: 0 }); assert.deepEqual(a.after, { qty: '3.000', inventoryValue: 12000 }); assert.equal(a.userId, 'adm');
  assert.deepEqual(reconcile(rows(db), db.inv.get('main|az')!), []);
  await svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '2', note: 'faltante' });                          // el faltante sigue al promedio
  assert.deepEqual(db.inv.get('main|az'), { qty: 2000n, value: 8000, seq: 2 });
});
test('vendedor no puede ajustar inventario (con o sin costo); faltante con costo explícito se rechaza; nota obligatoria', async () => {
  const { db, svc } = await stocked();
  assert.equal(await code(svc.inventory.countAdjust(s1, { productId: 'az', countedQty: '12', note: 'x' })), 'FORBIDDEN');
  assert.equal(await code(svc.inventory.countAdjust(s1, { productId: 'az', countedQty: '12', note: 'x', unitCost: 1 })), 'FORBIDDEN');
  assert.equal(await code(svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '9', note: 'x', unitCost: 5000 })), 'VALIDATION');
  assert.equal(await code(svc.inventory.countAdjust(admin, { productId: 'az', countedQty: '12', note: '  ' })), 'VALIDATION');
  assert.equal(await code(svc.inventory.countAdjust(admin, { productId: 'az', countedQty: 'abc', note: 'x' })), 'VALIDATION');
  assert.deepEqual(db.inv.get('main|az'), { qty: 10000n, value: 50000, seq: 1 });
});
test('sobrante con cantidad previa pero valor 0 (sin costo vigente): también exige costo explícito', () => {
  assert.throws(() => planCountAdjustment({ qty: 2000n, value: 0, seq: 3 }, 5000n), (e: unknown) => (e as AppError).details?.requiresUnitCost === true);
  const p = planCountAdjustment({ qty: 2000n, value: 0, seq: 3 }, 5000n, 1000)!; assert.deepEqual([p.movement.valueChange, p.movement.valueAfter, p.valuation], [3000, 3000, 'SURPLUS_EXPLICIT_UNIT_COST']);
  assert.equal(planCountAdjustment({ qty: 1000n, value: 5, seq: 1 }, 1000n), null);                                         // sin diferencia: no hay movimiento
});

// ============ 2. IDEMPOTENCY KEY ============
const L = (q: string, extra: Record<string, unknown> = {}) => ({ productId: 'az', quantity: q, ...extra });
test('misma key + MISMA operación -> devuelve la venta original (aunque se escriba distinto: "1" = "1,000")', async () => {
  const { db, svc } = await stocked();
  const a = await svc.sales.closeSale(s1, sale([L('1')], 12000, 'K'));
  const b = await svc.sales.closeSale(s1, sale([L('1,000')], 12000, 'K'));
  assert.equal(a.id, b.id); assert.equal(db.sales.size, 1); assert.equal(db.movements.filter((m) => m.type === 'SALE').length, 1); assert.equal(db.audit.filter((x) => x.action === 'sale.idempotency_conflict').length, 0);
});
test('misma key + contenido DISTINTO -> CONFLICT; no devuelve la original, no modifica, no crea otra; queda auditado', async () => {
  const { db, svc } = await stocked();
  const a = await svc.sales.closeSale(s1, sale([L('1')], 12000, 'K')); const before = JSON.stringify([...db.inv], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const variants: [string, ReturnType<typeof sale>][] = [
    ['otra cantidad', sale([L('5')], 60000, 'K')], ['otro producto', sale([{ productId: 'envio', quantity: '1' }], 2500, 'K')], ['otro medio de pago', sale([L('1')], 12000, 'K', 'CASH')],
    ['otro canal', sale([L('1')], 12000, 'K', 'DEBIT', 'ML')], ['otra línea adicional', sale([L('1'), L('1')], 24000, 'K')], ['otra unidad ingresada', sale([L('1000', { unitCode: 'G' })], 12000, 'K')],
    ['con nota', { ...sale([L('1')], 12000, 'K'), note: 'otra cosa' }], ['con referencia externa', { ...sale([L('1')], 12000, 'K'), externalRef: 'ML-1' }],
    ['pago partido', { ...sale([L('1')], 12000, 'K'), payments: [{ methodId: 'DEBIT', amount: 6000 }, { methodId: 'CASH', amount: 6000 }] }],
  ];
  for (const [name, input] of variants) {
    const err = await svc.sales.closeSale(s1, input).catch((e: unknown) => e) as AppError;
    assert.ok(err instanceof AppError && err.code === 'CONFLICT', `${name}: esperaba CONFLICT, obtuvo ${err?.code ?? 'ninguno'}`); assert.equal(err.details?.existingSaleId, a.id);
  }
  assert.equal(db.sales.size, 1); assert.equal(JSON.stringify([...db.inv], (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), before); assert.equal(db.sales.get(a.id)!.sale.total, 12000); assert.equal(db.folio.get(B), 1);
  const log = db.audit.filter((x) => x.action === 'sale.idempotency_conflict'); assert.equal(log.length, variants.length); assert.deepEqual([log[0].entityId, log[0].userId, log[0].metadata], [a.id, 's1', { idempotencyKey: 'K' }]);
});
test('misma key usada por OTRO usuario (aunque el contenido sea igual) -> CONFLICT, sin filtrar la venta ajena', async () => {
  const { db, svc } = await stocked(); await svc.sales.closeSale(s1, sale([L('1')], 12000, 'K'));
  const err = await svc.sales.closeSale(s2, sale([L('1')], 12000, 'K')).catch((e: unknown) => e) as AppError; assert.equal(err.code, 'CONFLICT'); assert.equal(db.sales.size, 1);
  assert.ok(!JSON.stringify(err.message).includes('Azúcar'));
});
test('carrera: dos peticiones simultáneas con la misma key y contenido distinto -> una venta y un CONFLICT', async () => {
  const { db, svc } = await stocked();
  const r = await Promise.allSettled([svc.sales.closeSale(s1, sale([L('1')], 12000, 'K')), svc.sales.closeSale(s1, sale([L('2')], 24000, 'K'))]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1); const bad = r.find((x) => x.status === 'rejected') as PromiseRejectedResult; assert.equal((bad.reason as AppError).code, 'CONFLICT');
  assert.equal(db.sales.size, 1); assert.equal(db.movements.filter((m) => m.type === 'SALE').length, 1); assert.equal(db.audit.filter((x) => x.action === 'sale.idempotency_conflict').length, 1);
});
test('carrera: dos peticiones simultáneas IDÉNTICAS -> una sola venta, sin conflicto', async () => {
  const { db, svc } = await stocked(); const i = sale([L('1')], 12000, 'K');
  const r = await Promise.all([svc.sales.closeSale(s1, i), svc.sales.closeSale(s1, i)]); assert.equal(r[0].id, r[1].id); assert.equal(db.sales.size, 1); assert.equal(db.audit.filter((x) => x.action === 'sale.idempotency_conflict').length, 0);
});
test('reintento legítimo tras cambiar el precio o archivar el producto: sigue siendo la misma operación (devuelve la original)', async () => {
  const { db, svc } = await stocked(); const i = sale([L('1')], 12000, 'K'); const a = await svc.sales.closeSale(s1, i);
  db.products.get('az')!.salePrice = 15000; assert.equal((await svc.sales.closeSale(s1, i)).id, a.id);
  db.products.get('az')!.isActive = false; assert.equal((await svc.sales.closeSale(s1, i)).id, a.id);
  db.clock = new Date('2026-10-08T15:00:00Z'); assert.equal((await svc.sales.closeSale(s1, i)).id, a.id);                  // mismo usuario y operación: no depende del día
  assert.equal(db.sales.size, 1);
});
test('la nota y la referencia externa ahora se guardan en la venta', async () => {
  const { db, svc } = await stocked(); const a = await svc.sales.closeSale(s1, { ...sale([L('1')], 12000, 'K'), note: ' retira mañana ', externalRef: ' ML-77 ' });
  const s = db.sales.get(a.id)!.sale; assert.deepEqual([s.note, s.externalRef], ['retira mañana', 'ML-77']);
  assert.equal((await svc.sales.closeSale(s1, { ...sale([L('1')], 12000, 'K'), note: 'retira mañana', externalRef: 'ML-77' })).id, a.id);
});
test('key vacía se rechaza antes de cualquier lectura', async () => {
  const { svc } = await stocked(); assert.equal(await code(svc.sales.closeSale(s1, sale([L('1')], 12000, '  '))), 'VALIDATION');
});

// ============ 3. COSTO DE COMPRA POR PRESENTACIÓN = TOTAL DE LA LÍNEA ============
test('10 envases de 500 g por $20.000 total -> 5 kg adquiridos, $4.000/kg derivado (no se guarda)', async () => {
  const { db, svc } = world();
  await svc.purchases.register(admin, fact('1', [{ productId: 'az', presentationId: 'b500', quantity: '10', lineAmount: 20000 }]));
  const it = [...db.purchases.values()][0].items[0];
  assert.deepEqual([it.quantity, it.enteredQuantity, it.enteredUnit, it.costBasis], [5000n, 10000n, 'Bolsa 500 g', 20000]); assert.equal(derivedUnitCost(it.costBasis, it.quantity), '4000.00');
  assert.deepEqual(db.inv.get('main|az'), { qty: 5000n, value: 20000, seq: 1 }); assert.ok(!('unitCost' in it));
});
test('con presentación solo se acepta el TOTAL de la línea; un costo unitario se rechaza (evita ambigüedad por envase vs por kg)', async () => {
  const { db, svc } = world();
  assert.equal(await code(svc.purchases.register(admin, fact('1', [{ productId: 'az', presentationId: 'b500', quantity: '10', unitCost: 4000 }]))), 'VALIDATION');
  assert.equal(await code(svc.purchases.register(admin, fact('2', [{ productId: 'az', presentationId: 'b500', quantity: '10', unitCost: 2000, lineAmount: 20000 }]))), 'VALIDATION');
  assert.equal(db.purchases.size, 0);
});
