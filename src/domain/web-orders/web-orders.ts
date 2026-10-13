// Pedidos de la tienda web (Jumpseller) → ventas del sistema. Funciones puras: interpretar el pedido,
// decidir el medio de pago y repartir montos para que la venta sume exactamente el total cobrado.
/** Medios de pago que se pueden elegir al revisar un pedido web. */
export const PAY_OPTIONS = [['DEBIT', 'TUU Pago online / Débito'], ['CREDIT', 'Crédito'], ['MERCADO_PAGO', 'Mercado Pago'], ['TRANSFER', 'Transferencia'], ['CASH', 'Efectivo']] as const;

export interface WebLine { sku: string; name: string; qty: number; lineTotal: number }
export interface WebOrder {
  id: number; status: string; date: string | null; total: number; shipping: number; shippingMethod: string; payment: string;
  customer: string; lines: WebLine[];
}

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const n = (v: unknown) => { const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN; return Number.isFinite(x) ? x : 0; };
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function parseWebOrder(raw: unknown): WebOrder {
  const w = o(raw); const r = o('order' in w ? w.order : w); const cu = o(r.customer); const sa = o(r.shipping_address);
  const lines = (Array.isArray(r.products) ? r.products : []).map((p) => {
    const x = o(p); const qty = Math.round(n(x.qty)) || 1; const price = Math.round(n(x.price)); const disc = Math.round(n(x.discount));
    return { sku: s(x.sku), name: s(x.name), qty, lineTotal: Math.max(price * qty - disc * qty, 0) };
  }).filter((l) => l.name);
  return {
    id: Math.round(n(r.id)), status: s(r.status), date: s(r.completed_at) || s(r.created_at) || null, total: Math.round(n(r.total)), shipping: Math.round(n(r.shipping)),
    shippingMethod: s(r.shipping_method_name), payment: s(r.payment_method_name),
    customer: s(cu.fullname) || [s(sa.name), s(sa.surname)].filter(Boolean).join(' '), lines,
  };
}

/** Medio de pago del sistema según el medio del pedido. 'ML' = pedido de Mercado Libre (se registra como venta de ML, no aquí). null = no se sabe. */
export function paymentFor(name: string): 'DEBIT' | 'MERCADO_PAGO' | 'TRANSFER' | 'ML' | null {
  const t = name.toLowerCase();
  if (/mercado\s*libre/.test(t)) return 'ML';
  if (/mercado\s*pago/.test(t)) return 'MERCADO_PAGO';
  if (/transfer/.test(t)) return 'TRANSFER';
  if (/pago online|webpay|tuu/.test(t)) return 'DEBIT';
  return null;
}

/** Producto de envío del sistema según el método de envío del pedido. */
export const shippingSkuFor = (method: string) => (/pedidos\s*ya/i.test(method) ? 'WB-ENVIO' : 'ENV-PRO-PIO');

/** Fecha contable (AAAA-MM-DD, hora de Chile) del pedido. */
export function orderBusinessDate(date: string | null, tz = 'America/Santiago'): string | null {
  if (!date) return null; const d = new Date(date.includes('T') ? date : date.replace(' UTC', 'Z').replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export interface PricedLine { index: number; qty: number; unitPrice: number }
/**
 * Precio unitario de cada línea para que productos + envío sumen exactamente el total del pedido
 * (reparte descuentos de cupón proporcionalmente). null si no se puede cuadrar con precios enteros.
 */
export function priceLines(order: WebOrder): PricedLine[] | null {
  const target = order.total - order.shipping; const sum = order.lines.reduce((a, l) => a + l.lineTotal, 0);
  if (target < 0 || order.lines.length === 0) return null;
  if (sum === target) return order.lines.map((l, i) => (l.lineTotal % l.qty === 0 ? { index: i, qty: l.qty, unitPrice: l.lineTotal / l.qty } : null)).every(Boolean)
    ? order.lines.map((l, i) => ({ index: i, qty: l.qty, unitPrice: l.lineTotal / l.qty })) : null;
  if (sum <= 0) return null;
  // Descuento global: se reparte en proporción y lo que sobra por redondeo va a una línea de cantidad 1.
  const out = order.lines.map((l, i) => ({ index: i, qty: l.qty, unitPrice: Math.floor((l.lineTotal * target) / sum / l.qty) }));
  let rest = target - out.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  for (const l of out) { if (rest === 0) break; if (l.qty === 1) { l.unitPrice += rest; rest = 0; } }
  for (const l of out) { while (rest >= l.qty) { l.unitPrice += 1; rest -= l.qty; } }
  return rest === 0 ? out : null;
}
