import type { Milli, Peso } from '../../core/money/rounding.ts';
import { divRoundHalfUp } from '../../core/money/rounding.ts';
import { invariant, insufficientStock } from '../../core/errors/index.ts';

/** Estado de (sucursal, producto) GOODS: cantidad en milésimas y valor entero en pesos. El costo promedio NO se guarda. */
export interface InventoryState { qty: Milli; value: Peso; seq: number }
export interface MovementPlan { quantity: Milli /* con signo */; valueChange: Peso /* con signo */; qtyBefore: Milli; qtyAfter: Milli; valueAfter: Peso; seq: number }

export function assertInvariant(s: { qty: Milli; value: Peso }): void {
  if (s.qty < 0n) throw invariant('stock negativo');
  if (s.value < 0) throw invariant('valor de inventario negativo');
  if (s.qty === 0n && s.value !== 0) throw invariant('stock 0 con valor distinto de 0');
}

/** Costo de una salida: round(valor × salida ÷ stock); si sale TODO el stock, se lleva exactamente el valor restante. */
export function outflowCost(s: InventoryState, qtyOut: Milli): Peso {
  if (qtyOut <= 0n) throw invariant('salida debe ser > 0');
  if (qtyOut > s.qty) throw insufficientStock('producto');
  if (qtyOut === s.qty) return s.value;
  return Number(divRoundHalfUp(BigInt(s.value) * qtyOut, s.qty));
}

export function planOutflow(s: InventoryState, qtyOut: Milli): MovementPlan {
  assertInvariant(s);
  const cost = outflowCost(s, qtyOut);
  const next = { qty: s.qty - qtyOut, value: s.value - cost };
  assertInvariant(next);
  return { quantity: -qtyOut, valueChange: -cost, qtyBefore: s.qty, qtyAfter: next.qty, valueAfter: next.value, seq: s.seq + 1 };
}

/** Entrada con valor explícito (compra: costBasis; devolución: costo congelado; anulación de venta: costo congelado). */
export function planInflow(s: InventoryState, qtyIn: Milli, valueIn: Peso): MovementPlan {
  assertInvariant(s);
  if (qtyIn <= 0n) throw invariant('entrada debe ser > 0');
  if (!Number.isSafeInteger(valueIn) || valueIn < 0) throw invariant('valor de entrada inválido');
  const next = { qty: s.qty + qtyIn, value: s.value + valueIn };
  assertInvariant(next);
  return { quantity: qtyIn, valueChange: valueIn, qtyBefore: s.qty, qtyAfter: next.qty, valueAfter: next.value, seq: s.seq + 1 };
}

/** Corrección excepcional de costo: cantidad 0, solo cambia el valor. Exige stock > 0 y motivo. */
export function planCostCorrection(s: InventoryState, newValue: Peso, note: string): MovementPlan {
  assertInvariant(s);
  if (!note || note.trim().length === 0) throw invariant('la corrección de costo exige motivo');
  if (s.qty === 0n) throw invariant('no se corrige el costo de un producto sin stock');
  if (!Number.isSafeInteger(newValue) || newValue <= 0) throw invariant('el nuevo valor debe ser > 0 con stock > 0');
  return { quantity: 0n, valueChange: newValue - s.value, qtyBefore: s.qty, qtyAfter: s.qty, valueAfter: newValue, seq: s.seq + 1 };
}

export interface MovementRow { seq: number; quantity: Milli; valueChange: Peso; qtyBefore: Milli; qtyAfter: Milli; valueAfter: Peso }
/** Prueba K: stock = Σ movimientos, valor = Σ valueChange, encadenados sin huecos ni saltos. */
export function reconcile(rows: MovementRow[], current: { qty: Milli; value: Peso; seq: number }): string[] {
  const errs: string[] = []; let q = 0n, v = 0, expectedSeq = 1;
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (r.seq !== expectedSeq) errs.push(`hueco/duplicado en seq ${r.seq} (esperaba ${expectedSeq})`);
    expectedSeq = r.seq + 1;
    if (r.qtyBefore !== q) errs.push(`seq ${r.seq}: qtyBefore no encadena`);
    if (r.qtyAfter !== r.qtyBefore + r.quantity) errs.push(`seq ${r.seq}: qtyAfter != before + quantity`);
    q += r.quantity; v += r.valueChange;
    if (r.valueAfter !== v) errs.push(`seq ${r.seq}: valueAfter no coincide con Σ valueChange`);
  }
  if (q !== current.qty) errs.push(`stock ${current.qty} != Σ movimientos ${q}`);
  if (v !== current.value) errs.push(`valor ${current.value} != Σ valueChange ${v}`);
  if (rows.length !== current.seq) errs.push(`movementSeq ${current.seq} != n° de movimientos ${rows.length}`);
  return errs;
}

/** Costo unitario derivado (solo para mostrar al ADMINISTRADOR): valor ÷ cantidad, en pesos con 2 decimales como texto. */
export function averageCostDisplay(s: { qty: Milli; value: Peso }): string | null {
  if (s.qty === 0n) return null;
  const cents = divRoundHalfUp(BigInt(s.value) * 1000n * 100n, s.qty);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}
