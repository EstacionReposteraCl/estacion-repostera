import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, code } from '../helpers/world.ts';
import { createQuotesService } from '../../src/services/quotes.service.ts';
import { normalizeRut, quoteTotals, addDays, shownStatus } from '../../src/domain/quotes/quote.ts';

const provider = { legalName: 'OVELIX SpA', tradeName: 'Estación Repostera', rut: '78.485.985-1', address: 'Manuel Montt 1041', phone: '', email: 'x@y.cl', footer: '',
  bank: { holder: 'OVELIX SpA', rut: '78.485.985-1', bank: 'Banco de Chile', accountType: 'Cuenta Vista', accountNumber: '421526229', email: 'x@y.cl' } };
const base = { customer: { name: 'María Pérez', rut: '12.345.678-5' }, validDays: 15, payMethods: ['TRANSFER', 'CASH'], docType: 'BOLETA' };

test('cotización: RUT, totales con IVA incluido, vigencia y vencida', () => {
  assert.equal(normalizeRut('12345678-5'), '12.345.678-5'); assert.equal(normalizeRut('78.485.985-1'), '78.485.985-1'); assert.equal(normalizeRut('12345678-9'), null);
  assert.deepEqual(quoteTotals([{ total: 11900 }], 0), { subtotal: 11900, discount: 0, total: 11900, net: 10000, vat: 1900 });
  assert.equal(addDays('2026-10-30', 7), '2026-11-06'); assert.equal(addDays('2026-12-28', 7), '2027-01-04');
  assert.equal(shownStatus({ status: 'PENDING', validUntil: '2026-11-06' }, '2026-11-07'), 'EXPIRED');
  assert.equal(shownStatus({ status: 'ACCEPTED', validUntil: '2026-11-06' }, '2026-11-07'), 'ACCEPTED');
});

test('cotización: vendedor crea con precios de tienda + despacho; correlativo; enlace firmado; estados', async () => {
  const w = world(); const p = w.db.ports;
  const svc = { quotes: createQuotesService({ uow: p.uow, catalog: p.catalog, integrations: p.integrations, now: p.now, secret: () => 'secreto-de-prueba-1234567890' }) };
  assert.equal(await code(svc.quotes.saveSettings(s1, provider)), 'FORBIDDEN');
  await svc.quotes.saveSettings(admin, provider);
  const a = await svc.quotes.create(s1, { ...base, lines: [{ productId: 'az', qty: '2' }, { name: 'Despacho a domicilio', qty: 1, unitPrice: 3500 }] });
  const g = await svc.quotes.get(s1, a.id);
  assert.equal(g.quote.number, 1); assert.equal(g.quote.total, 2 * 12000 + 3500); assert.equal(g.quote.customer.rut, '12.345.678-5');
  assert.equal(g.quote.provider.bank.accountNumber, '421526229'); assert.equal(g.status, 'PENDING'); assert.equal(g.quote.validDays, 15);
  assert.equal(await code(svc.quotes.create(s1, { ...base, lines: [{ productId: 'az', qty: '1', unitPrice: 9000 }] })), 'FORBIDDEN');   // vendedor no cambia precios
  assert.equal(await code(svc.quotes.create(s1, { ...base, discount: 1000, lines: [{ productId: 'az', qty: '1' }] })), 'FORBIDDEN');
  assert.equal(await code(svc.quotes.create(s1, { ...base, validDays: 10, lines: [{ productId: 'az', qty: '1' }] })), 'VALIDATION');
  assert.equal(await code(svc.quotes.create(s1, { ...base, customer: { name: 'X', rut: '1-1' }, lines: [{ productId: 'az', qty: '1' }] })), 'VALIDATION');
  const b = await svc.quotes.create(admin, { ...base, discount: 2000, lines: [{ productId: 'az', qty: '1', unitPrice: 11000 }] });
  const gb = await svc.quotes.get(admin, b.id); assert.equal(gb.quote.number, 2); assert.equal(gb.quote.total, 9000);
  const ref = await svc.quotes.shareRef(s1, a.id); assert.ok(ref);
  assert.equal((await svc.quotes.publicGet(ref!))?.quote.id, a.id);
  assert.equal(await svc.quotes.publicGet(ref!.slice(0, -1) + (ref!.endsWith('A') ? 'B' : 'A')), null);
  await svc.quotes.setValidity(s1, a.id, 30); const gv = await svc.quotes.get(s1, a.id); assert.equal(gv.quote.validUntil, addDays(gv.quote.date, 30)); assert.equal(gv.quote.validDays, 30);
  assert.equal(await code(svc.quotes.setValidity(s1, a.id, 10)), 'VALIDATION');
  await svc.quotes.setStatus(s1, a.id, 'VOID'); assert.equal((await svc.quotes.get(s1, a.id)).status, 'VOID');
  assert.equal(await code(svc.quotes.setStatus(s1, a.id, 'PENDING')), 'FORBIDDEN');
  await svc.quotes.linkSale(admin, b.id, 'sale1'); const gl = await svc.quotes.get(admin, b.id); assert.equal(gl.quote.status, 'ACCEPTED'); assert.equal(gl.quote.saleId, 'sale1');
  assert.deepEqual((await svc.quotes.list(s1)).map((r) => [r.number, r.status]), [[2, 'ACCEPTED'], [1, 'VOID']]);
});
