import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, code } from '../helpers/world.ts';

const base = { categoryId: 'cat-arriendo', description: 'Arriendo local octubre', expenseDate: '2026-10-05', totalAmount: 650000 };

test('gastos: solo ADMINISTRADOR registra, lista y anula', async () => {
  const { svc } = world();
  assert.equal(await code(svc.expenses.create(s1, base)), 'FORBIDDEN');
  assert.equal(await code(svc.expenses.list(s1, { from: '2026-10-01', to: '2026-10-31' })), 'FORBIDDEN');
  const r = await svc.expenses.create(admin, base);
  assert.equal(await code(svc.expenses.void(s1, r.id, 'x')), 'FORBIDDEN');
});
test('gastos: sin documento va completo al resultado; factura separa IVA y exige número; fecha futura y duplicados se rechazan', async () => {
  const { db, svc } = world();
  const a = await svc.expenses.create(admin, base); assert.equal(db.expensesMap.get(a.id)!.vatRecoverable, false);
  assert.equal(await code(svc.expenses.create(admin, { ...base, docType: 'FACTURA' })), 'VALIDATION', 'factura sin número');
  const f = await svc.expenses.create(admin, { ...base, description: 'Luz', totalAmount: 59500, docType: 'FACTURA', docNumber: ' 00123 ' });
  const e = db.expensesMap.get(f.id)!; assert.deepEqual([e.netAmount, e.vatAmount, e.vatRecoverable, e.docNumber], [50000, 9500, true, '123']);
  assert.equal(await code(svc.expenses.create(admin, { ...base, description: 'Luz otra vez', totalAmount: 59500, docType: 'FACTURA', docNumber: '123' })), 'BUSINESS_RULE', 'misma factura');
  assert.equal(await code(svc.expenses.create(admin, { ...base, expenseDate: '2026-12-31' })), 'VALIDATION', 'fecha futura');
  assert.equal(await code(svc.expenses.create(admin, { ...base, description: ' ' })), 'VALIDATION');
  assert.equal(await code(svc.expenses.create(admin, { ...base, categoryId: 'nope' })), 'VALIDATION');
  const t = await db.expenseReader.totalsByCategory('main', { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(t.map((x) => [x.category, x.total, x.resultCost]), [['Arriendo', 709500, 700000]], 'al resultado: 650.000 + neto 50.000');
});
test('gastos: anular exige motivo, no dos veces, y libera el n° de factura; queda auditado', async () => {
  const { db, svc } = world();
  const f = await svc.expenses.create(admin, { ...base, docType: 'FACTURA', docNumber: '77' });
  assert.equal(await code(svc.expenses.void(admin, f.id, ' ')), 'VALIDATION');
  await svc.expenses.void(admin, f.id, 'monto equivocado');
  assert.equal(await code(svc.expenses.void(admin, f.id, 'otra vez')), 'BUSINESS_RULE');
  await svc.expenses.create(admin, { ...base, docType: 'FACTURA', docNumber: '77', totalAmount: 600000 });
  assert.ok(db.audit.some((x) => x.action === 'expense.void') && db.audit.some((x) => x.action === 'expense.create'));
});
test('gastos: categorías nuevas, renombrar y desactivar; categoría inactiva no admite gastos', async () => {
  const { svc } = world();
  const c = await svc.expenses.createCategory(admin, 'Transporte');
  await svc.expenses.updateCategory(admin, c.id, { name: 'Transporte y fletes', isActive: false });
  assert.equal(await code(svc.expenses.create(admin, { ...base, categoryId: c.id })), 'BUSINESS_RULE');
  assert.ok(!(await svc.expenses.categories(admin)).some((x) => x.id === c.id));
  assert.ok((await svc.expenses.categories(admin, true)).some((x) => x.name === 'Transporte y fletes'));
});
