import { assertCan, can, type Actor } from '../core/permissions/permissions.ts';
import { validation, businessRule, notFound } from '../core/errors/index.ts';
import { seal, open } from '../core/crypto/secret-box.ts';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { businessDateOf } from '../core/time/business-date.ts';
import { tedFromXml, resolucionFromXml, linesFromDetail, referencesFromDetail, type IssuedDoc } from '../integrations/openfactura.ts';
import { openFacturaClient, buildBoleta, buildCreditNoteForBoleta, buildFactura, buildCreditNoteForFactura, medioPagoFor, OpenFacturaError, type HttpCall, type OfEnv, type OfOrg, type Receptor, type NetLine } from '../integrations/openfactura.ts';
import { normalizeRut } from './settings.service.ts';
import type { UnitOfWork, IntegrationStore, CatalogReader } from '../repositories/ports.ts';

const PURPOSE = 'integration:openfactura';
const CARD = ['DEBIT', 'CREDIT', 'HISTORICO_TUU'];
const defaultCall: HttpCall = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000), cache: 'no-store' });
  return { status: r.status, text: () => r.text() };
};
const milliToNumber = (m: bigint) => Number(m) / 1000;

/** Boleta emitida (bitácora: action 'dte.issue', entidad Sale). Es lo que se imprime y se reimprime. */
export interface BoletaRecord {
  tipo: 39; folio: number; token: string; fecha: string; env: OfEnv; total: number; neto: number; iva: number; exento: number; medioPago: number | null;
  lines: { name: string; qty: number; lineTotal: number; exempt?: boolean }[]; emisor: OfOrg; resolucion: { fecha: string; numero: number }; timbre: string | null; warning: string | null; saleFolio: number;
  /** Boleta emitida FUERA del sistema (Espacio de Trabajo de Haulmer o la página web) y traída para imprimirla y compartirla. */
  origin?: 'web' | 'haulmer' | null;
}
/** Factura emitida (33 afecta / 34 exenta). Mismo registro 'dte.issue' que la boleta: una venta tiene UN documento. */
export interface FacturaRecord {
  tipo: 33 | 34; folio: number; token: string; fecha: string; env: OfEnv; total: number; neto: number; iva: number; exento: number; fmaPago: 1 | 2; receptor: Receptor;
  netLines: NetLine[]; lines: { name: string; qty: number; lineTotal: number; exempt?: boolean }[]; emisor: OfOrg; resolucion: { fecha: string; numero: number }; timbre: string | null; warning: string | null; saleFolio: number;
}
export type DteRecord = BoletaRecord | FacturaRecord;
export const docName = (tipo: number) => (tipo === 39 ? 'boleta' : tipo === 34 ? 'factura exenta' : 'factura');
/** Nota de crédito que anuló la boleta de una venta (bitácora: action 'dte.void', entidad Sale). */
export interface CreditNoteRecord {
  tipo: 61; folio: number; token: string; fecha: string; env: OfEnv; refFolio: number; refFecha: string; reason: string; total: number; neto: number; iva: number; exento: number;
  lines: { name: string; qty: number; lineTotal: number; exempt?: boolean }[]; emisor: OfOrg; resolucion: { fecha: string; numero: number }; timbre: string | null; warning: string | null; saleFolio: number;
  /** true = anulada a mano en el Espacio de Trabajo de Haulmer (el sistema solo lo registra; no hay timbre para imprimir). */
  manual?: boolean;
  /** Documento anulado (39 boleta por defecto; 33/34 factura) y, si es factura, su receptor y detalle neto. */
  refTipo?: 39 | 33 | 34; receptor?: Receptor; netLines?: NetLine[];
}
export interface Deps {
  uow: UnitOfWork; integrations: IntegrationStore; catalog: CatalogReader; now?: () => Date;
  /** Verifica que el actor puede ver la venta (vendedor: solo las suyas de hoy). */
  canSee: (actor: Actor, saleId: string) => Promise<unknown>;
  call?: HttpCall; secret?: () => string;
  /** Dibuja el timbre (PDF417) desde el TED: PNG en base64. */
  pdf417?: (ted: string) => Promise<string>;
}
const defaultPdf417 = async (ted: string) => {
  const bwip = await import('bwip-js/node');
  const png = await bwip.toBuffer({ bcid: 'pdf417', text: ted, eclevel: 5, columns: 12, scale: 2, height: 2, binarytext: true } as never);
  return png.toString('base64');
};

