import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, s2, sale } from '../helpers/world.ts';
import { buildBoleta, buildCreditNoteForBoleta, medioPagoFor, toOrg, type HttpCall } from '../../src/integrations/openfactura.ts';
import { createDteService } from '../../src/services/dte.service.ts';

const ORG_RAW = { actividades: [{ giro: 'VENTA AL POR MENOR', codigoActividadEconomica: '472101', actividadPrincipal: true }], rut: '78485985-1', razonSocial: 'OVELIX SPA', glosaDescriptiva: 'VENTA AL POR MENOR', direccion: 'MANUEL MONTT 1041', comuna: 'Providencia', cdgSIISucur: '123', direccionRegional: 'PROVIDENCIA', resolucion: { fecha: '2025-01-10', numero: '0' } };
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

test('nota de crédito 61 que anula una boleta: montos brutos, Acteco, referencia a la 39 con CodRef 1', () => {
  assert.equal(ORG.acteco, 472101);
  const d = buildCreditNoteForBoleta(ORG, '2026-10-13', { folio: 15200, fecha: '2026-10-12', lines: [{ name: 'Vela Dorada', qty: 1, lineTotal: 990, exempt: false }], totals: { neto: 832, iva: 158, exento: 0, total: 990 } }, 'Venta anulada') as any;
  assert.deepEqual(d.Encabezado.IdDoc, { TipoDTE: 61, Folio: 0, FchEmis: '2026-10-13', MntBruto: 1 });
  assert.equal(d.Encabezado.Emisor.Acteco, 472101); assert.equal(d.Encabezado.Emisor.RznSoc, 'OVELIX SPA');
  assert.deepEqual(d.Encabezado.Totales, { MntNeto: 832, TasaIVA: '19', IVA: 158, MntTotal: 990 });
  assert.deepEqual(d.Referencia, [{ NroLinRef: 1, TpoDocRef: '39', FolioRef: 15200, FchRef: '2026-10-12', CodRef: 1, RazonRef: 'Venta anulada' }]);
  assert.throws(() => buildCreditNoteForBoleta({ ...ORG, acteco: null }, '2026-10-13', { folio: 1, fecha: '2026-10-12', lines: [], totals: { neto: 0, iva: 0, exento: 0, total: 0 } }, 'x'), /Acteco/);
});

test('anular boleta: solo con la venta anulada, una sola vez, solo el administrador', async () => {
  const { db, svc } = world(); const h = fakeHaulmer();
  const dte = createDteService({ uow: db.ports.uow, integrations: db.ports.integrations, catalog: db.ports.catalog, now: db.now, canSee: (a, id) => svc.sales.getSaleForActor(a, id, true), call: h.call, secret: () => 's'.repeat(32) });
  db.setStock('main', 'az', 15000n, 100000, 2);
  const v = await svc.sales.closeSale(admin, sale([{ productId: 'az', quantity: '1' }], 12000, 'kx', 'CASH'));
  await dte.connect(admin, { apiKey: 'k'.repeat(32) });
  await assert.rejects(dte.annulBoleta(admin, v.id, 'x'), /no tiene boleta/);
  const b = await dte.issueBoleta(admin, v.id);
  await assert.rejects(dte.annulBoleta(admin, v.id, 'x'), /Primero anula la venta/);
  await svc.sales.voidSale(admin, v.id, 'prueba', { ip: null });
  await assert.rejects(dte.annulBoleta(s1, v.id, 'x'), /permiso|autoriz|forbidden/i);
  const nc = await dte.annulBoleta(admin, v.id, 'Anula boleta: prueba');
  assert.equal(nc.refFolio, b.folio); assert.equal(nc.total, 12000);
  const sent = h.calls.at(-1)!; assert.equal(sent.body.dte.Encabezado.IdDoc.TipoDTE, 61); assert.equal(sent.headers['Idempotency-Key'], `ER-NC-prod-${v.id}`);
  assert.equal((await dte.creditNoteFor(admin, v.id))?.folio, nc.folio);
  await assert.rejects(dte.annulBoleta(admin, v.id, 'x'), /ya fue anulada con la nota de crédito/);
});
