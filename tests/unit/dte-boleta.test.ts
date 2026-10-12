import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, s2, sale } from '../helpers/world.ts';
import { buildBoleta, medioPagoFor, toOrg, type HttpCall } from '../../src/integrations/openfactura.ts';
import { createDteService } from '../../src/services/dte.service.ts';

const ORG_RAW = { rut: '78485985-1', razonSocial: 'OVELIX SPA', glosaDescriptiva: 'VENTA AL POR MENOR', direccion: 'MANUEL MONTT 1041', comuna: 'Providencia', cdgSIISucur: '123', direccionRegional: 'PROVIDENCIA', resolucion: { fecha: '2025-01-10', numero: '0' } };
const ORG = toOrg(ORG_RAW);

test('boleta 39: detalle en bruto, neto = round(afecto/1,19), IVA = afecto − neto; cantidades decimales; medio de pago SII', () => {
  const { dte, totals } = buildBoleta(ORG, '2026-10-12', [{ name: 'Sprinkles — 80 g', qty: 1, lineTotal: 2890, exempt: false }, { name: 'Azúcar', qty: 0.08, lineTotal: 960, exempt: false }, { name: 'Gratis', qty: 1, lineTotal: 0, exempt: false }], 3);
  assert.deepEqual(totals, { neto: 3235, iva: 615, exento: 0, total: 3850 });
  const enc = (dte as any).Encabezado;
  assert.deepEqual(enc.IdDoc, { TipoDTE: 39, Folio: 0, FchEmis: '2026-10-12', IndServicio: 3, MedioPago: 3 });
  assert.equal(enc.Emisor.RznSocEmisor, 'OVELIX SPA'); assert.equal(enc.Emisor.Acteco, undefined); assert.deepEqual(enc.Receptor, { RUTRecep: '66666666-6' });
  assert.deepEqual(enc.Totales, { MntNeto: 3235, IVA: 615, MntTotal: 3850 });
  const det = (dte as any).Detalle; assert.equal(det.length, 2); assert.equal(det[0].NmbItem, 'Sprinkles - 80 g');
  assert.deepEqual([det[1].QtyItem, det[1].PrcItem, det[1].MontoItem], [0.08, 12000, 960]);
  assert.equal(medioPagoFor(['CASH']), 1); assert.equal(medioPagoFor(['TRANSFER']), 3); assert.equal(medioPagoFor(['RAPPI']), 2); assert.equal(medioPagoFor([]), undefined);
  assert.throws(() => buildBoleta(ORG, '2026-10-12', [{ name: 'x', qty: 1, lineTotal: 0, exempt: false }]), /líneas con monto/);
});

function fakeHaulmer() {
  const calls: { url: string; body?: any; headers: Record<string, string> }[] = []; let folio = 500;
  const call: HttpCall = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    if (init.headers.apikey !== 'k'.repeat(32)) return { status: 401, text: async () => JSON.stringify({ statusCode: 401, message: 'Access denied' }) };
    if (url.endsWith('/v2/dte/organization')) return { status: 200, text: async () => JSON.stringify(ORG_RAW) };
    if (url.endsWith('/v2/dte/document')) return { status: 200, text: async () => JSON.stringify({ TOKEN: 'tok' + (++folio), FOLIO: folio, TIMBRE: 'iVBORw0KGgo=', RESOLUCION: { fecha: '2025-01-10', numero: 0 } }) };
    return { status: 404, text: async () => '{}' };
  };
  return { calls, call };
}

test('boleta desde una venta: conectar (solo admin), emitir una sola vez, bloqueo de tarjeta y de anuladas, alcance del vendedor', async () => {
  const { db, svc } = world(); const h = fakeHaulmer();
  const dte = createDteService({ uow: db.ports.uow, integrations: db.ports.integrations, catalog: db.ports.catalog, now: db.now, canSee: (a, id) => svc.sales.getSaleForActor(a, id, true), call: h.call, secret: () => 's'.repeat(32) });
  db.setStock('main', 'az', 15000n, 100000, 2);
  const cash = await svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '0,080' }, { productId: 'envio', quantity: '1' }], 960 + 2500, 'kc', 'CASH'));
  const card = await svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '0,080' }], 960, 'kd', 'DEBIT'));
  assert.equal((await dte.status(s1)).configured, false);
  await assert.rejects(dte.issueBoleta(s1, cash.id), /Falta conectar Haulmer/);
  await assert.rejects(dte.connect(s1, { apiKey: 'k'.repeat(32) }), /permiso|autoriz|forbidden/i);
  await assert.rejects(dte.connect(admin, { apiKey: 'x'.repeat(32) }), /rechazó la API Key/);
  await dte.connect(admin, { apiKey: 'k'.repeat(32), env: 'dev' });
  assert.ok(!JSON.stringify(db.audit.at(-1)!.after).includes('k'.repeat(32)));
  assert.ok(h.calls.at(-1)!.url.startsWith('https://dev-api.haulmer.com/v2/dte/'));
  await assert.rejects(dte.issueBoleta(s2, cash.id), /no encontrad|Venta/i);   // otro vendedor no ve la venta
  const b = await dte.issueBoleta(s1, cash.id);
  assert.equal(b.folio, 501); assert.equal(b.total, 3460); assert.equal(b.medioPago, 1); assert.equal(b.emisor.razonSocial, 'OVELIX SPA');
  const sent = h.calls.at(-1)!; assert.equal(sent.headers['Idempotency-Key'], `ER-dev-${cash.id}`); assert.deepEqual(sent.body.response, ['FOLIO', 'TIMBRE', 'RESOLUCION']);
  assert.equal((await dte.forSale(s1, cash.id))?.folio, 501);
  await assert.rejects(dte.issueBoleta(admin, cash.id), /ya tiene la boleta N° 501/);
  await assert.rejects(dte.issueBoleta(admin, card.id), /tarjeta en la máquina TUU/);
  assert.equal((await dte.issueBoleta(admin, card.id, { allowCard: true })).folio, 502);
});
