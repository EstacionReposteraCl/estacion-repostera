// Cliente de la API de OpenFactura (Haulmer) para emitir boletas electrónicas (tipo 39).
// Referencia: docsapi-openfactura.haulmer.com · base {host}/v2/dte · header `apikey` · emisión POST /document.
// Detalle de la boleta en montos BRUTOS (IVA incluido); Emisor con RznSocEmisor/GiroEmisor; receptor genérico 66666666-6.
export type OfEnv = 'prod' | 'dev';
export const OF_HOST: Record<OfEnv, string> = { prod: 'https://api.haulmer.com', dev: 'https://dev-api.haulmer.com' };
export type HttpCall = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: () => Promise<string> }>;

export interface OfOrg { rut: string; razonSocial: string; giro: string; direccion: string; comuna: string; cdgSIISucur: string; direccionRegional: string; resolucion: { fecha: string; numero: number }; acteco?: number | null }
export interface BoletaLine { name: string; qty: number; lineTotal: number; exempt: boolean }
export interface BoletaTotals { neto: number; iva: number; exento: number; total: number }
export interface EmitResult { folio: number; token: string; timbre: string | null; resolucion: { fecha: string; numero: number } | null; warning: string | null }

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const cut = (v: string, n: number) => (v.length > n ? v.slice(0, n).trim() : v);

export function toOrg(raw: unknown): OfOrg {
  const r = o(raw); const acts = Array.isArray(r.actividades) ? r.actividades.map(o) : []; const main = acts.find((a) => a.actividadPrincipal) ?? acts[0] ?? {};
  const res = o(r.resolucion);
  return { rut: s(r.rut), razonSocial: s(r.razonSocial), giro: s(r.glosaDescriptiva) || s(main.giro), direccion: s(r.direccion), comuna: s(r.comuna), cdgSIISucur: s(r.cdgSIISucur),
    direccionRegional: s(r.direccionRegional), resolucion: { fecha: s(res.fecha), numero: Number(s(res.numero)) || 0 }, acteco: Number(s(main.codigoActividadEconomica)) || null };
}

/** Medio de pago de la boleta (SII): 1 efectivo, 2 pago electrónico, 3 transferencia, 5 otro. */
export function medioPagoFor(codes: string[]): number | undefined {
  const main = codes[0]; if (!main) return undefined;
  if (main === 'CASH') return 1; if (main === 'TRANSFER') return 3;
  if (['DEBIT', 'CREDIT', 'MERCADO_PAGO', 'RAPPI', 'UBER', 'HISTORICO_TUU'].includes(main)) return 2;
  return 5;
}

/** Arma el DTE 39 y sus totales (afecto: neto = round(bruto/1,19), IVA = bruto − neto). */
export function buildBoleta(org: OfOrg, fecha: string, lines: BoletaLine[], medioPago?: number): { dte: Record<string, unknown>; totals: BoletaTotals } {
  const ls = lines.filter((l) => l.lineTotal > 0 && l.qty > 0);
  if (ls.length === 0) throw new Error('La venta no tiene líneas con monto para la boleta.');
  const afecto = ls.filter((l) => !l.exempt).reduce((a, l) => a + l.lineTotal, 0); const exento = ls.filter((l) => l.exempt).reduce((a, l) => a + l.lineTotal, 0);
  if (afecto === 0) throw new Error('Todas las líneas son exentas: corresponde boleta exenta (41), no 39.');
  const neto = Math.round(afecto / 1.19); const iva = afecto - neto; const total = afecto + exento;
  const Detalle = ls.map((l, i) => {
    const q = Math.round(l.qty * 1e6) / 1e6; const prc = q === 1 ? l.lineTotal : Math.round((l.lineTotal / q) * 1e6) / 1e6;
    return { NroLinDet: i + 1, NmbItem: cut(l.name.replace(/[–—]/g, '-'), 80), QtyItem: q, PrcItem: prc, MontoItem: l.lineTotal, ...(l.exempt ? { IndExe: 1 } : {}) };
  });
  const Emisor: Record<string, unknown> = { RUTEmisor: org.rut, RznSocEmisor: cut(org.razonSocial, 100), GiroEmisor: cut(org.giro, 80), DirOrigen: cut(org.direccion, 70), CmnaOrigen: cut(org.comuna, 20) };
  if (org.cdgSIISucur) Emisor.CdgSIISucur = org.cdgSIISucur;
  const IdDoc: Record<string, unknown> = { TipoDTE: 39, Folio: 0, FchEmis: fecha, IndServicio: 3 }; if (medioPago) IdDoc.MedioPago = medioPago;
  return {
    dte: { Encabezado: { IdDoc, Emisor, Receptor: { RUTRecep: '66666666-6' }, Totales: { MntNeto: neto, ...(exento ? { MntExe: exento } : {}), IVA: iva, MntTotal: total } }, Detalle },
    totals: { neto, iva, exento, total },
  };
}

