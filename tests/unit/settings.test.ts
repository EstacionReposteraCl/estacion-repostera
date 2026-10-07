import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, code } from '../helpers/world.ts';
import { parsePercent, normalizeRut } from '../../src/services/settings.service.ts';

test('configuración: porcentaje con coma o punto, máx. 3 decimales y ≤ 100 %', () => {
  assert.equal(parsePercent('1,5'), 1500); assert.equal(parsePercent('0'), 0); assert.equal(parsePercent('13.99'), 13990); assert.equal(parsePercent('100'), 100000);
  for (const bad of ['-1', '1,2345', 'abc', '101', '']) assert.throws(() => parsePercent(bad), /Porcentaje|100/);
});
test('configuración: RUT con dígito verificador (incluye K y 0) y formato canónico', () => {
  assert.equal(normalizeRut('78485985-1'), '78.485.985-1'); assert.equal(normalizeRut('78.485.985-1'), '78.485.985-1');
  assert.equal(normalizeRut('11.111.111-1'), '11.111.111-1'); assert.equal(normalizeRut('10.000.013-k'), '10.000.013-K');
  assert.throws(() => normalizeRut('78.485.985-2'), /verificador/); assert.throws(() => normalizeRut('123'), /RUT/);
});
test('configuración: solo ADMINISTRADOR; datos del negocio y regla de comisión quedan auditados con antes/después', async () => {
  const { db, svc } = world();
  assert.equal(await code(svc.settings.overview(s1)), 'FORBIDDEN');
  assert.equal(await code(svc.settings.updateBusiness(s1, { legalName: 'X' })), 'FORBIDDEN');
  assert.equal(await code(svc.settings.saveFeeRule(s1, { target: 'PAYMENT_METHOD', targetId: 'DEBIT', percent: '1', fixedAmount: 0, isManualPerSale: false, isActive: true })), 'FORBIDDEN');
  await svc.settings.updateBusiness(admin, { legalName: '  Estación Repostera SpA ', taxId: '78485985-1', address: 'Av. Siempre Viva 123', receiptFooter: 'Cambios con boleta' });
  assert.equal(db.biz.legalName, 'Estación Repostera SpA'); assert.equal(db.biz.taxId, '78.485.985-1');
  const a = db.audit.find((x) => x.action === 'settings.business')!; assert.equal((a.before as { legalName: string }).legalName, 'OVELIX SPA');
  assert.equal(await code(svc.settings.updateBusiness(admin, { legalName: 'Ok', email: 'no-es-correo' })), 'VALIDATION');
  await svc.settings.saveFeeRule(admin, { target: 'PAYMENT_METHOD', targetId: 'DEBIT', percent: '1,49', fixedAmount: 0, isManualPerSale: false, isActive: true });
  assert.equal(db.feeRows.get('PAYMENT_METHOD:DEBIT')!.percentMilli, 1490);
  assert.ok(db.audit.some((x) => x.action === 'feerule.update'));
  assert.equal(await code(svc.settings.saveFeeRule(admin, { target: 'CHANNEL', targetId: 'ML', percent: '5', fixedAmount: -1, isManualPerSale: false, isActive: true })), 'VALIDATION');
});
test('configuración: renombrar/desactivar canal valida nombre y existencia', async () => {
  const { db, svc } = world();
  db.entries.set('ML', { id: 'ML', code: 'MERCADO_LIBRE', name: 'Mercado Libre', isActive: true, sortOrder: 4, kind: 'channel' });
  await svc.settings.updateEntry(admin, 'channel', 'ML', { name: 'MercadoLibre', isActive: false });
  assert.equal(db.entries.get('ML')!.isActive, false);
  assert.equal(await code(svc.settings.updateEntry(admin, 'channel', 'NOPE', { name: 'xx', isActive: true })), 'NOT_FOUND');
  assert.equal(await code(svc.settings.updateEntry(admin, 'paymentMethod', 'ML', { name: 'xx', isActive: true })), 'NOT_FOUND');
  assert.equal(await code(svc.settings.updateEntry(admin, 'channel', 'ML', { name: 'x', isActive: true })), 'VALIDATION');
});
