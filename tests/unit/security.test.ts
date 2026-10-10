import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, PERMISSIONS, permissionsOf, assertCan, type Actor } from '../../src/core/permissions/permissions.ts';
import { findSensitiveKeys, assertNoSensitiveKeys } from '../../src/dto/sensitive.ts';
import { createLogger, redact } from '../../src/core/logger/index.ts';
import { toClientError, AppError } from '../../src/core/errors/index.ts';
import { businessDateOf } from '../../src/core/time/business-date.ts';

const actor = (role: 'ADMINISTRADOR' | 'VENDEDOR', banned = false): Actor => ({ userId: 'u', role, email: 'e@x.cl', branchId: 'b', banned });

test('el vendedor SOLO tiene la lista blanca; ningún permiso sensible', () => {
  assert.deepEqual(permissionsOf('VENDEDOR').sort(), ['cash.close', 'dashboard.seller', 'inventory.read.stock', 'product.read.public', 'sale.create', 'sale.read.own_today', 'sale.reprint.own_today', 'unit.read']);
  for (const p of ['sale.void', 'sale.price_override', 'sale.backdate', 'sale.discount', 'sale.charge.add', 'sale.charge.void', 'sale.return', 'inventory.read.cost', 'inventory.adjust', 'inventory.cost_correction',
    'purchase.read', 'purchase.create', 'purchase.void', 'report.financial', 'feerule.read', 'feerule.write', 'user.write', 'audit.read', 'product.write', 'sale.read.any', 'cash.review', 'money.manage'] as const)
    assert.equal(can('VENDEDOR', p), false, p);
});
test('el administrador tiene todos los permisos', () => assert.ok(PERMISSIONS.every((p) => can('ADMINISTRADOR', p))));
test('assertCan: sin sesión, desactivado o sin permiso', () => {
  assert.throws(() => assertCan(null, 'sale.create'), (e: unknown) => (e as AppError).code === 'UNAUTHENTICATED');
  assert.throws(() => assertCan(actor('ADMINISTRADOR', true), 'sale.create'), (e: unknown) => (e as AppError).code === 'UNAUTHENTICATED');
  assert.throws(() => assertCan(actor('VENDEDOR'), 'sale.void'), (e: unknown) => (e as AppError).code === 'FORBIDDEN');
  assert.doesNotThrow(() => assertCan(actor('VENDEDOR'), 'sale.create'));
});
test('guardia de DTO: detecta claves sensibles a cualquier profundidad', () => {
  assert.deepEqual(findSensitiveKeys({ a: 1, b: [{ c: { realProfit: 1 } }], inventoryValue: 2 }).sort(), ['$.b[0].c.realProfit', '$.inventoryValue']);
  assert.throws(() => assertNoSensitiveKeys({ lines: [{ cost: 1 }] })); assert.doesNotThrow(() => assertNoSensitiveKeys({ name: 'x', price: 1 }));
});
test('logger redacta secretos y datos financieros', () => {
  const lines: string[] = []; const log = createLogger({ write: (l) => lines.push(l) }, () => new Date(0));
  log.info('x', { password: 'p', user: { token: 't', name: 'ok' }, grossProfit: 5 });
  const ctx = JSON.parse(lines[0]).ctx; assert.deepEqual(ctx, { password: '[REDACTED]', user: { token: '[REDACTED]', name: 'ok' }, grossProfit: '[REDACTED]' }); assert.deepEqual(redact([{ cost: 1 }]), [{ cost: '[REDACTED]' }]);
});
test('errores al cliente: sin stack ni detalles internos', () => {
  assert.deepEqual(toClientError(new Error('relation "product_costs" does not exist')), { code: 'INTERNAL', message: 'Ocurrió un error inesperado. Intenta nuevamente.' });
});
test('businessDate en America/Santiago (cruce de medianoche UTC)', () => {
  assert.equal(businessDateOf(new Date('2026-10-06T02:30:00Z')), '2026-10-05'); // 23:30 del día 5 en Santiago (UTC-3 en primavera)
  assert.equal(businessDateOf(new Date('2026-10-06T15:00:00Z')), '2026-10-06');
});
