import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { assertCan, can, type Actor } from '../core/permissions/permissions.ts';
import { validation, businessRule, AppError } from '../core/errors/index.ts';
import { seal, open } from '../core/crypto/secret-box.ts';
import { jumpsellerClient, JumpsellerError, type HttpGet } from '../integrations/jumpseller.ts';
import { parseWebOrder, paymentFor, priceLines, shippingSkuFor, orderBusinessDate, type WebOrder } from '../domain/web-orders/web-orders.ts';
import { jumpsellerCreds, defaultGet } from './shipping.service.ts';
import type { UnitOfWork, IntegrationStore, CatalogReader } from '../repositories/ports.ts';
import type { createSalesService } from './sales.service.ts';
import type { createProductsService } from './products.service.ts';

/** Registro de cada pedido web en la bitácora (action 'web.order', entidad 'JumpsellerOrder'); el más reciente manda. */
export type WebOrderState = 'DONE' | 'PENDING' | 'IGNORED' | 'SKIPPED';
export interface WebOrderEntry {
  state: WebOrderState; reason: string | null; order: WebOrder; payment: string | null;
  lines: { name: string; sku: string; qty: number; productId: string | null; productName: string | null }[];
  saleId?: string; folio?: number; auto?: boolean;
}
export interface WebSyncConfig { enabled: boolean; since: string; ownerId: string; keyBox: string; hookId: number | null; hookError: string | null }
export type HttpPost = (url: string, headers: Record<string, string>, body: string) => Promise<{ status: number; text: () => Promise<string> }>;
const defaultPost: HttpPost = async (url, headers, body) => { const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(12_000) }); return { status: r.status, text: () => r.text() }; };

const CFG = 'jumpseller-ventas'; const PURPOSE = 'webhook:jumpseller-ventas';
const ACTION = 'web.order'; const ENTITY = 'JumpsellerOrder';
const hash = (k: string) => createHash('sha256').update(k).digest();

export interface Deps {
  uow: UnitOfWork; integrations: IntegrationStore; catalog: CatalogReader; now?: () => Date;
  sales: ReturnType<typeof createSalesService>; products: ReturnType<typeof createProductsService>;
  /** Actor del dueño de la integración (para registrar ventas desde el aviso de Jumpseller, sin sesión). */
  actorFor: (userId: string) => Promise<Actor | null>;
  get?: HttpGet; post?: HttpPost; secret?: () => string;
}

/**
 * Ventas de la tienda web: cada pedido PAGADO en Jumpseller se registra solo como venta (canal Página Web, N° de pedido,
 * productos por SKU, envío y medio de pago). Si algo no calza, queda "Por revisar" para que el administrador lo corrija.
 */
