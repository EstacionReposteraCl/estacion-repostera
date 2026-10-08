import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, code, sale } from '../helpers/world.ts';

const L = [{ productId: 'az', quantity: '1' }];
test('venta atrasada: solo administrador, con la fecha indicada (no futura, máx. 1 año) y auditada', async () => {
  const { db, svc } = world();
  db.inv.set('main|az', { qty: 10000n, value: 40000, seq: 1 });
  const r = await svc.sales.closeSale(admin, { ...sale(L, 12000, 'k1', 'CASH'), saleDate: '2026-10-01' });
  const s = [...db.sales.values()].map((x) => x.sale).find((x) => x.id === r.id)!;
  assert.equal(s.businessDate, '2026-10-01');
  assert.ok(db.audit.some((a) => a.action === 'sale.backdate' && (a.metadata as { saleDate: string }).saleDate === '2026-10-01'));
  assert.equal(db.inv.get('main|az')!.qty, 9000n, 'el stock se descuenta igual');
  assert.equal(await code(svc.sales.closeSale(s1, { ...sale(L, 12000, 'k2', 'CASH'), saleDate: '2026-10-01' })), 'FORBIDDEN');
  assert.equal(await code(svc.sales.closeSale(admin, { ...sale(L, 12000, 'k3', 'CASH'), saleDate: '2026-12-01' })), 'VALIDATION');
  assert.equal(await code(svc.sales.closeSale(admin, { ...sale(L, 12000, 'k4', 'CASH'), saleDate: '2024-01-01' })), 'VALIDATION');
  assert.equal(await code(svc.sales.closeSale(admin, { ...sale(L, 12000, 'k5', 'CASH'), saleDate: '01-10-2026' })), 'VALIDATION');
  // la fecha de hoy se trata como venta normal (sin auditoría de atraso); el vendedor puede mandarla
  const today = await svc.sales.posOptions(s1).then((o) => o.today);
  await svc.sales.closeSale(s1, { ...sale(L, 12000, 'k6', 'CASH'), saleDate: today });
  assert.equal(db.audit.filter((a) => a.action === 'sale.backdate').length, 1);
});
