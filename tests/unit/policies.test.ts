import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saleScopeFor, canViewSale } from '../../src/policies/sale.policy.ts';
import type { Actor } from '../../src/core/permissions/permissions.ts';
const v: Actor = { userId: 'v1', role: 'VENDEDOR', email: 'v@x.cl', branchId: 'b', banned: false };
const a: Actor = { ...v, userId: 'a1', role: 'ADMINISTRADOR' };
test('alcance: vendedor = propias + hoy; administrador = todo', () => {
  assert.deepEqual(saleScopeFor(v, '2026-10-06'), { createdById: 'v1', businessDate: '2026-10-06' }); assert.deepEqual(saleScopeFor(a, '2026-10-06'), {});
  assert.equal(canViewSale(v, { createdById: 'v1', businessDate: '2026-10-06' }, '2026-10-06'), true);
  assert.equal(canViewSale(v, { createdById: 'v2', businessDate: '2026-10-06' }, '2026-10-06'), false);
  assert.equal(canViewSale(v, { createdById: 'v1', businessDate: '2026-10-05' }, '2026-10-06'), false);
  assert.equal(canViewSale(a, { createdById: 'v2', businessDate: '2020-01-01' }, '2026-10-06'), true);
});
