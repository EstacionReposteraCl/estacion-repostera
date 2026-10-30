/**
 * Cotizaciones: documento para el cliente con productos, precios, vigencia, condiciones de pago y datos del proveedor.
 * No mueve stock ni suma a las ventas. Se guardan en la bitácora (acción 'quote.save', una foto completa por cambio).
 */
export const QUOTE_VALIDITY = [7, 15, 30] as const;
export const QUOTE_PAY = ['TRANSFER', 'CASH', 'DEBIT', 'CREDIT', 'OTHER'] as const;
export type QuotePay = (typeof QUOTE_PAY)[number];
export const QUOTE_PAY_LABEL: Record<QuotePay, string> = { TRANSFER: 'Transferencia', CASH: 'Efectivo', DEBIT: 'Débito', CREDIT: 'Crédito', OTHER: 'Otro' };
export type QuoteDocType = 'BOLETA' | 'FACTURA';
export type QuoteStatus = 'PENDING' | 'ACCEPTED' | 'VOID';
export type QuoteShownStatus = QuoteStatus | 'EXPIRED';
export const QUOTE_STATUS_LABEL: Record<QuoteShownStatus, string> = { PENDING: 'Pendiente', ACCEPTED: 'Aceptada', VOID: 'Anulada', EXPIRED: 'Vencida' };

export interface QuoteProvider {
  legalName: string; tradeName: string; rut: string; address: string; phone: string; email: string;
  bank: { holder: string; rut: string; bank: string; accountType: string; accountNumber: string; email: string };
  footer: string;
}
export interface QuoteLine { productId: string | null; sku: string | null; name: string; qty: number; unitPrice: number; total: number }
export interface QuoteDoc {
  id: string; number: number; date: string; validDays: number; validUntil: string;
  customer: { name: string; rut: string | null; phone: string | null; email: string | null };
  lines: QuoteLine[]; subtotal: number; discount: number; total: number; net: number; vat: number;
  payMethods: QuotePay[]; docType: QuoteDocType | null; notes: string | null;
  provider: QuoteProvider; status: QuoteStatus; statusNote: string | null; saleId: string | null;
  createdBy: string; createdAt: string;
}

export const quoteCode = (n: number) => `COT-${String(n).padStart(4, '0')}`;

/** Suma días a una fecha AAAA-MM-DD (calendario, sin zona horaria). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function shownStatus(q: Pick<QuoteDoc, 'status' | 'validUntil'>, today: string): QuoteShownStatus {
  return q.status === 'PENDING' && today > q.validUntil ? 'EXPIRED' : q.status;
}

/** RUT chileno con dígito verificador ("12.345.678-5" o "12345678-5"). Devuelve el RUT normalizado o null si es inválido. */
export function normalizeRut(raw: string): string | null {
  const s = raw.replace(/[.\s]/g, '').toUpperCase(); const m = /^(\d{1,9})-?([\dK])$/.exec(s); if (!m) return null;
  let sum = 0, mul = 2; for (let i = m[1].length - 1; i >= 0; i--) { sum += Number(m[1][i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const r = 11 - (sum % 11); const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return dv === m[2] ? `${Number(m[1]).toLocaleString('es-CL')}-${dv}` : null;
}

/** Totales con IVA incluido: total = Σ líneas − descuento; neto = total / 1,19 (redondeado); IVA = total − neto. */
export function quoteTotals(lines: { total: number }[], discount: number, vatRate = 19): { subtotal: number; discount: number; total: number; net: number; vat: number } {
  const subtotal = lines.reduce((s, l) => s + l.total, 0); const total = subtotal - discount;
  const net = Math.round((total * 100) / (100 + vatRate)); return { subtotal, discount, total, net, vat: total - net };
}

export const lineTotalOf = (qty: number, unitPrice: number) => Math.round(qty * unitPrice);
