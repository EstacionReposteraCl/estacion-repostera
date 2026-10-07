import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planInflow, planOutflow, reconcile, assertInvariant, planCostCorrection, averageCostDisplay, type InventoryState, type MovementRow } from '../../src/domain/inventory/inventory.ts';
import { AppError } from '../../src/core/errors/index.ts';

const empty: InventoryState = { qty: 0n, value: 0, seq: 0 };
const apply = (s: InventoryState, m: { qtyAfter: bigint; valueAfter: number; seq: number }): InventoryState => ({ qty: m.qtyAfter, value: m.valueAfter, seq: m.seq });

test('A/B: dos compras -> 15 kg, $100.000, promedio derivado 6666.67', () => {
  const a = planInflow(empty, 10000n, 50000); const sA = apply(empty, a);
  assert.deepEqual([sA.qty, sA.value], [10000n, 50000]);
  const b = planInflow(sA, 5000n, 50000); const sB = apply(sA, b);
  assert.deepEqual([sB.qty, sB.value], [15000n, 100000]);
  assert.equal(averageCostDisplay(sB), '6666.67');
});
test('C/D: venta 0,080 kg cuesta 533; la última salida consume exactamente el resto y deja 0/0', () => {
  const s0: InventoryState = { qty: 15000n, value: 100000, seq: 2 };
  const c = planOutflow(s0, 80n); assert.equal(-c.valueChange, 533);
  const s1 = apply(s0, c); assert.deepEqual([s1.qty, s1.value], [14920n, 99467]);
  const d = planOutflow(s1, 14920n); assert.equal(-d.valueChange, 99467);
  const s2 = apply(s1, d); assert.deepEqual([s2.qty, s2.value], [0n, 0]);
});
test('D2: 3 salidas de 5 kg sobre $100.000 = 33.333 + 33.334 + 33.333', () => {
  let s: InventoryState = { qty: 15000n, value: 100000, seq: 0 }; const costs: number[] = [];
  for (let i = 0; i < 3; i++) { const m = planOutflow(s, 5000n); costs.push(-m.valueChange); s = apply(s, m); }
  assert.deepEqual(costs, [33333, 33334, 33333]); assert.deepEqual([s.qty, s.value], [0n, 0]);
});
test('D3: 1 kg vendido en 143 salidas de 7 g, siempre >= 0 y cierra en 0/0', () => {
  let s: InventoryState = { qty: 1000n, value: 7777, seq: 0 }; let total = 0;
  for (let i = 0; i < 142; i++) { const m = planOutflow(s, 7n); total += -m.valueChange; s = apply(s, m); assertInvariant(s); }
  const last = planOutflow(s, s.qty); total += -last.valueChange; s = apply(s, last);
  assert.deepEqual([s.qty, s.value, total], [0n, 0, 7777]);
});
test('D4 (núcleo): estado con stock 0 y valor ≠ 0 es inválido', () => {
  assert.throws(() => assertInvariant({ qty: 0n, value: 5 }), AppError);
  assert.throws(() => assertInvariant({ qty: 10n, value: -1 }), AppError);
});
test('E (núcleo): no se vende más de lo que hay', () => {
  assert.throws(() => planOutflow({ qty: 1000n, value: 5000, seq: 1 }, 1001n), (e: unknown) => e instanceof AppError && e.code === 'INSUFFICIENT_STOCK');
});
test('K: cuadratura detecta diferencias', () => {
  let s = empty; const rows: MovementRow[] = [];
  for (const m of [planInflow(empty, 10000n, 50000)]) { rows.push(m); s = apply(s, m); }
  const m2 = planOutflow(s, 80n); rows.push(m2); s = apply(s, m2);
  assert.deepEqual(reconcile(rows, s), []);
  assert.ok(reconcile(rows, { ...s, value: s.value + 1 }).length > 0);
  assert.ok(reconcile([rows[0], { ...rows[1], seq: 3 }], s).length > 0);
});
test('corrección de costo: cantidad 0, exige motivo y stock', () => {
  const s: InventoryState = { qty: 1000n, value: 5000, seq: 1 };
  const m = planCostCorrection(s, 6000, 'error de digitación'); assert.equal(m.quantity, 0n); assert.equal(m.valueChange, 1000);
  assert.throws(() => planCostCorrection(s, 6000, '  ')); assert.throws(() => planCostCorrection(empty, 6000, 'x'));
});
