// Cliente mínimo de la API de Jumpseller (solo lectura de pedidos) y conversión a una etiqueta de despacho.
// API: https://api.jumpseller.com/v1 · autenticación con login + authtoken (Panel de Jumpseller → Configuración → API / Cuenta).
export interface JsCredentials { login: string; token: string }
export type HttpGet = (url: string, headers: Record<string, string>) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface ShippingLabel {
  id: number; createdAt: string | null; status: string; shippingMethod: string; paymentMethod: string;
  name: string; phone: string; email: string;
  address: string; complement: string; municipality: string; city: string; region: string;
  notes: string; products: { name: string; sku: string; qty: number }[]; total: number | null;
}
export interface OrderRow { id: number; createdAt: string | null; status: string; name: string; municipality: string; shippingMethod: string; total: number | null }

const BASE = 'https://api.jumpseller.com/v1';
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown) => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const unwrap = (v: unknown) => { const o = obj(v); return obj('order' in o ? o.order : o); };

/** Convierte el JSON de un pedido de Jumpseller en los datos de la etiqueta (tolerante a campos faltantes). */
export function toLabel(raw: unknown): ShippingLabel {
  const o = unwrap(raw); const sa = obj(o.shipping_address); const ba = obj(o.billing_address); const cu = obj(o.customer);
  const name = [str(sa.name), str(sa.surname)].filter(Boolean).join(' ') || str(cu.fullname) || [str(ba.name), str(ba.surname)].filter(Boolean).join(' ') || str(cu.name);
  const fields = Array.isArray(o.additional_fields) ? o.additional_fields.map(obj) : [];
  const fieldPhone = str(fields.find((f) => /tel[eé]fono|phone|celular|whats|fono/i.test(str(f.label)) && str(f.value))?.value);
  const prefix = str(cu.phone_prefix); const cuPhone = str(cu.phone) ? [prefix && !str(cu.phone).startsWith('+') ? `+${prefix.replace(/^\+/, '')}` : '', str(cu.phone)].filter(Boolean).join(' ') : '';
  const phone = str(sa.phone) || cuPhone || str(ba.phone) || fieldPhone;
  const products = (Array.isArray(o.products) ? o.products : []).map((p) => { const x = obj(p); return { name: str(x.name), sku: str(x.sku), qty: num(x.qty) ?? num(x.quantity) ?? 1 }; }).filter((p) => p.name);
  const additional = Array.isArray(o.additional_information) ? o.additional_information.map((a) => { const x = obj(a); return [str(x.label), str(x.value)].filter(Boolean).join(': '); }).filter(Boolean).join(' · ') : str(o.additional_information);
  return {
    id: num(o.id) ?? 0, createdAt: str(o.created_at) || null, status: str(o.status), shippingMethod: str(o.shipping_method_name) || str(o.shipping_option), paymentMethod: str(o.payment_method_name),
    name, phone, email: str(cu.email),
    address: str(sa.address) || [str(sa.street_name), str(sa.street_number)].filter(Boolean).join(' '), complement: str(sa.complement),
    municipality: str(sa.municipality), city: str(sa.city), region: str(sa.region_name) || str(sa.region),
    notes: [str(o.customer_note) || str(o.note), additional].filter(Boolean).join(' · '), products, total: num(o.total),
  };
}
export const toRow = (raw: unknown): OrderRow => { const l = toLabel(raw); return { id: l.id, createdAt: l.createdAt, status: l.status, name: l.name, municipality: l.municipality || l.city, shippingMethod: l.shippingMethod, total: l.total }; };

export class JumpsellerError extends Error { readonly status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

export function jumpsellerClient(c: JsCredentials, get: HttpGet) {
  const q = (path: string, params: Record<string, string | number> = {}) => {
    const u = new URL(BASE + path); u.searchParams.set('login', c.login); u.searchParams.set('authtoken', c.token);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    return u.toString();
  };
  const call = async (path: string, params?: Record<string, string | number>) => {
    const r = await get(q(path, params), { Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(`${c.login}:${c.token}`).toString('base64') });
    if (r.status === 401 || r.status === 403) throw new JumpsellerError('Jumpseller rechazó las credenciales (login o token incorrectos).', r.status);
    if (r.status === 404) throw new JumpsellerError('No existe ese pedido en Jumpseller.', 404);
    if (r.status === 429) throw new JumpsellerError('Jumpseller está limitando las consultas; espera unos segundos.', 429);
    if (r.status >= 400) throw new JumpsellerError(`Jumpseller respondió con error (${r.status}).`, r.status);
    return r.json();
  };
  return {
    async order(id: number): Promise<ShippingLabel> { return toLabel(await call(`/orders/${id}.json`)); },
    /** Últimos pedidos: se pide el conteo y se leen la primera y la última página (no depende del orden que use la API). */
    async recent(limit = 30): Promise<OrderRow[]> {
      const cnt = num(obj(await call('/orders/count.json')).count) ?? 0; const per = 50; const pages = Math.max(1, Math.ceil(cnt / per));
      const pagesToRead = [...new Set([1, pages])];
      const lists = await Promise.all(pagesToRead.map((p) => call('/orders.json', { limit: per, page: p })));
      const all = lists.flatMap((l) => (Array.isArray(l) ? l : [])).map(toRow).filter((r) => r.id > 0);
      const uniq = [...new Map(all.map((r) => [r.id, r])).values()];
      return uniq.sort((a, b) => b.id - a.id).slice(0, limit);
    },
  };
}