/**
 * Boleta electrónica (39) emitida desde el sistema con la API de OpenFactura (Haulmer).
 * Conectar (API Key, cifrada en la bitácora): solo ADMINISTRADOR. Emitir y reimprimir: quien puede ver la venta.
 */
export function createDteService({ uow, integrations, catalog, canSee, now = () => new Date(), call = defaultCall, secret = () => process.env.BETTER_AUTH_SECRET ?? '', pdf417 = defaultPdf417 }: Deps) {
  async function config(): Promise<{ apiKey: string; env: OfEnv; org: OfOrg } | null> {
    const a = await integrations.latest('openfactura'); if (!a) return null;
    const apiKey = typeof a.keyBox === 'string' ? open(a.keyBox, secret(), PURPOSE) : null;
    const env: OfEnv = a.env === 'dev' ? 'dev' : 'prod';
    return apiKey && a.org ? { apiKey, env, org: a.org as OfOrg } : null;
  }
  const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) {
      if (e instanceof OpenFacturaError) throw businessRule(e.code === 'OF-06' ? 'Esta boleta ya se envió a Haulmer hace un momento. Recarga la página en unos segundos.' : e.message);
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw businessRule('Haulmer no respondió a tiempo. Revisa en el Espacio de Trabajo si la boleta quedó emitida antes de reintentar.');
      throw e;
    }
  };
  const existing = async (saleId: string) => (await integrations.latestEntry('dte.issue', 'Sale', saleId)) as DteRecord | null;
  const existingNc = async (saleId: string) => (await integrations.latestEntry('dte.void', 'Sale', saleId)) as CreditNoteRecord | null;

  /** Firma del enlace público para compartir el documento (no se puede adivinar ni cambiar de venta). */
  const sig = (saleId: string) => createHmac('sha256', secret()).update(`share-dte:${saleId}`).digest('base64url').slice(0, 24);

  /** Trae una boleta ya emitida (por su token) y la deja asociada a la venta, lista para imprimir en formato térmico. */
  async function attach(actor: Actor, saleId: string, c: { apiKey: string; env: OfEnv; org: OfOrg }, d: IssuedDoc, origin: 'web' | 'haulmer'): Promise<BoletaRecord> {
    const cl = openFacturaClient(c.apiKey, c.env, call);
    const [json, xml] = await Promise.all([wrap(() => cl.detail(d.token)), wrap(() => cl.xml(d.token))]);
    const ted = tedFromXml(xml)?.replace(/>\s+</g, '><') ?? null; const timbre = ted ? await pdf417(ted) : null;   // el timbre va sin espacios entre etiquetas
    const got = await uow.run((tx) => tx.sales.getWithItems(saleId)); if (!got) throw notFound('Venta');
    const rec: BoletaRecord = { tipo: 39, folio: d.folio, token: d.token, fecha: d.fecha, env: c.env, total: d.total, neto: d.neto, iva: d.iva, exento: d.exento, medioPago: null,
      lines: linesFromDetail(json), emisor: c.org, resolucion: resolucionFromXml(xml) ?? c.org.resolucion, timbre, warning: ted ? null : 'No se encontró el timbre en el XML.', saleFolio: got.sale.folio, origin };
    await uow.run((tx) => tx.audit.write({ action: 'dte.issue', entity: 'Sale', entityId: saleId, userId: actor.userId, after: rec, metadata: { attached: true, origin } }));
    return rec;
  }
  /** La boleta ya está usada por otra venta del sistema? */
  async function folioTaken(folio: number): Promise<boolean> {
    const list = await integrations.latestEntries('dte.issue', 'Sale', 2000);
    return list.some((e) => { const a = e.after as { tipo?: number; folio?: number } | null; return a?.tipo === 39 && a.folio === folio; });
  }

  /** Modo "boleta desde el sistema": al cobrar se emite la boleta aquí; la máquina TUU solo cobra (no emite boleta). */
  const autoOn = async () => (await integrations.latest('dte-auto'))?.enabled === true;

  return {
    async autoBoleta(actor: Actor | null): Promise<boolean> { assertCan(actor, 'dte.issue'); return (await config()) !== null && autoOn(); },
    async setAutoBoleta(actor: Actor | null, enabled: boolean): Promise<void> {
      assertCan(actor, 'settings.write');
      if (enabled && !(await config())) throw businessRule('Primero conecta Haulmer.');
      await uow.run((tx) => tx.audit.write({ action: 'integration.set', entity: 'dte-auto', entityId: 'dte-auto', userId: actor.userId, after: { enabled: enabled === true } }));
    },
    /** Boletas emitidas en Haulmer en una fecha (para traer una que se emitió fuera del sistema). */
    async issuedOn(actor: Actor | null, fecha: string): Promise<IssuedDoc[]> {
      assertCan(actor, 'dte.issue');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw validation('Fecha inválida.');
      const c = await config(); if (!c) throw businessRule('Falta conectar Haulmer.');
      return (await wrap(() => openFacturaClient(c.apiKey, c.env, call).issued(fecha))).filter((d) => d.tipo === 39).sort((a, b) => b.folio - a.folio);
    },
    /** Asocia a la venta una boleta ya emitida en Haulmer (por folio y fecha). El total debe coincidir con el de la venta. */
    async attachIssued(actor: Actor | null, saleId: string, i: { folio: number; fecha: string }): Promise<BoletaRecord> {
      assertCan(actor, 'dte.issue'); saleId = String(saleId); await canSee(actor, saleId);
      const prev = await existing(saleId); if (prev) throw businessRule(`Esta venta ya tiene la ${docName(prev.tipo)} N° ${prev.folio}.`);
      const folio = Math.trunc(Number(i.folio)); if (!folio || folio <= 0) throw validation('Escribe el N° de la boleta.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(i.fecha)) throw validation('Fecha de la boleta inválida.');
      const c = await config(); if (!c) throw businessRule('Falta conectar Haulmer.');
      const got = await uow.run((tx) => tx.sales.getWithItems(saleId)); if (!got) throw notFound('Venta');
      const d = (await wrap(() => openFacturaClient(c.apiKey, c.env, call).issued(i.fecha))).find((x) => x.tipo === 39 && x.folio === folio);
      if (!d) throw businessRule(`No encontré la boleta N° ${folio} emitida el ${i.fecha.split('-').reverse().join('-')} en Haulmer.`);
      if (d.total !== got.sale.total) throw businessRule(`La boleta N° ${folio} es por ${d.total.toLocaleString('es-CL')} y la venta por ${got.sale.total.toLocaleString('es-CL')}: no corresponden.`);
      if (await folioTaken(folio)) throw businessRule(`La boleta N° ${folio} ya está asociada a otra venta.`);
      return attach(actor, saleId, c, d, 'haulmer');
    },
    /**
     * Venta de la página web: busca en Haulmer la boleta que emitió Jumpseller para ese pedido (mismo total y referencia
     * "Nota de pedido N°<pedido>") y la asocia. Devuelve null si todavía no aparece.
     */
    async linkWebBoleta(actor: Actor | null, saleId: string): Promise<BoletaRecord | null> {
      assertCan(actor, 'dte.issue'); saleId = String(saleId); await canSee(actor, saleId);
      if (await existing(saleId)) return null;
      const c = await config(); if (!c) return null;
      const got = await uow.run((tx) => tx.sales.getWithItems(saleId)); if (!got || got.sale.status !== 'COMPLETED') return null;
      const order = /#\s*(\d+)/.exec(got.sale.externalRef ?? '')?.[1]; if (!order) return null;
      const cl = openFacturaClient(c.apiKey, c.env, call);
      const day = got.sale.businessDate; const next = new Date(Date.parse(day + 'T12:00:00Z') + 86400e3).toISOString().slice(0, 10);
      for (const f of [day, next]) {
        const cands = (await wrap(() => cl.issued(f))).filter((d) => d.tipo === 39 && d.total === got.sale.total);
        for (const d of cands) {
          const refs = referencesFromDetail(await wrap(() => cl.detail(d.token)));
          if (new RegExp(`(N[°º]?|#)\\s*${order}\\b`).test(refs) && !(await folioTaken(d.folio))) return attach(actor, saleId, c, d, 'web');
        }
      }
      return null;
    },
    /** Enlace para compartir (WhatsApp / correo) el PDF del documento emitido de la venta. null si no hay documento o está anulado. */
    async shareRef(actor: Actor | null, saleId: string): Promise<{ ref: string; email: string | null } | null> {
      assertCan(actor, 'dte.issue'); await canSee(actor, String(saleId));
      if (secret().length < 16) return null;
      const rec = await existing(String(saleId)); if (!rec || (await existingNc(String(saleId)))) return null;
      return { ref: `${saleId}.${sig(String(saleId))}`, email: 'receptor' in rec ? rec.receptor.email || null : null };
    },
    /** Público (sin sesión), con el enlace firmado: PDF del documento tal como lo emitió Haulmer. */
    async publicPdf(ref: string): Promise<{ pdf: Buffer; filename: string } | null> {
      const m = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{24})$/.exec(String(ref)); if (!m || secret().length < 16) return null;
      const a = Buffer.from(m[2]); const b = Buffer.from(sig(m[1])); if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const rec = await existing(m[1]); const c = await config(); if (!rec || !c) return null;
      const pdf = await wrap(() => openFacturaClient(c.apiKey, rec.env ?? c.env, call).pdf(rec.token));
      return { pdf, filename: `${docName(rec.tipo).replace(' ', '-')}-${rec.folio}.pdf` };
    },
    async status(actor: Actor | null): Promise<{ configured: boolean; env: OfEnv | null; emisor: { rut: string; razonSocial: string } | null; canConfigure: boolean }> {
      assertCan(actor, 'dte.issue'); const c = await config();
      return { configured: !!c, env: c?.env ?? null, emisor: c ? { rut: c.org.rut, razonSocial: c.org.razonSocial } : null, canConfigure: can(actor.role, 'settings.write') };
    },
    /** Guarda la API Key después de comprobarla (lee los datos del emisor en Haulmer). */
    async connect(actor: Actor | null, i: { apiKey: string; env?: string }): Promise<OfOrg> {
      assertCan(actor, 'settings.write');
      const apiKey = String(i.apiKey ?? '').trim(); const env: OfEnv = i.env === 'dev' ? 'dev' : 'prod';
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(apiKey)) throw validation('API Key inválida.');
      if (secret().length < 16) throw businessRule('El servidor no tiene configurado su secreto; no se pueden guardar credenciales.');
      const org = await wrap(() => openFacturaClient(apiKey, env, call).organization());
      if (!org.rut || !org.razonSocial || !org.giro || !org.direccion || !org.comuna) throw businessRule('Haulmer no devolvió los datos completos del emisor (RUT, razón social, giro, dirección y comuna).');
      await uow.run((tx) => tx.audit.write({ action: 'integration.set', entity: 'openfactura', entityId: 'openfactura', userId: actor.userId, after: { env, keyBox: seal(apiKey, secret(), PURPOSE), org } }));
      return org;
    },
    async forSale(actor: Actor | null, saleId: string): Promise<DteRecord | null> {
      assertCan(actor, 'dte.issue'); await canSee(actor, String(saleId)); return existing(String(saleId));
    },
    async creditNoteFor(actor: Actor | null, saleId: string): Promise<CreditNoteRecord | null> {
      assertCan(actor, 'dte.issue'); await canSee(actor, String(saleId)); return existingNc(String(saleId));
    },
    /**
     * Anula ante el SII la boleta de una venta ANULADA, emitiendo una nota de crédito (61, CodRef 1) por el total.
     * Solo ADMINISTRADOR (quien anula ventas). Una sola vez por venta.
     */
    /** Registra que la boleta ya se anuló A MANO en Haulmer (no emite nada). Folio de la nota de crédito opcional. */
    async markAnnulledManually(actor: Actor | null, saleId: string, ncFolio: number | null): Promise<CreditNoteRecord> {
      assertCan(actor, 'sale.void'); saleId = String(saleId);
      await canSee(actor, saleId);
      const b = await existing(saleId); if (!b) throw businessRule('Esta venta no tiene boleta ni factura electrónica emitida desde el sistema.');
      const prevNc = await existingNc(saleId); if (prevNc) throw businessRule(`La ${docName(b.tipo)} N° ${b.folio} ya figura anulada${prevNc.folio ? ` con la nota de crédito N° ${prevNc.folio}` : ''}.`);
      if (ncFolio !== null && (!Number.isSafeInteger(ncFolio) || ncFolio <= 0)) throw validation('N° de nota de crédito inválido.');
      const got = await uow.run((tx) => tx.sales.getWithItems(saleId)); if (!got) throw notFound('Venta');
      if (got.sale.status !== 'VOIDED') throw businessRule('Primero anula la venta.');
      const fecha = businessDateOf(now(), (await catalog.businessSettings()).timezone);
      const rec: CreditNoteRecord = { tipo: 61, folio: ncFolio ?? 0, token: '', fecha, env: b.env, refFolio: b.folio, refFecha: b.fecha, reason: 'Anulada manualmente en Haulmer', total: b.total, neto: b.neto, iva: b.iva, exento: b.exento,
        lines: b.lines, emisor: b.emisor, resolucion: b.resolucion, timbre: null, warning: null, saleFolio: b.saleFolio, manual: true, refTipo: b.tipo };
      await uow.run((tx) => tx.audit.write({ action: 'dte.void', entity: 'Sale', entityId: saleId, userId: actor.userId, after: rec }));
      return rec;
    },
    async annulBoleta(actor: Actor | null, saleId: string, reason: string): Promise<CreditNoteRecord> {
      assertCan(actor, 'sale.void'); saleId = String(saleId);
      await canSee(actor, saleId);
      const b = await existing(saleId); if (!b) throw businessRule('Esta venta no tiene boleta ni factura electrónica emitida desde el sistema.');
      const prevNc = await existingNc(saleId); if (prevNc) throw businessRule(`La ${docName(b.tipo)} N° ${b.folio} ya fue anulada con la nota de crédito N° ${prevNc.folio}.`);
      const c = await config(); if (!c) throw businessRule('Falta conectar Haulmer (API Key).');
      if (c.env !== b.env) throw businessRule(`La ${docName(b.tipo)} se emitió en otro ambiente de Haulmer (pruebas/producción); anúlala desde el Espacio de Trabajo.`);
      const got = await uow.run((tx) => tx.sales.getWithItems(saleId)); if (!got) throw notFound('Venta');
      if (got.sale.status !== 'VOIDED') throw businessRule('Primero anula la venta; la nota de crédito anula su boleta.');
      const client = openFacturaClient(c.apiKey, c.env, call);
      const org = await wrap(() => client.organization());               // datos frescos del emisor (incluye la actividad económica)
      const fecha = businessDateOf(now(), (await catalog.businessSettings()).timezone);
      const why = (reason ?? '').trim() || `Anula ${docName(b.tipo)}`;
      const lines = b.lines.map((l) => ({ ...l, exempt: !!l.exempt }));
      let dte; try {
        dte = b.tipo === 39
          ? buildCreditNoteForBoleta(org, fecha, { folio: b.folio, fecha: b.fecha, lines, totals: { neto: b.neto, iva: b.iva, exento: b.exento, total: b.total } }, why)
          : buildCreditNoteForFactura(org, fecha, { tipo: b.tipo, folio: b.folio, fecha: b.fecha, receptor: b.receptor, netLines: b.netLines, totals: { neto: b.neto, iva: b.iva, exento: b.exento, total: b.total } }, why);
      } catch (e) { throw businessRule((e as Error).message); }
      const r = await wrap(() => client.emit(dte, `ER-NC-${c.env}-${saleId}`));
      const rec: CreditNoteRecord = { tipo: 61, folio: r.folio, token: r.token, fecha, env: c.env, refFolio: b.folio, refFecha: b.fecha, reason: why, total: b.total, neto: b.neto, iva: b.iva, exento: b.exento,
        lines, emisor: org, resolucion: r.resolucion ?? org.resolucion, timbre: r.timbre, warning: r.warning, saleFolio: b.saleFolio,
        refTipo: b.tipo, ...(b.tipo !== 39 ? { receptor: b.receptor, netLines: b.netLines } : {}) };
      await uow.run((tx) => tx.audit.write({ action: 'dte.void', entity: 'Sale', entityId: saleId, userId: actor.userId, after: rec }));
      return rec;
    },
    /** Emite la boleta de una venta (una sola vez). Las ventas con tarjeta (TUU ya emite boleta) exigen confirmación. */
    async issueBoleta(actor: Actor | null, saleId: string, opts: { allowCard?: boolean } = {}): Promise<BoletaRecord> {
      assertCan(actor, 'dte.issue'); saleId = String(saleId);
      await canSee(actor, saleId);
      const prev = await existing(saleId); if (prev) throw businessRule(`Esta venta ya tiene la ${docName(prev.tipo)} N° ${prev.folio}.`);
      const c = await config(); if (!c) throw businessRule('Falta conectar Haulmer (API Key) para emitir boletas.');
      const got = await uow.run((tx) => tx.sales.getWithItems(saleId)); if (!got) throw notFound('Venta');
      if (got.sale.status !== 'COMPLETED') throw businessRule('No se puede emitir boleta de una venta anulada.');
      const methods = new Map((await catalog.listPaymentMethods()).map((m) => [m.id, m.code]));
      const codes = [...got.payments].sort((a, b) => b.amount - a.amount).map((p) => methods.get(p.methodId) ?? '');
      if (codes.some((x) => CARD.includes(x)) && !opts.allowCard && !(await autoOn())) throw businessRule('Esta venta se pagó con tarjeta en la máquina TUU, que ya emite su boleta. Confirma solo si TUU no la emitió.');
      const fecha = businessDateOf(now(), (await catalog.businessSettings()).timezone);
      const lines = got.items.map((it) => ({ name: it.nameSnapshot, qty: milliToNumber(it.enteredQuantity), lineTotal: it.lineTotal, exempt: it.vatTreatment === 'EXENTO' }));
      let built; try { built = buildBoleta(c.org, fecha, lines, medioPagoFor(codes)); } catch (e) { throw businessRule((e as Error).message); }
      const r = await wrap(() => openFacturaClient(c.apiKey, c.env, call).emit(built.dte, `ER-${c.env}-${saleId}`));
      const rec: BoletaRecord = { tipo: 39, folio: r.folio, token: r.token, fecha, env: c.env, ...built.totals, medioPago: medioPagoFor(codes) ?? null,
        lines: lines.filter((l) => l.lineTotal > 0 && l.qty > 0).map(({ name, qty, lineTotal, exempt }) => ({ name, qty, lineTotal, exempt })), emisor: c.org,
        resolucion: r.resolucion ?? c.org.resolucion, timbre: r.timbre, warning: r.warning, saleFolio: got.sale.folio };
      await uow.run((tx) => tx.audit.write({ action: 'dte.issue', entity: 'Sale', entityId: saleId, userId: actor.userId, after: rec }));
      return rec;
    },

    /** Datos de un cliente por RUT: primero los guardados en el sistema; si no, la ficha del SII vía Haulmer. */
    async customer(actor: Actor | null, rawRut: string): Promise<{ receptor: Receptor; source: 'saved' | 'sii' } | null> {
      assertCan(actor, 'dte.issue');
      const rut = normalizeRut(String(rawRut ?? ''));
      const saved = (await integrations.latestEntry('customer.save', 'Customer', rut)) as Receptor | null;
      if (saved?.razonSocial) return { receptor: { ...saved, rut }, source: 'saved' };
      const c = await config(); if (!c) throw businessRule('Falta conectar Haulmer (API Key).');
      const t = await wrap(() => openFacturaClient(c.apiKey, c.env, call).taxpayer(rut));
      return t ? { receptor: { ...t, rut }, source: 'sii' } : null;
    },

    /** Emite la FACTURA de una venta (en vez de boleta; una sola vez). fmaPago 1 contado, 2 crédito. */
    async issueFactura(actor: Actor | null, saleId: string, i: { receptor: Receptor; fmaPago: number; allowCard?: boolean }): Promise<FacturaRecord> {
      assertCan(actor, 'dte.issue'); saleId = String(saleId);
      await canSee(actor, saleId);
      const prev = await existing(saleId); if (prev) throw businessRule(`Esta venta ya tiene la ${docName(prev.tipo)} N° ${prev.folio}.`);
      const t = (v: unknown, min: number, max: number, label: string) => { const x = String(v ?? '').trim().replace(/\s+/g, ' '); if (x.length < min) throw validation(`Falta ${label} del cliente.`); return x.slice(0, max); };
      const receptor: Receptor = { rut: normalizeRut(String(i.receptor?.rut ?? '')), razonSocial: t(i.receptor?.razonSocial, 2, 100, 'la razón social'), giro: t(i.receptor?.giro, 2, 80, 'el giro'),
        direccion: t(i.receptor?.direccion, 3, 70, 'la dirección'), comuna: t(i.receptor?.comuna, 2, 40, 'la comuna'), email: String(i.receptor?.email ?? '').trim().slice(0, 80) || null };
      if (receptor.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receptor.email)) throw validation('Correo del cliente inválido.');
      const fmaPago: 1 | 2 = Number(i.fmaPago) === 2 ? 2 : 1;
      const c = await config(); if (!c) throw businessRule('Falta conectar Haulmer (API Key) para emitir facturas.');
      const got = await uow.run((tx) => tx.sales.getWithItems(saleId)); if (!got) throw notFound('Venta');
      if (got.sale.status !== 'COMPLETED') throw businessRule('No se puede emitir factura de una venta anulada.');
      const methods = new Map((await catalog.listPaymentMethods()).map((m) => [m.id, m.code]));
      if (got.payments.some((p) => CARD.includes(methods.get(p.methodId) ?? '')) && !i.allowCard) throw businessRule('Esta venta se pagó con tarjeta en la máquina TUU, que ya emitió una boleta. Confirma solo si vas a anular esa boleta en Haulmer.');
      const client = openFacturaClient(c.apiKey, c.env, call);
      const org = await wrap(() => client.organization());
      const fecha = businessDateOf(now(), (await catalog.businessSettings()).timezone);
      const lines = got.items.map((it) => ({ name: it.nameSnapshot, qty: milliToNumber(it.enteredQuantity), lineTotal: it.lineTotal, exempt: it.vatTreatment === 'EXENTO' }));
      let built; try { built = buildFactura(org, fecha, receptor, lines, fmaPago); } catch (e) { throw businessRule((e as Error).message); }
      const r = await wrap(() => client.emit(built.dte, `ER-F-${c.env}-${saleId}`));
      const rec: FacturaRecord = { tipo: built.tipo, folio: r.folio, token: r.token, fecha, env: c.env, ...built.totals, fmaPago, receptor, netLines: built.lines,
        lines: lines.filter((l) => l.lineTotal > 0 && l.qty > 0), emisor: org, resolucion: r.resolucion ?? org.resolucion, timbre: r.timbre, warning: r.warning, saleFolio: got.sale.folio };
      await uow.run(async (tx) => {
        await tx.audit.write({ action: 'dte.issue', entity: 'Sale', entityId: saleId, userId: actor.userId, after: rec as unknown as Record<string, unknown> });
        await tx.audit.write({ action: 'customer.save', entity: 'Customer', entityId: receptor.rut, userId: actor.userId, after: receptor as unknown as Record<string, unknown> });
      });
      return rec;
    },
  };
}
