import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { assertCan, can, type Actor } from '../core/permissions/permissions.ts';
import { validation, notFound, businessRule, forbidden } from '../core/errors/index.ts';
import { businessDateOf } from '../core/time/business-date.ts';
import type { UnitOfWork, CatalogReader, IntegrationStore } from '../repositories/ports.ts';
import {
  QUOTE_PAY, QUOTE_VALIDITY, addDays, lineTotalOf, normalizeRut, quoteTotals, shownStatus,
  type QuoteDoc, type QuoteLine, type QuotePay, type QuoteProvider, type QuoteShownStatus,
} from '../domain/quotes/quote.ts';

export interface Deps { uow: UnitOfWork; catalog: CatalogReader; integrations: IntegrationStore; now?: () => Date; secret?: () => string }
export interface QuoteInput {
  customer: { name: string; rut?: string | null; phone?: string | null; email?: string | null };
  lines: { productId?: string | null; name?: string | null; qty: string | number; unitPrice?: number | null }[];
  validDays: number; discount?: number | null; payMethods: string[]; docType?: string | null; notes?: string | null;
}
export interface QuoteRow { id: string; number: number; date: string; validUntil: string; customer: string; total: number; status: QuoteShownStatus; createdBy: string }

const ENTITY = 'Quote'; const ACTION = 'quote.save';
const txt = (v: unknown, max: number) => { const s = String(v ?? '').trim().replace(/\s+/g, ' '); return s ? s.slice(0, max) : null; };
const EMPTY_PROVIDER: QuoteProvider = { legalName: '', tradeName: '', rut: '', address: '', phone: '', email: '', bank: { holder: '', rut: '', bank: '', accountType: '', accountNumber: '', email: '' }, footer: '' };