/**
 * Nota de crédito (61) que ANULA una boleta (CodRef 1, TpoDocRef 39) por el mismo detalle y montos.
 * Montos brutos (IdDoc.MntBruto = 1) como la boleta; receptor genérico; Emisor con Acteco (formato de factura/nota).
 */
export function buildCreditNoteForBoleta(org: OfOrg, fecha: string, b: { folio: number; fecha: string; lines: BoletaLine[]; totals: BoletaTotals }, razon: string): Record<string, unknown> {
  if (!org.acteco) throw new Error('Falta la actividad económica (Acteco) del emisor en Haulmer.');
  const Detalle = b.lines.filter((l) => l.lineTotal > 0 && l.qty > 0).map((l, i) => {
    const q = Math.round(l.qty * 1e6) / 1e6; const prc = q === 1 ? l.lineTotal : Math.round((l.lineTotal / q) * 1e6) / 1e6;
    return { NroLinDet: i + 1, NmbItem: cut(l.name.replace(/[\u2013\u2014]/g, '-'), 80), QtyItem: q, PrcItem: prc, MontoItem: l.lineTotal, ...(l.exempt ? { IndExe: 1 } : {}) };
  });
  const Emisor: Record<string, unknown> = { RUTEmisor: org.rut, RznSoc: cut(org.razonSocial, 100), GiroEmis: cut(org.giro, 80), Acteco: org.acteco, DirOrigen: cut(org.direccion, 70), CmnaOrigen: cut(org.comuna, 20) };
  if (org.cdgSIISucur) Emisor.CdgSIISucur = org.cdgSIISucur;
  const t = b.totals;
  return {
    Encabezado: {
      IdDoc: { TipoDTE: 61, Folio: 0, FchEmis: fecha, MntBruto: 1 }, Emisor,
      Receptor: { RUTRecep: '66666666-6', RznSocRecep: 'CLIENTE BOLETA', GiroRecep: 'PARTICULAR', DirRecep: cut(org.direccion, 70), CmnaRecep: cut(org.comuna, 20) },
      Totales: { MntNeto: t.neto, ...(t.exento ? { MntExe: t.exento } : {}), TasaIVA: '19', IVA: t.iva, MntTotal: t.total },
    },
    Detalle,
    Referencia: [{ NroLinRef: 1, TpoDocRef: '39', FolioRef: b.folio, FchRef: b.fecha, CodRef: 1, RazonRef: cut(razon || 'Anula boleta', 90) }],
  };
}

/** Datos del cliente (receptor) de una factura. */
export interface Receptor { rut: string; razonSocial: string; giro: string; direccion: string; comuna: string; email?: string | null }
/** Línea en montos NETOS tal como va en la factura (para imprimirla igual). */
export interface NetLine { name: string; qty: number; price: number; amount: number; exempt: boolean }
export interface FacturaTotals { neto: number; iva: number; exento: number; total: number }

/** Neto e IVA de un monto bruto afecto, buscando el neto cuyo IVA (19% redondeado) sume exactamente el bruto. */
export function splitGross(gross: number): { neto: number; iva: number } {
  if (gross <= 0) return { neto: 0, iva: 0 };
  const n0 = Math.round(gross / 1.19);
  let best = { neto: n0, iva: Math.round(n0 * 0.19) };
  for (const d of [0, -1, 1, -2, 2]) {
    const n = n0 + d; const iva = Math.round(n * 0.19); if (n + iva === gross) return { neto: n, iva };
    const off = Math.abs(n + iva - gross), cur = Math.abs(best.neto + best.iva - gross);
    if (off < cur || (off === cur && n + iva < best.neto + best.iva)) best = { neto: n, iva };
  }
  return best;     // algunos montos no tienen neto exacto (el IVA redondeado salta ese valor): el documento difiere en $1
}

