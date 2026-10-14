import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, sale } from '../helpers/world.ts';
import { buildFactura, buildCreditNoteForFactura, splitGross, netLinesFor, toOrg, toTaxpayer, type HttpCall } from '../../src/integrations/openfactura.ts';
import { createDteService } from '../../src/services/dte.service.ts';

const ORG_RAW = { actividades: [{ giro: 'VENTA AL POR MENOR', codigoActividadEconomica: '472101', actividadPrincipal: true }], rut: '78485985-1', razonSocial: 'OVELIX SPA', glosaDescriptiva: 'VENTA AL POR MENOR', direccion: 'MANUEL MONTT 1041', comuna: 'Providencia', cdgSIISucur: '123', direccionRegional: 'PROVIDENCIA', resolucion: { fecha: '2025-01-10', numero: '0' } };
const ORG = toOrg(ORG_RAW);
const TP_RAW = { rut: '76086428-5', razonSocial: 'PASTELERIA DULCE SPA', email: 'pagos@dulce.cl', direccion: 'AV. PROVIDENCIA 1234', comuna: 'PROVIDENCIA', actividades: [{ giro: 'ELABORACION DE PRODUCTOS DE PANADERIA Y PASTELERIA', codigoActividadEconomica: 107100, actividadPrincipal: true }] };
const REC = { rut: '76086428-5', razonSocial: 'PASTELERIA DULCE SPA', giro: 'ELABORACION DE PRODUCTOS DE PANADERIA Y PASTELERIA', direccion: 'AV. PROVIDENCIA 1234', comuna: 'PROVIDENCIA' };

test('factura: neto e IVA cuadran al peso con el total; detalle neto; 34 si todo es exento; NC referencia la factura', () => {
  for (let g = 1; g < 50_000; g += 7) { const { neto, iva } = splitGross(g); assert.ok(Math.abs(neto + iva - g) <= 1, String(g)); assert.equal(iva, Math.round(neto * 0.19)); }
  for (const g of [10880, 14672, 12000]) { const { neto, iva } = splitGross(g); assert.equal(neto + iva, g); }
  const nl = netLinesFor([{ name: 'A', qty: 2, lineTotal: 7980, exempt: false }, { name: 'B', qty: 1, lineTotal: 2900, exempt: false }, { name: 'Huevos', qty: 1, lineTotal: 3000, exempt: true }]);
  assert.ok(Math.abs(nl.totals.total - (7980 + 2900 + 3000)) <= 1); assert.equal(nl.lines.filter((l) => !l.exempt).reduce((a, l) => a + l.amount, 0), nl.totals.neto);
  const f = buildFactura(ORG, '2026-10-14', REC, [{ name: 'Sicao 800 g', qty: 1, lineTotal: 7990, exempt: false }, { name: 'Envío', qty: 1, lineTotal: 2890, exempt: false }], 2);
  const enc = (f.dte as any).Encabezado;
  assert.equal(f.tipo, 33); assert.deepEqual(enc.IdDoc, { TipoDTE: 33, Folio: 0, FchEmis: '2026-10-14', TpoTranVenta: 1, FmaPago: 2 });
  assert.equal(enc.Emisor.Acteco, 472101); assert.equal(enc.Receptor.RUTRecep, '76086428-5'); assert.equal(enc.Receptor.GiroRecep.length <= 40, true);
  assert.deepEqual(enc.Totales, { MntNeto: 9143, TasaIVA: '19', IVA: 1737, MntTotal: 10880 });
  assert.equal((f.dte as any).Detalle.reduce((a: number, d: any) => a + d.MontoItem, 0), 9143);
  const ex = buildFactura(ORG, '2026-10-14', REC, [{ name: 'Huevos', qty: 1, lineTotal: 3000, exempt: true }], 1);
  assert.equal(ex.tipo, 34); assert.deepEqual((ex.dte as any).Encabezado.Totales, { MntExe: 3000, MntTotal: 3000 });
  const nc = buildCreditNoteForFactura(ORG, '2026-10-15', { tipo: 33, folio: 77, fecha: '2026-10-14', receptor: REC, netLines: f.lines, totals: f.totals }, 'Anula factura');
  assert.equal((nc as any).Encabezado.IdDoc.TipoDTE, 61); assert.deepEqual((nc as any).Encabezado.Totales, enc.Totales);
  assert.deepEqual((nc as any).Referencia[0], { NroLinRef: 1, TpoDocRef: '33', FolioRef: 77, FchRef: '2026-10-14', CodRef: 1, RazonRef: 'Anula factura' });
  assert.equal(toTaxpayer(TP_RAW)!.giro, 'ELABORACION DE PRODUCTOS DE PANADERIA Y PASTELERIA'); assert.equal(toTaxpayer({ rut: null, razonSocial: null }), null);
});