export function createQuotesService({ uow, catalog, integrations, now = () => new Date(), secret = () => process.env.BETTER_AUTH_SECRET ?? '' }: Deps) {
  const today = async () => businessDateOf(now(), (await catalog.businessSettings()).timezone);
  const sig = (id: string) => createHmac('sha256', secret()).update(`share-quote:${id}`).digest('base64url').slice(0, 24);
  async function provider(): Promise<QuoteProvider> {
    const a = (await integrations.latest('quote-settings')) as Partial<QuoteProvider> | null;
    return { ...EMPTY_PROVIDER, ...(a ?? {}), bank: { ...EMPTY_PROVIDER.bank, ...((a?.bank as object) ?? {}) } };
  }
  async function load(id: string): Promise<QuoteDoc | null> {
    if (!/^[A-Za-z0-9]{8,40}$/.test(id)) return null;
    return (await integrations.latestEntry(ACTION, ENTITY, id)) as unknown as QuoteDoc | null;
  }
  async function save(actor: Actor, q: QuoteDoc, metadata: Record<string, unknown>) {
    await uow.run((tx) => tx.audit.write({ action: ACTION, entity: ENTITY, entityId: q.id, userId: actor.userId, after: q as unknown as Record<string, unknown>, metadata }));
  }

  return {
    /** Datos del proveedor (empresa y cuenta para transferencias) que salen en cada cotización. */
    async settings(actor: Actor | null): Promise<QuoteProvider> { assertCan(actor, 'sale.create'); return provider(); },
    async saveSettings(actor: Actor | null, p: QuoteProvider): Promise<void> {
      assertCan(actor, 'settings.write');
      const s = (v: unknown) => txt(v, 160) ?? '';
      const clean: QuoteProvider = { legalName: s(p.legalName), tradeName: s(p.tradeName), rut: s(p.rut), address: s(p.address), phone: s(p.phone), email: s(p.email), footer: txt(p.footer, 600) ?? '',
        bank: { holder: s(p.bank?.holder), rut: s(p.bank?.rut), bank: s(p.bank?.bank), accountType: s(p.bank?.accountType), accountNumber: s(p.bank?.accountNumber), email: s(p.bank?.email) } };
      if (!clean.legalName || !clean.rut) throw validation('Falta la razón social o el RUT de la empresa.');
      await uow.run((tx) => tx.audit.write({ action: 'integration.set', entity: 'quote-settings', entityId: 'quote-settings', userId: actor.userId, after: clean as unknown as Record<string, unknown> }));
    },

    async list(actor: Actor | null): Promise<QuoteRow[]> {
      assertCan(actor, 'sale.create');
      const [rows, d] = await Promise.all([integrations.latestEntries(ACTION, ENTITY, 1000), today()]);
      return rows.map((r) => r.after as unknown as QuoteDoc).filter((q) => q && q.id)
        .map((q) => ({ id: q.id, number: q.number, date: q.date, validUntil: q.validUntil, customer: q.customer.name, total: q.total, status: shownStatus(q, d), createdBy: q.createdBy }))
        .sort((a, b) => b.number - a.number);
    },

    async get(actor: Actor | null, id: string): Promise<{ quote: QuoteDoc; status: QuoteShownStatus; today: string }> {
      assertCan(actor, 'sale.create');
      const q = await load(String(id)); if (!q) throw notFound('Cotización'); const d = await today();
      return { quote: q, status: shownStatus(q, d), today: d };
    },

    /** Crea una cotización. Precios: los de la tienda; solo el ADMINISTRADOR puede cambiar un precio de producto o dar descuento. */
    async create(actor: Actor | null, i: QuoteInput): Promise<{ id: string; number: number }> {
      assertCan(actor, 'sale.create');
      const isAdmin = actor.role === 'ADMINISTRADOR';
      const name = txt(i.customer?.name, 120); if (!name || name.length < 2) throw validation('Indica el nombre del cliente o beneficiario.');
      let rut: string | null = null; const rawRut = txt(i.customer?.rut, 20);
      if (rawRut) { rut = normalizeRut(rawRut); if (!rut) throw validation('El RUT del cliente no es válido.'); }
      const email = txt(i.customer?.email, 120); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validation('El correo del cliente no es válido.');
      if (!(QUOTE_VALIDITY as readonly number[]).includes(Number(i.validDays))) throw validation('Elige una vigencia de 7, 15 o 30 días.');
      const pays = [...new Set((i.payMethods ?? []).map(String))].filter((p): p is QuotePay => (QUOTE_PAY as readonly string[]).includes(p));
      if (pays.length === 0) throw validation('Marca al menos un medio de pago.');
      const docType = i.docType === 'BOLETA' || i.docType === 'FACTURA' ? i.docType : null;
      if (!Array.isArray(i.lines) || i.lines.length === 0) throw validation('Agrega al menos un producto.');
      if (i.lines.length > 200) throw validation('Demasiadas líneas.');
      const products = await catalog.loadProducts(i.lines.map((l) => l.productId).filter((x): x is string => !!x));
      const lines: QuoteLine[] = i.lines.map((l) => {
        const qty = Number(String(l.qty).replace(',', '.'));
        if (!Number.isFinite(qty) || qty <= 0 || qty > 100000 || Math.round(qty * 1000) !== qty * 1000) throw validation('Cantidad inválida.');
        if (l.productId) {
          const p = products.get(l.productId); if (!p) throw validation('Producto inexistente.');
          if (!p.isActive) throw businessRule(`"${p.name}" está archivado.`);
          let price = p.salePrice;
          if (l.unitPrice != null && Number(l.unitPrice) !== p.salePrice) {
            if (!isAdmin) throw forbidden('Solo la administradora puede cambiar precios.');
            price = Number(l.unitPrice); if (!Number.isSafeInteger(price) || price <= 0) throw validation(`Precio inválido para "${p.name}".`);
          }
          return { productId: p.id, sku: p.sku, name: p.name, qty, unitPrice: price, total: lineTotalOf(qty, price) };
        }
        const n = txt(l.name, 160); if (!n) throw validation('Escribe la descripción de la línea (p. ej. "Despacho a domicilio").');
        const price = Number(l.unitPrice); if (!Number.isSafeInteger(price) || price < 0) throw validation(`Precio inválido para "${n}".`);
        return { productId: null, sku: null, name: n, qty, unitPrice: price, total: lineTotalOf(qty, price) };
      });
      const discount = Math.trunc(Number(i.discount ?? 0)) || 0;
      if (discount !== 0 && !isAdmin) throw forbidden('Solo la administradora puede dar descuentos.');
      const subtotal = lines.reduce((s, l) => s + l.total, 0);
      if (discount < 0 || discount >= subtotal) throw validation('Descuento inválido.');
      const settings = await catalog.businessSettings(); const date = await today();
      const existing = await integrations.latestEntries(ACTION, ENTITY, 100000);
      const number = existing.reduce((m, r) => Math.max(m, Number((r.after as { number?: number }).number) || 0), 0) + 1;
      const id = randomUUID().replace(/-/g, '').slice(0, 20); const validDays = Number(i.validDays);
      const q: QuoteDoc = {
        id, number, date, validDays, validUntil: addDays(date, validDays),
        customer: { name, rut, phone: txt(i.customer?.phone, 30), email },
        lines, ...quoteTotals(lines, discount, settings.vatRate), payMethods: pays, docType, notes: txt(i.notes, 600),
        provider: await provider(), status: 'PENDING', statusNote: null, saleId: null,
        createdBy: actor.email.split('@')[0], createdAt: now().toISOString(),
      };
      await save(actor, q, { created: true, number });
      return { id, number };
    },

    /** Aceptada / Anulada / vuelve a Pendiente. Anular una aceptada solo la administradora. */
    async setStatus(actor: Actor | null, id: string, status: 'PENDING' | 'ACCEPTED' | 'VOID', note?: string | null): Promise<void> {
      assertCan(actor, 'sale.create');
      const q = await load(String(id)); if (!q) throw notFound('Cotización');
      if (!['PENDING', 'ACCEPTED', 'VOID'].includes(status)) throw validation('Estado inválido.');
      if (q.status === 'VOID' && !can(actor.role, 'settings.write')) throw forbidden('Solo la administradora puede reactivar una cotización anulada.');
      await save(actor, { ...q, status, statusNote: txt(note, 200) }, { status, from: q.status });
    },
    /** Cambia la vigencia (7, 15 o 30 días desde la fecha de la cotización). */
    async setValidity(actor: Actor | null, id: string, days: number): Promise<void> {
      assertCan(actor, 'sale.create');
      const q = await load(String(id)); if (!q) throw notFound('Cotización');
      if (!(QUOTE_VALIDITY as readonly number[]).includes(Number(days))) throw validation('Elige una vigencia de 7, 15 o 30 días.');
      if (q.status === 'VOID') throw businessRule('La cotización está anulada.');
      await save(actor, { ...q, validDays: Number(days), validUntil: addDays(q.date, Number(days)) }, { validDays: Number(days), from: q.validDays });
    },
    /** Al cobrar en la caja una cotización: queda Aceptada y enlazada a la venta. */
    async linkSale(actor: Actor | null, id: string, saleId: string): Promise<void> {
      assertCan(actor, 'sale.create');
      const q = await load(String(id)); if (!q || q.status === 'VOID') return;
      await save(actor, { ...q, status: 'ACCEPTED', saleId: String(saleId) }, { status: 'ACCEPTED', saleId });
    },

    /** Enlace público firmado para enviar la cotización por WhatsApp o correo. */
    async shareRef(actor: Actor | null, id: string): Promise<string | null> {
      assertCan(actor, 'sale.create'); if (secret().length < 16) return null;
      const q = await load(String(id)); if (!q) throw notFound('Cotización');
      return `${q.id}.${sig(q.id)}`;
    },
    async publicGet(ref: string): Promise<{ quote: QuoteDoc; status: QuoteShownStatus } | null> {
      const m = /^([A-Za-z0-9]{8,40})\.([A-Za-z0-9_-]{24})$/.exec(String(ref)); if (!m || secret().length < 16) return null;
      const a = Buffer.from(m[2]); const b = Buffer.from(sig(m[1])); if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const q = await load(m[1]); if (!q) return null;
      return { quote: q, status: shownStatus(q, await today()) };
    },
  };
}
