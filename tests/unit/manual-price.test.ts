import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, B, code, sale } from '../helpers/world.ts';

test('precio manual del ADMINISTRADOR queda auditado con precio de catálogo y aplicado; el VENDEDOR no puede', async () => {
  const { db, svc } = world(); db.setStock(B, 'az', 5000n, 50000);
  assert.equal(await code(svc.sales.closeSale(s1, { ...sale([{ productId: 'az', quantity: '1', unitCode: 'KG', manualUnitPrice: 15000 }], 15000, 'mp-s'), channelId: 'ML' })), 'FORBIDDEN');
  const r = await svc.sales.closeSale(admin, { ...sale([{ productId: 'az', quantity: '1', unitCode: 'KG', manualUnitPrice: 15000 }], 15000, 'mp-a'), channelId: 'ML' });
  assert.equal(r.total, 15000);
  const a = db.audit.find((x) => x.action === 'sale.price_override')!;
  assert.deepEqual((a.metadata as { lines: unknown[] }).lines, [{ productId: 'az', name: 'Azúcar', catalogPrice: 12000, appliedPrice: 15000 }]);
});
