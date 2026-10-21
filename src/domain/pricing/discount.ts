// Descuento sobre toda la venta (p. ej. una promoción de Uber): se reparte entre las líneas bajando su precio unitario,
// para que la boleta muestre precios reales y el total cuadre exacto con lo cobrado. Funciones puras.

/** Interpreta "10%", "10 %", "1.500", "$1.500". Devuelve el descuento en pesos (entero) o null si es inválido. */
export function parseDiscount(input: string, total: number): number | null {
  const t = input.trim(); if (!t) return 0;
  const pct = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(t);
  if (pct) { const p = Number(pct[1].replace(',', '.')); return p > 0 && p < 100 ? Math.round((total * p) / 100) : null; }
  const n = t.replace(/[.$\s]/g, ''); if (!/^\d+$/.test(n)) return null;
  const v = Number(n); return v >= 0 && v < total ? v : null;
}

/**
 * Nuevos precios unitarios (enteros, > 0) para que Σ cantidad × precio = total − descuento.
 * Reparte en proporción; el sobrante por redondeo se suma de a 1 peso a las líneas. Si no cuadra exacto
 * (cantidades grandes), el descuento real queda unos pesos menor: se informa en `applied`.
 */
export function spreadDiscount(lines: { qty: number; unitPrice: number }[], discount: number): { prices: number[]; applied: number } | null {
  if (lines.some((l) => !Number.isInteger(l.qty) || l.qty <= 0 || !Number.isInteger(l.unitPrice) || l.unitPrice <= 0)) return null;
  const total = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  if (discount <= 0) return { prices: lines.map((l) => l.unitPrice), applied: 0 };
  if (discount >= total) return null;
  const target = total - discount;
  const prices = lines.map((l) => Math.max(1, Math.floor((l.unitPrice * target) / total)));
  let rest = target - lines.reduce((a, l, i) => a + l.qty * prices[i], 0);
  const order = lines.map((_, i) => i).sort((a, b) => lines[a].qty - lines[b].qty);       // primero las de cantidad 1: el ajuste es exacto
  for (const i of order) { const k = Math.floor(rest / lines[i].qty); if (k > 0) { prices[i] += k; rest -= k * lines[i].qty; } if (rest === 0) break; }
  const sum = lines.reduce((a, l, i) => a + l.qty * prices[i], 0);
  return { prices, applied: total - sum };
}
