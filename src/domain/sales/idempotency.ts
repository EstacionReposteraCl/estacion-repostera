import { parseQuantity } from '../../core/money/quantity.ts';
import type { Peso } from '../../core/money/rounding.ts';
import type { SaleInput, CatalogProduct } from './sale-plan.ts';

/**
 * Huella canónica de la OPERACIÓN pedida (no del resultado): así un reintento legítimo después de cambiar un precio
 * o archivar un producto sigue siendo "la misma operación". Se calcula igual desde el pedido y desde la venta guardada,
 * sin columnas nuevas en el schema.
 *  línea = producto · presentación · cantidad ingresada (milésimas) · unidad ingresada (solo líneas sin presentación) · precio manual (solo si lo hubo)
 *  venta = canal · referencia externa · nota · líneas EN ORDEN · pagos ordenados (medio, monto) · usuario
 */
export interface Fingerprint { userId: string; channelId: string; externalRef: string | null; note: string | null; lines: [string, string | null, string, string | null, Peso | null][]; payments: [string, Peso][] }
const norm = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export function fingerprintOfRequest(userId: string, input: SaleInput, products: Map<string, CatalogProduct>): Fingerprint {
  return {
    userId, channelId: input.channelId, externalRef: norm(input.externalRef), note: norm(input.note),
    lines: input.lines.map((l) => {
      const base = products.get(l.productId)?.unit.code ?? null;
      return [l.productId, l.presentationId ?? null, parseQuantity(l.quantity).toString(), l.presentationId ? null : (l.unitCode ?? base), l.manualUnitPrice ?? null];
    }),
    payments: input.payments.map((p) => [p.methodId, p.amount] as [string, Peso]).sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1)),
  };
}
export interface StoredSale {
  createdById: string; channelId: string; externalRef?: string | null; note?: string | null;
  items: { lineNumber: number; productId: string; presentationId: string | null; enteredQuantity: bigint; enteredUnit: string; isManualPrice: boolean; unitPrice: Peso }[];
  payments: { methodId: string; amount: Peso }[];
}
export function fingerprintOfStored(s: StoredSale): Fingerprint {
  return {
    userId: s.createdById, channelId: s.channelId, externalRef: norm(s.externalRef), note: norm(s.note),
    lines: [...s.items].sort((a, b) => a.lineNumber - b.lineNumber).map((i) => [i.productId, i.presentationId, i.enteredQuantity.toString(), i.presentationId ? null : i.enteredUnit, i.isManualPrice ? i.unitPrice : null]),
    payments: s.payments.map((p) => [p.methodId, p.amount] as [string, Peso]).sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1)),
  };
}
export const sameOperation = (a: Fingerprint, b: Fingerprint) => JSON.stringify(a) === JSON.stringify(b);
