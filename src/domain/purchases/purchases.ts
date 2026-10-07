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

/** Costo ingresado por línea: costo por unidad base en CENTAVOS (admite $1.508,50 => 150850) O el total de la línea en pesos. */
export type EnteredCost = { kind: 'unitCostCents'; cents: number } | { kind: 'unitCost'; amount: Peso } | { kind: 'lineAmount'; amount: Peso };
export interface PurchaseLineInput {
  quantityBase: Milli;                 // ya en unidad base (el servicio convierte presentaciones/unidades)
  pricesIncludeVat: boolean;
  vatRecoverable: boolean;             // factura: true; boleta: false
  entered: EnteredCost;
  vatRateHundredths?: number;
}
export interface PurchaseLinePlan { lineNet: Peso; lineVat: Peso; lineTotal: Peso; costBasis: Peso }

/**
 * Monto de la línea en pesos enteros: redondeo(cantidad × costo unitario × (1 − descuento)).
 * El redondeo se hace UNA sola vez, al final (ej.: caja $39.696 con 20 % de dcto. = 31.756,8 -> $31.757, igual que la factura).
 * discountMilli: milésimas de punto porcentual (20 % = 20000).
 */
export function enteredLineAmount(quantityBase: Milli, e: EnteredCost, discountMilli = 0): Peso {
  if (quantityBase <= 0n) throw validation('La cantidad comprada debe ser mayor que 0.');
  if (!Number.isSafeInteger(discountMilli) || discountMilli < 0 || discountMilli >= 100_000) throw validation('El descuento debe estar entre 0 % y menos de 100 %.');
  const keep = BigInt(100_000 - discountMilli);
  let amount: number;
  if (e.kind === 'lineAmount') {
    if (!Number.isSafeInteger(e.amount) || e.amount < 0) throw validation('Monto de compra inválido.');
    amount = Number(divRoundHalfUp(BigInt(e.amount) * keep, 100_000n));
  } else {
    const cents = e.kind === 'unitCostCents' ? e.cents : e.amount * 100;
    if (!Number.isSafeInteger(cents) || cents < 0) throw validation('Costo unitario inválido (máximo 2 decimales).');
    amount = Number(divRoundHalfUp(quantityBase * BigInt(cents) * keep, 100_000n * 100_000n));   // milésimas × centavos × fracción
  }
  if (!Number.isSafeInteger(amount) || amount < 0) throw validation('Monto de compra inválido.');
  return amount;
}

/** Línea aislada (IVA calculado sobre la propia línea). Para un documento completo usar planPurchaseDocument. */
export function planPurchaseLine(i: PurchaseLineInput): PurchaseLinePlan {
  return planPurchaseDocument([{ quantityBase: i.quantityBase, entered: i.entered }], i)[0];
}

/** Reparte `total` entre las líneas en proporción a `weights` (piso + mayor resto; empate: índice menor). Σ = total exacto. */
function distribute(total: number, weights: number[]): number[] {
  const W = weights.reduce((s, w) => s + w, 0);
  if (W === 0) { const out = weights.map(() => 0); if (out.length) out[0] = total; return out; }
  const T = BigInt(total), WW = BigInt(W);
  const parts = weights.map((w, i) => ({ i, floor: (T * BigInt(w)) / WW, rem: (T * BigInt(w)) % WW }));
  let left = total - parts.reduce((s, p) => s + Number(p.floor), 0);
  const out = parts.map((p) => Number(p.floor));
  for (const p of [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1))) { if (left <= 0) break; out[p.i]++; left--; }
  return out;
}

/**
 * Documento completo, como una factura chilena: el IVA se calcula UNA vez sobre el total del documento
 * (neto: IVA = redondeo(Σneto × 19 %); con IVA: neto = redondeo(Σtotal ÷ 1,19)) y se reparte entre líneas por mayor resto.
 * Así Σ líneas = encabezado y el total coincide con el papel. costBasis = neto (factura) o total (boleta).
 */
export function planPurchaseDocument(lines: { quantityBase: Milli; entered: EnteredCost; discountMilli?: number }[], o: { pricesIncludeVat: boolean; vatRecoverable: boolean; vatRateHundredths?: number }): PurchaseLinePlan[] {
  const rate = o.vatRateHundredths ?? 1900;
  const amounts = lines.map((l) => enteredLineAmount(l.quantityBase, l.entered, l.discountMilli ?? 0));
  const sum = amounts.reduce((s, a) => s + a, 0);
  let nets: number[], vats: number[];
  if (o.pricesIncludeVat) {
    nets = distribute(netFromGross(sum, rate), amounts);
    vats = amounts.map((a, i) => a - nets[i]);
    // un reparto proporcional nunca deja neto > total ni negativo, pero se verifica por seguridad
    if (vats.some((v) => v < 0)) throw validation('No se pudo repartir el IVA del documento.');
  } else {
    nets = amounts;
    vats = distribute(Number(divRoundHalfUp(BigInt(sum) * BigInt(rate), 10000n)), amounts);
  }
  return amounts.map((_, i) => {
    const lineNet = nets[i], lineVat = vats[i], lineTotal = lineNet + lineVat;
    return { lineNet, lineVat, lineTotal, costBasis: o.vatRecoverable ? lineNet : lineTotal };
  });
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