/** Detalle en netos (factura): reparte el neto total entre las líneas afectas; las exentas van por su monto. */
export function netLinesFor(lines: BoletaLine[]): { lines: NetLine[]; totals: FacturaTotals } {
  const ls = lines.filter((l) => l.lineTotal > 0 && l.qty > 0);
  if (ls.length === 0) throw new Error('La venta no tiene líneas con monto para la factura.');
  const afecto = ls.filter((l) => !l.exempt).reduce((a, l) => a + l.lineTotal, 0); const exento = ls.filter((l) => l.exempt).reduce((a, l) => a + l.lineTotal, 0);
  const { neto, iva } = splitGross(afecto);
  const out: NetLine[] = ls.map((l) => ({ name: l.name, qty: Math.round(l.qty * 1e6) / 1e6, exempt: l.exempt, amount: l.exempt ? l.lineTotal : Math.round(l.lineTotal / 1.19), price: 0 }));
  const diff = neto - out.filter((l) => !l.exempt).reduce((a, l) => a + l.amount, 0);
  if (diff !== 0) { const big = out.filter((l) => !l.exempt).sort((a, b) => b.amount - a.amount)[0]; if (big) big.amount += diff; }
  for (const l of out) l.price = l.qty === 1 ? l.amount : Math.round((l.amount / l.qty) * 1e6) / 1e6;
  return { lines: out, totals: { neto, iva, exento, total: neto + iva + exento } };
}

const emisorFull = (org: OfOrg) => {
  if (!org.acteco) throw new Error('Falta la actividad económica (Acteco) del emisor en Haulmer.');
  const e: Record<string, unknown> = { RUTEmisor: org.rut, RznSoc: cut(org.razonSocial, 100), GiroEmis: cut(org.giro, 80), Acteco: org.acteco, DirOrigen: cut(org.direccion, 70), CmnaOrigen: cut(org.comuna, 20) };
  if (org.cdgSIISucur) e.CdgSIISucur = org.cdgSIISucur;
  return e;
};
const receptorOf = (r: Receptor) => ({ RUTRecep: r.rut.replace(/\./g, ''), RznSocRecep: cut(r.razonSocial, 100), GiroRecep: cut(r.giro, 40), DirRecep: cut(r.direccion, 70), CmnaRecep: cut(r.comuna, 20), ...(r.email ? { CorreoRecep: cut(r.email, 80) } : {}) });
const detalleOf = (ls: NetLine[]) => ls.map((l, i) => ({ NroLinDet: i + 1, NmbItem: cut(l.name.replace(/[\u2013\u2014]/g, '-'), 80), QtyItem: l.qty, PrcItem: l.price, MontoItem: l.amount, ...(l.exempt ? { IndExe: 1 } : {}) }));
const totalesOf = (t: FacturaTotals) => (t.neto > 0 ? { MntNeto: t.neto, ...(t.exento ? { MntExe: t.exento } : {}), TasaIVA: '19', IVA: t.iva, MntTotal: t.total } : { MntExe: t.exento, MntTotal: t.total });

/** Factura electrónica: 33 (afecta) o 34 (exenta, si todas las líneas son exentas). Detalle en NETOS. fmaPago: 1 contado, 2 crédito. */
export function buildFactura(org: OfOrg, fecha: string, receptor: Receptor, lines: BoletaLine[], fmaPago: 1 | 2): { tipo: 33 | 34; dte: Record<string, unknown>; lines: NetLine[]; totals: FacturaTotals } {
  const { lines: nl, totals } = netLinesFor(lines); const tipo = totals.neto > 0 ? 33 : 34;
  return { tipo, lines: nl, totals, dte: { Encabezado: { IdDoc: { TipoDTE: tipo, Folio: 0, FchEmis: fecha, TpoTranVenta: 1, FmaPago: fmaPago }, Emisor: emisorFull(org), Receptor: receptorOf(receptor), Totales: totalesOf(totals) }, Detalle: detalleOf(nl) } };
}

