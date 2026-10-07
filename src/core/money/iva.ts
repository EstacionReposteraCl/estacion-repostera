import { divRoundHalfUp, type Peso } from './rounding.ts';
import type { Milli } from './rounding.ts';

/** Total de línea por unidad base: redondeo(cantidad × precio). qty en milésimas. */
export function lineTotalPerBase(qty: Milli, unitPrice: Peso): Peso {
  return Number(divRoundHalfUp(qty * BigInt(unitPrice), 1000n));
}
/** Total de línea por presentación: envases × precio. packs entero (milésimas múltiplos de 1000). */
export function lineTotalPerPack(packsMilli: Milli, unitPrice: Peso): Peso {
  if (packsMilli % 1000n !== 0n) throw new RangeError('las presentaciones se venden en envases enteros');
  return Number((packsMilli / 1000n) * BigInt(unitPrice));
}

/** neto = redondeo(total ÷ 1,19) para tasa 19%. (total×100×2 + 119) ÷ 238. Generalizado a tasa en centésimas (1900). */
export function netFromGross(gross: Peso, rateHundredths = 1900): Peso {
  const base = 10000n + BigInt(rateHundredths); // 1,19 => 11900 sobre 10000
  return Number(divRoundHalfUp(BigInt(gross) * 10000n, base));
}

export interface LineIn { total: Peso; taxable: boolean }
export interface LineOut { total: Peso; net: Peso; vat: Peso }
export interface SaleTotals { total: Peso; net: Peso; vat: Peso; lines: LineOut[] }

/**
 * Regla aprobada: el neto/IVA se calcula SOBRE EL TOTAL AFECTO de la venta; lo exento suma íntegro al neto con IVA 0.
 * El neto afecto se reparte entre las líneas afectas por MAYOR RESTO (empate: índice menor) => Σ lineNet = netTotal exacto.
 */
export function computeSaleTotals(lines: LineIn[], rateHundredths = 1900): SaleTotals {
  const taxableIdx = lines.map((l, i) => (l.taxable ? i : -1)).filter((i) => i >= 0);
  const taxableTotal = taxableIdx.reduce((s, i) => s + lines[i].total, 0);
  const netTaxable = netFromGross(taxableTotal, rateHundredths);
  const out: LineOut[] = lines.map((l) => ({ total: l.total, net: l.total, vat: 0 }));
  if (taxableTotal > 0) {
    // reparto proporcional exacto: share_i = netTaxable × total_i / taxableTotal; piso + mayor resto
    const T = BigInt(taxableTotal), N = BigInt(netTaxable);
    const parts = taxableIdx.map((i) => {
      const prod = N * BigInt(lines[i].total);
      return { i, floor: prod / T, rem: prod % T };
    });
    let left = netTaxable - parts.reduce((s, p) => s + Number(p.floor), 0);
    const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
    const extra = new Map<number, number>();
    for (const p of order) { if (left > 0) { extra.set(p.i, 1); left--; } }
    for (const p of parts) {
      const net = Number(p.floor) + (extra.get(p.i) ?? 0);
      out[p.i] = { total: lines[p.i].total, net, vat: lines[p.i].total - net };
    }
  }
  const total = out.reduce((s, l) => s + l.total, 0);
  const net = out.reduce((s, l) => s + l.net, 0);
  return { total, net, vat: total - net, lines: out };
}