function fakeHaulmer() {
  const calls: { url: string; body?: any }[] = []; let folio = 900;
  const call: HttpCall = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/v2/dte/organization')) return { status: 200, text: async () => JSON.stringify(ORG_RAW) };
    if (url.includes('/v2/dte/taxpayer/76086428-5')) return { status: 200, text: async () => JSON.stringify(TP_RAW) };
    if (url.includes('/v2/dte/taxpayer/')) return { status: 200, text: async () => JSON.stringify({ rut: null, razonSocial: null }) };
    if (url.endsWith('/v2/dte/document')) return { status: 200, text: async () => JSON.stringify({ TOKEN: 'tok' + (++folio), FOLIO: folio, TIMBRE: 'iVBORw0KGgo=', RESOLUCION: { fecha: '2025-01-10', numero: 0 } }) };
    return { status: 404, text: async () => '{}' };
  };
  return { calls, call };
}

test('factura desde una venta: cliente por RUT (SII y luego guardado), una sola vez (ni boleta después), tarjeta pide confirmación, anulación con NC', async () => {
  const { db, svc } = world(); db.clock = new Date('2026-10-14T15:00:00Z'); const h = fakeHaulmer();
  const dte = createDteService({ uow: db.ports.uow, integrations: db.ports.integrations, catalog: db.ports.catalog, now: db.now, canSee: (a, id) => svc.sales.getSaleForActor(a, id, true), call: h.call, secret: () => 's'.repeat(32) });
  db.setStock('main', 'az', 15000n, 100000, 2);
  await dte.connect(admin, { apiKey: 'k'.repeat(32) });
  const c = await dte.customer(admin, '76.086.428-5'); assert.equal(c?.source, 'sii'); assert.equal(c?.receptor.razonSocial, 'PASTELERIA DULCE SPA');
  assert.equal(await dte.customer(admin, '11.111.111-1'), null);
  await assert.rejects(dte.customer(admin, '76.086.428-4'), /dígito verificador/);

  const v = await svc.sales.closeSale(admin, sale([{ productId: 'az', quantity: '1' }], 12000, 'kf', 'CASH'));
  await assert.rejects(dte.issueFactura(admin, v.id, { receptor: { ...REC, giro: '' }, fmaPago: 1 }), /giro/);
  const f = await dte.issueFactura(admin, v.id, { receptor: { ...REC, rut: '76.086.428-5' }, fmaPago: 2 });
  assert.deepEqual([f.tipo, f.total, f.neto + f.iva, f.fmaPago], [33, 12000, 12000, 2]);
  const sent = h.calls.filter((x) => x.url.endsWith('/document')).at(-1)!; assert.equal(sent.body.dte.Encabezado.Receptor.RznSocRecep, 'PASTELERIA DULCE SPA');
  assert.equal((await dte.customer(admin, '76086428-5'))?.source, 'saved');
  await assert.rejects(dte.issueFactura(admin, v.id, { receptor: REC, fmaPago: 1 }), /ya tiene la factura/);
  await assert.rejects(dte.issueBoleta(admin, v.id), /ya tiene la factura/);

  const t = await svc.sales.closeSale(admin, sale([{ productId: 'az', quantity: '1' }], 12000, 'kt', 'DEBIT'));
  await assert.rejects(dte.issueFactura(admin, t.id, { receptor: REC, fmaPago: 1 }), /tarjeta/);
  await assert.rejects(dte.issueFactura(s1, v.id, { receptor: REC, fmaPago: 1 }), /no encontrad|permiso|autoriz|forbidden/i);

  await svc.sales.voidSale(admin, v.id, 'cliente devolvió', { ip: null });
  const nc = await dte.annulBoleta(admin, v.id, 'Anula factura: cliente devolvió');
  assert.equal(nc.refTipo, 33); assert.equal(nc.refFolio, f.folio); assert.equal(nc.receptor?.rut, '76.086.428-5');
  const ncSent = h.calls.filter((x) => x.url.endsWith('/document')).at(-1)!.body.dte;
  assert.equal(ncSent.Referencia[0].TpoDocRef, '33'); assert.equal(ncSent.Encabezado.Receptor.RUTRecep, '76086428-5');
});
