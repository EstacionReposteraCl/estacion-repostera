import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExpense } from '../../src/domain/expenses/expenses.ts';
import { AppError } from '../../src/core/errors/index.ts';
const code = (f: () => unknown) => { try { f(); return 'NONE'; } catch (e) { return e instanceof AppError ? e.code : 'OTHER'; } };

test('gasto con factura: neto e IVA desde el total; al resultado va el neto', () => {
  assert.deepEqual(planExpense({ docType: 'FACTURA', totalAmount: 119000 }), { netAmount: 100000, vatAmount: 19000, totalAmount: 119000, vatRecoverable: true, resultCost: 100000 });
  assert.deepEqual(planExpense({ docType: 'FACTURA', totalAmount: 1000 }), { netAmount: 840, vatAmount: 160, totalAmount: 1000, vatRecoverable: true, resultCost: 840 });
});
test('gasto con factura: neto e IVA explícitos se respetan si suman el total', () => {
  assert.equal(planExpense({ docType: 'FACTURA', totalAmount: 1000, netAmount: 841, vatAmount: 159 }).resultCost, 841);
  assert.equal(code(() => planExpense({ docType: 'FACTURA', totalAmount: 1000, netAmount: 841, vatAmount: 160 })), 'VALIDATION');
});
test('boleta / otro / sin documento: IVA no recuperable; al resultado va el total', () => {
  for (const d of ['BOLETA', 'OTRO', null] as const) assert.deepEqual(planExpense({ docType: d, totalAmount: 45990 }), { netAmount: 45990, vatAmount: 0, totalAmount: 45990, vatRecoverable: false, resultCost: 45990 });
});
test('montos inválidos', () => { for (const t of [0, -1, 1.5, Number.NaN]) assert.equal(code(() => planExpense({ docType: null, totalAmount: t })), 'VALIDATION'); });