/** Nota de crédito (61) que ANULA una factura (CodRef 1): mismo detalle neto, mismo receptor, referencia a la 33/34. */
export function buildCreditNoteForFactura(org: OfOrg, fecha: string, f: { tipo: 33 | 34; folio: number; fecha: string; receptor: Receptor; netLines: NetLine[]; totals: FacturaTotals }, razon: string): Record<string, unknown> {
  return {
    Encabezado: { IdDoc: { TipoDTE: 61, Folio: 0, FchEmis: fecha }, Emisor: emisorFull(org), Receptor: receptorOf(f.receptor), Totales: totalesOf(f.totals) },
    Detalle: detalleOf(f.netLines),
    Referencia: [{ NroLinRef: 1, TpoDocRef: String(f.tipo), FolioRef: f.folio, FchRef: f.fecha, CodRef: 1, RazonRef: cut(razon || 'Anula factura', 90) }],
  };
}

/** Ficha de un contribuyente en el SII (vía Haulmer). null si el RUT no existe. */
export function toTaxpayer(raw: unknown): Receptor | null {
  const r = o(raw); if (!s(r.razonSocial)) return null;
  const acts = Array.isArray(r.actividades) ? r.actividades.map(o) : []; const main = acts.find((a) => a.actividadPrincipal) ?? acts[0] ?? {};
  return { rut: s(r.rut), razonSocial: s(r.razonSocial), giro: s(main.giro) || s(r.glosaDescriptiva), direccion: s(r.direccion), comuna: s(r.comuna), email: s(r.email) || null };
}

export class OpenFacturaError extends Error { readonly status: number; readonly code: string; constructor(message: string, status: number, code = '') { super(message); this.status = status; this.code = code; } }

function errorFrom(status: number, body: string): OpenFacturaError {
  let j: Record<string, unknown> = {}; try { j = o(JSON.parse(body)); } catch { /* cuerpo no JSON */ }
  const e = 'error' in j ? o(j.error) : j; const code = s(e.code); const det = e.details;
  const detail = Array.isArray(det) ? det.map((d) => { const x = o(d); return [s(x.field), s(x.issue)].filter(Boolean).join(': '); }).filter(Boolean).join(' · ') : Object.values(o(det)).map(s).filter(Boolean).join(' · ');
  if (status === 401 || status === 403) return new OpenFacturaError('Haulmer rechazó la API Key (revisa que esté bien copiada).', status, code);
  if (status === 429) return new OpenFacturaError('Haulmer está limitando las solicitudes; espera unos segundos e intenta de nuevo.', status, code);
  return new OpenFacturaError(`Haulmer respondió con error${code ? ` ${code}` : ''}: ${s(e.message) || `HTTP ${status}`}${detail ? ` (${detail})` : ''}`, status, code);
}

export function openFacturaClient(apiKey: string, env: OfEnv, call: HttpCall) {
  const base = OF_HOST[env] + '/v2/dte';
  async function req(method: 'GET' | 'POST', path: string, body?: unknown, extra: Record<string, string> = {}) {
    const r = await call(base + path, { method, headers: { apikey: apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    if (r.status >= 400) throw errorFrom(r.status, text);
    try { return JSON.parse(text) as unknown; } catch { throw new OpenFacturaError('Respuesta inesperada de Haulmer.', r.status); }
  }
  return {
    async organization(): Promise<OfOrg> { return toOrg(await req('GET', '/organization')); },
    async taxpayer(rut: string): Promise<Receptor | null> { return toTaxpayer(await req('GET', `/taxpayer/${encodeURIComponent(rut.replace(/\./g, ''))}`)); },
    /** PDF del documento ya emitido (el mismo que ve el cliente en Haulmer). */
    async pdf(token: string): Promise<Buffer> {
      const b64 = s(o(await req('GET', `/document/${encodeURIComponent(token)}/pdf`)).pdf);
      if (!b64) throw new OpenFacturaError('Haulmer no devolvió el PDF del documento.', 200);
      return Buffer.from(b64, 'base64');
    },
    async emit(dte: Record<string, unknown>, idempotencyKey: string): Promise<EmitResult> {
      const r = o(await req('POST', '/document', { response: ['FOLIO', 'TIMBRE', 'RESOLUCION'], dte }, { 'Idempotency-Key': idempotencyKey }));
      const folio = Number(r.FOLIO); const token = s(r.TOKEN);
      if (!Number.isFinite(folio) || folio <= 0 || !token) throw new OpenFacturaError('Haulmer no devolvió el folio del documento.', 200);
      const res = o(r.RESOLUCION);
      return { folio, token, timbre: s(r.TIMBRE) || null, resolucion: r.RESOLUCION ? { fecha: s(res.fecha), numero: Number(s(res.numero)) || 0 } : null, warning: s(r.WARNING) || null };
    },
  };
}
