import type { Milli, Peso } from '../../core/money/rounding.ts';
import { divRoundHalfUp } from '../../core/money/rounding.ts';
import { netFromGross } from '../../core/money/iva.ts';
import { validation, businessRule } from '../../core/errors/index.ts';
import { outflowCost } from '../inventory/inventory.ts';

export type DocType = 'FACTURA' | 'BOLETA' | 'OTRO';

/** Quita espacios, pasa a mayúsculas, elimina ceros a la izquierda ("  00123 " -> "123"). Vacío -> null. */
export function normalizeDocNumber(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.replace(/\s+/g, '').toUpperCase().replace(/^0+(?=.)/, '');
  return s.length ? s : null;
}
/** Clave anti-duplicado; NULL si no hay número o la compra no está CONFIRMED. */
export function buildDocumentKey(p: { supplierId: string | null; docType: DocType; docNumber: string | null; status: 'CONFIRMED' | 'VOIDED' }): string | null {
  const n = normalizeDocNumber(p.docNumber);
  if (!n || p.status !== 'CONFIRMED') return null;
  return `${p.supplierId ?? '-'}|${p.docType}|${n}`;
}
export function assertDocNumberRequired(docType: DocType, docNumber: string | null): void {
  if ((docType === 'FACTURA' || docType === 'BOLETA') && !normalizeDocNumber(docNumber)) throw validation('Factura y boleta exigen número de documento.');
}

export interface PurchaseLineInput {
  quantityBase: Milli;                 // ya en unidad base (el servicio convierte presentaciones/unidades)
  pricesIncludeVat: boolean;
  vatRecoverable: boolean;             // factura: true; boleta: false
  entered: { kind: 'unitCost'; amount: Peso } | { kind: 'lineAmount'; amount: Peso }; // costo unitario por unidad base O total de línea
  vatRateHundredths?: number;
}
export interface PurchaseLinePlan { lineNet: Peso; lineVat: Peso; lineTotal: Peso; costBasis: Peso }

/** costBasis = lineNet si el IVA es recuperable (factura), lineTotal si no (boleta). El costo unitario NO se guarda. */
export function planPurchaseLine(i: PurchaseLineInput): PurchaseLinePlan {
  if (i.quantityBase <= 0n) throw validation('La cantidad comprada debe ser mayor que 0.');
  const rate = i.vatRateHundredths ?? 1900;
  const amount = i.entered.kind === 'unitCost' ? Number(divRoundHalfUp(i.quantityBase * BigInt(i.entered.amount), 1000n)) : i.entered.amount;
  if (!Number.isSafeInteger(amount) || amount < 0) throw validation('Monto de compra inválido.');
  let lineNet: Peso, lineVat: Peso, lineTotal: Peso;
  if (i.pricesIncludeVat) { lineTotal = amount; lineNet = netFromGross(amount, rate); lineVat = lineTotal - lineNet; }
  else { lineNet = amount; lineVat = Number(divRoundHalfUp(BigInt(amount) * BigInt(rate), 10000n)); lineTotal = lineNet + lineVat; }
  return { lineNet, lineVat, lineTotal, costBasis: i.vatRecoverable ? lineNet : lineTotal };
}
/** Costo unitario derivado para mostrar (pesos por unidad base, 2 decimales) = costBasis ÷ cantidad. */
export function derivedUnitCost(costBasis: Peso, qty: Milli): string {
  const cents = divRoundHalfUp(BigInt(costBasis) * 1000n * 100n, qty);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export interface VoidItemState { productId: string; qtyPurchased: Milli; costBasis: Peso; purchaseMovementSeq: number; current: { qty: Milli; value: Peso; seq: number } }
export type VoidPlan =
  | { status: 'blocked'; reason: 'STOCK_BELOW_PURCHASED' | 'LATER_MOVEMENTS_REQUIRE_ADJUSTED'; productId: string }
  | { status: 'ok'; mode: 'EXACT' | 'ADJUSTED'; items: { productId: string; qtyRemoved: Milli; valueRemoved: Peso; variance: Peso; qtyAfter: Milli; valueAfter: Peso }[]; totalVariance: Peso };

/**
 * J1 EXACT: la compra fue el último movimiento -> se revierte exactamente (valor − costBasis).
 * J2 ADJUSTED: hubo movimientos posteriores -> bloqueado salvo que el ADMINISTRADOR pida ADJUSTED
 *    (retira round(valor × cant ÷ stock); varianza = costBasis − valor retirado).
 * J3: si el stock actual es menor que lo comprado, SIEMPRE bloqueado.
 */
export function planPurchaseVoid(items: VoidItemState[], opts: { adjusted: boolean; reason: string }): VoidPlan {
  if (!opts.reason || !opts.reason.trim()) throw businessRule('Anular una compra exige un motivo.');
  for (const it of items) if (it.current.qty < it.qtyPurchased) return { status: 'blocked', reason: 'STOCK_BELOW_PURCHASED', productId: it.productId };
  const isExact = items.every((it) => it.current.seq === it.purchaseMovementSeq);
  if (!isExact && !opts.adjusted) return { status: 'blocked', reason: 'LATER_MOVEMENTS_REQUIRE_ADJUSTED', productId: items.find((i) => i.current.seq !== i.purchaseMovementSeq)!.productId };
  const out = items.map((it) => {
    const valueRemoved = isExact ? it.costBasis : outflowCost({ qty: it.current.qty, value: it.current.value, seq: it.current.seq }, it.qtyPurchased);
    return { productId: it.productId, qtyRemoved: it.qtyPurchased, valueRemoved, variance: isExact ? 0 : it.costBasis - valueRemoved,
      qtyAfter: it.current.qty - it.qtyPurchased, valueAfter: it.current.value - valueRemoved };
  });
  for (const o of out) if (o.valueAfter < 0 || (o.qtyAfter === 0n && o.valueAfter !== 0)) throw businessRule('La anulación dejaría el inventario inconsistente.');
  return { status: 'ok', mode: isExact ? 'EXACT' : 'ADJUSTED', items: out, totalVariance: out.reduce((s, o) => s + o.variance, 0) };
}