export function createWebOrdersService(d: Deps) {
  const { uow, integrations, catalog, sales, products, actorFor } = d;
  const get = d.get ?? defaultGet; const post = d.post ?? defaultPost;
  const secret = d.secret ?? (() => process.env.BETTER_AUTH_SECRET ?? '');
  let lastSync = 0;

  async function config(): Promise<WebSyncConfig | null> {
    const a = await integrations.latest(CFG); if (!a || typeof a.since !== 'string' || typeof a.ownerId !== 'string') return null;
    return { enabled: a.enabled === true, since: a.since, ownerId: a.ownerId, keyBox: typeof a.keyBox === 'string' ? a.keyBox : '', hookId: typeof a.hookId === 'number' ? a.hookId : null, hookError: typeof a.hookError === 'string' ? a.hookError : null };
  }
  async function client() { const c = await jumpsellerCreds(integrations, secret()); if (!c) throw businessRule('Falta conectar Jumpseller (login y token de la API).'); return { c, api: jumpsellerClient(c, get) }; }
  const wrapJs = async <T>(f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) {
      if (e instanceof JumpsellerError) throw businessRule(e.message);
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw businessRule('Jumpseller no respondió a tiempo. Intenta de nuevo.');
      throw e;
    }
  };
  async function save(actorId: string, orderId: number, entry: WebOrderEntry) {
    await uow.run((tx) => tx.audit.write({ action: ACTION, entity: ENTITY, entityId: String(orderId), userId: actorId, after: entry as unknown as Record<string, unknown> }));
  }
  const current = async (orderId: number) => (await integrations.latestEntry(ACTION, ENTITY, String(orderId))) as unknown as WebOrderEntry | null;

  async function findProduct(actor: Actor, sku: string, name: string): Promise<{ id: string; name: string; price: number } | null> {
    if (sku) {
      const r = await products.listAdmin(actor, { q: sku, status: 'active', pageSize: 20 });
      const m = r.rows.find((p) => p.sku.toLowerCase() === sku.toLowerCase()) ?? r.rows.find((p) => p.barcodes.includes(sku));
      if (m) return { id: m.id, name: m.name, price: m.salePrice };
    }
    if (name) {
      const r = await products.listAdmin(actor, { q: name, status: 'active', pageSize: 20 });
      const m = r.rows.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (m) return { id: m.id, name: m.name, price: m.salePrice };
    }
    return null;
  }

  /** Intenta registrar la venta del pedido. overrides: productos elegidos a mano por línea y medio de pago. */
  async function processOrder(actor: Actor, order: WebOrder, overrides?: { productIds?: (string | null)[]; payment?: string | null; allowDuplicate?: boolean }): Promise<WebOrderEntry> {
    const pay = overrides?.payment ?? paymentFor(order.payment);
    const base = { order, payment: pay, lines: order.lines.map((l) => ({ name: l.name, sku: l.sku, qty: l.qty, productId: null as string | null, productName: null as string | null })) };
    if (pay === 'ML') return { ...base, state: 'SKIPPED', reason: 'Pedido de Mercado Libre: se registra como venta de Mercado Libre.' };
    const pending = (reason: string): WebOrderEntry => ({ ...base, state: 'PENDING', reason });

    const opts = await sales.posOptions(actor);
    const channel = opts.channels.find((c) => c.code === 'PAGINA_WEB'); if (!channel) return pending('No existe el canal "Página Web" en el sistema.');
    const date = orderBusinessDate(order.date) ?? opts.today;

    // ¿Ya está registrada? (por N° de pedido; o una venta web del mismo monto esos días sin N° de pedido = posible duplicado)
    const near = await sales.listAdmin(actor, { from: shiftDate(date, -3), to: date > opts.today ? date : opts.today, channelId: channel.id, status: 'COMPLETED' });
    const same = near.rows.find((r) => (r.externalRef ?? '').replace(/\s*\(anulada.*$/, '') === `#${order.id}`);
    if (same) return { ...base, state: 'DONE', reason: 'Ya estaba registrada.', saleId: same.id, folio: same.folio };
    const maybe = near.rows.find((r) => !r.externalRef && r.total === order.total);
    if (maybe && !overrides?.allowDuplicate) return pending(`Posible duplicado: la venta N° ${maybe.folio} (${maybe.businessDate}) es de la página web por el mismo monto y no tiene N° de pedido.`);

    for (let i = 0; i < order.lines.length; i++) {
      const forced = overrides?.productIds?.[i];
      if (forced) { const r = await products.getAdmin(actor, forced).catch(() => null); if (r) { base.lines[i].productId = r.id; base.lines[i].productName = r.name; } continue; }
      const m = await findProduct(actor, order.lines[i].sku, order.lines[i].name);
      if (m) { base.lines[i].productId = m.id; base.lines[i].productName = m.name; }
    }
    const missing = base.lines.filter((l) => !l.productId);
    if (missing.length) return pending(`No encontré en el sistema: ${missing.map((l) => `${l.name}${l.sku ? ` (SKU ${l.sku})` : ' (sin SKU)'}`).join(', ')}.`);
    if (!pay) return pending(`Medio de pago "${order.payment || 'sin dato'}" desconocido: elige con qué se pagó.`);
    const method = opts.methods.find((m) => m.code === pay); if (!method) return pending(`No existe el medio de pago ${pay} en el sistema.`);
    const priced = priceLines(order); if (!priced) return pending('Los montos del pedido no cuadran con su total (descuento o cupón): revísalo.');

    const lines: { productId: string; quantity: string; manualUnitPrice?: number }[] = [];
    const catalogPrices = await catalog.loadProducts(base.lines.map((l) => l.productId!));
    for (const p of priced) {
      const pid = base.lines[p.index].productId!; const cp = catalogPrices.get(pid);
      lines.push({ productId: pid, quantity: String(p.qty), ...(cp && cp.salePrice === p.unitPrice ? {} : { manualUnitPrice: p.unitPrice }) });
    }
    if (order.shipping > 0) {
      const ship = await findProduct(actor, shippingSkuFor(order.shippingMethod), '');
      if (!ship) return pending(`Falta el producto de envío (SKU ${shippingSkuFor(order.shippingMethod)}) en el sistema.`);
      lines.push({ productId: ship.id, quantity: '1', manualUnitPrice: order.shipping });
    }
    try {
      const sale = await sales.closeSale(actor, {
        lines, channelId: channel.id, payments: [{ methodId: method.id, amount: order.total }], idempotencyKey: `web-${order.id}`,
        externalRef: `#${order.id}`, note: `Pedido web #${order.id}${order.customer ? ` · ${order.customer}` : ''}`, saleDate: date < opts.today ? date : null,
      });
      return { ...base, state: 'DONE', reason: null, saleId: sale.id, folio: sale.folio };
    } catch (e) {
      if (e instanceof AppError) return pending(e.message);
      throw e;
    }
  }

  async function handle(actor: Actor, raw: unknown, cfg: WebSyncConfig, auto: boolean, overrides?: Parameters<typeof processOrder>[2]): Promise<WebOrderEntry | null> {
    const order = parseWebOrder(raw);
    if (!order.id || order.status !== 'Paid') return null;
    const date = orderBusinessDate(order.date); if (!date || date < cfg.since) return null;
    const prev = await current(order.id);
    if (prev && !overrides && prev.state !== 'PENDING') return prev;            // ya resuelto
    if (prev && !overrides && prev.state === 'PENDING' && auto) return prev;     // pendiente: espera tu revisión
    const entry = { ...(await processOrder(actor, order, overrides)), auto };
    await save(actor.userId, order.id, entry);
    return entry;
  }
  async function owner(cfg: WebSyncConfig): Promise<Actor | null> { const a = await actorFor(cfg.ownerId); return a && can(a.role, 'sale.backdate') ? a : null; }

  return {
    async status(actor: Actor | null) {
      assertCan(actor, 'sale.read.any');
      const cfg = await config(); const js = !!(await jumpsellerCreds(integrations, secret()));
      const list = (await integrations.latestEntries(ACTION, ENTITY, 60)).map((e) => ({ orderId: Number(e.entityId), at: e.at, ...(e.after as unknown as WebOrderEntry) }));
      return { jumpseller: js, enabled: !!cfg?.enabled, since: cfg?.since ?? null, hookOk: !!cfg?.hookId, hookError: cfg?.hookError ?? null,
        pending: list.filter((e) => e.state === 'PENDING'), recent: list.filter((e) => e.state !== 'PENDING').slice(0, 25), canConfigure: can(actor.role, 'settings.write') };
    },

    /** Activa el registro automático desde `since` (incluido). Crea el aviso (webhook) en Jumpseller si se puede. */
    async enable(actor: Actor | null, i: { since: string; baseUrl: string }) {
      assertCan(actor, 'settings.write');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(i.since)) throw validation('Fecha de inicio inválida.');
      if (!/^https:\/\/[^\s/]+$/.test(i.baseUrl)) throw validation('Dirección del sistema inválida.');
      const { c, api } = await client();
      const prev = await config(); const key = (prev?.keyBox && open(prev.keyBox, secret(), PURPOSE)) || randomBytes(24).toString('base64url');
      const url = `${i.baseUrl}/api/jumpseller/pedido-pagado?k=${key}`;
      let hookId: number | null = null; let hookError: string | null = null;
      try {
        const existing = (await wrapJs(() => api.hooks())).find((h) => h.event === 'order_paid' && h.url.startsWith(`${i.baseUrl}/api/jumpseller/`));
        if (existing && existing.url === url) hookId = existing.id;
        else {
          const r = await post(`https://api.jumpseller.com/v1/hooks.json?login=${encodeURIComponent(c.login)}&authtoken=${encodeURIComponent(c.token)}`,
            { 'Content-Type': 'application/json', Accept: 'application/json' }, JSON.stringify({ hook: { event: 'order_paid', url } }));
          const t = await r.text(); let j: Record<string, unknown> = {}; try { j = JSON.parse(t) as Record<string, unknown>; } catch { /* no JSON */ }
          const h = (j.hook ?? j) as Record<string, unknown>;
          if (r.status < 300 && typeof h.id === 'number') hookId = h.id; else hookError = `Jumpseller no aceptó crear el aviso automático (HTTP ${r.status}).`;
        }
      } catch (e) { hookError = e instanceof Error ? e.message : 'No se pudo crear el aviso automático.'; }
      await uow.run((tx) => tx.audit.write({ action: 'integration.set', entity: CFG, entityId: CFG, userId: actor.userId,
        after: { enabled: true, since: i.since, ownerId: actor.userId, keyBox: seal(key, secret(), PURPOSE), hookId, hookError } }));
      lastSync = 0;
      return { hookOk: !!hookId, hookError, url };
    },
    async disable(actor: Actor | null) {
      assertCan(actor, 'settings.write'); const cfg = await config(); if (!cfg) return;
      await uow.run((tx) => tx.audit.write({ action: 'integration.set', entity: CFG, entityId: CFG, userId: actor.userId, after: { ...cfg, enabled: false } }));
    },

    /** Revisa los últimos pedidos y registra los pagados que falten. `force` ignora la pausa entre revisiones. */
    async sync(force = false): Promise<{ done: number; pending: number } | null> {
      if (!force && Date.now() - lastSync < 90_000) return null;
      lastSync = Date.now();
      const cfg = await config(); if (!cfg?.enabled) return null;
      const actor = await owner(cfg); if (!actor) return null;
      const { api } = await client();
      const raws = await wrapJs(() => api.recentRaw(50));
      let done = 0; let pend = 0;
      for (const raw of raws.reverse()) {                     // del más antiguo al más nuevo: folios en orden
        const before = await current(parseWebOrder(raw).id);
        const e = await handle(actor, raw, cfg, true);
        if (e && !before) { if (e.state === 'DONE') done++; if (e.state === 'PENDING') pend++; }
      }
      return { done, pending: pend };
    },

    /** Aviso de Jumpseller (webhook). Solo se usa el N° de pedido: el pedido se vuelve a leer desde la API. */
    async webhook(key: string, orderId: number): Promise<WebOrderEntry | null> {
      const cfg = await config(); if (!cfg?.enabled || !cfg.keyBox) return null;
      const k = open(cfg.keyBox, secret(), PURPOSE); if (!k || !timingSafeEqual(hash(k), hash(String(key ?? '')))) return null;
      if (!Number.isSafeInteger(orderId) || orderId <= 0) return null;
      const actor = await owner(cfg); if (!actor) return null;
      const { api } = await client();
      return handle(actor, await wrapJs(() => api.orderRaw(orderId)), cfg, true);
    },

    /** Revisión manual de un pedido pendiente: productos por línea y medio de pago elegidos por el administrador. */
    async resolve(actor: Actor | null, orderId: number, i: { productIds: (string | null)[]; payment: string | null; allowDuplicate?: boolean }): Promise<WebOrderEntry> {
      assertCan(actor, 'sale.backdate');
      const cfg = await config(); if (!cfg) throw businessRule('Primero activa el registro automático de ventas web.');
      const prev = await current(orderId); if (prev?.state === 'DONE') throw businessRule(`Ese pedido ya está registrado (venta N° ${prev.folio}).`);
      const { api } = await client();
      const e = await handle(actor, await wrapJs(() => api.orderRaw(orderId)), { ...cfg, since: '2000-01-01' }, false, { productIds: i.productIds, payment: i.payment, allowDuplicate: i.allowDuplicate });
      if (!e) throw businessRule('Ese pedido no está pagado en Jumpseller.');
      return e;
    },
    async ignore(actor: Actor | null, orderId: number, reason: string) {
      assertCan(actor, 'sale.backdate');
      const prev = await current(orderId); if (!prev) throw businessRule('No conozco ese pedido.');
      if (prev.state === 'DONE') throw businessRule('Ese pedido ya tiene venta; si fue un error, anula la venta.');
      const why = String(reason ?? '').trim(); if (why.length < 3) throw validation('Escribe el motivo.');
      await save(actor.userId, orderId, { ...prev, state: 'IGNORED', reason: why });
    },
  };
}

function shiftDate(date: string, days: number): string { const t = new Date(date + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); }
