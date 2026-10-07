import type { Milli } from './rounding.ts';

/** Convierte texto ("0,080", "1.5", "80") a milésimas. Acepta coma o punto decimal. Máx. 3 decimales. */
export function parseQuantity(text: string): Milli {
  const t = text.trim().replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) throw new RangeError(`cantidad inválida: "${text}" (máx. 3 decimales, sin signo)`);
  return BigInt(m[1]) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0') || '0');
}

/** Formato canónico con 3 decimales para guardar en Decimal(14,3): "1.000". */
export function formatQuantity(q: Milli): string {
  const neg = q < 0n; const a = neg ? -q : q;
  return `${neg ? '-' : ''}${a / 1000n}.${(a % 1000n).toString().padStart(3, '0')}`;
}

export interface UnitDef { code: string; dimension: 'COUNT' | 'MASS' | 'VOLUME'; factorToBase: bigint /* micro-unidades: 1.000000 => 1_000_000n */; maxDecimals: number }
export const FACTOR_SCALE = 1_000_000n;

/**
 * Convierte `qty` expresada en `from` a la unidad base `base` (misma dimensión). Resultado en milésimas,
 * redondeo mitad hacia arriba. 80 g -> 0,080 KG (G=1, KG=1000).
 */
export function convertToBase(qty: Milli, from: UnitDef, base: UnitDef): Milli {
  if (from.dimension !== base.dimension) throw new RangeError('unidades de distinta dimensión');
  const num = qty * from.factorToBase;
  const den = base.factorToBase;
  return (2n * num + den) / (2n * den);
}

/** Valida que la cantidad ingresada respete los decimales permitidos de la unidad. */
export function hasValidDecimals(entered: Milli, maxDecimals: number): boolean {
  if (maxDecimals < 0 || maxDecimals > 3) throw new RangeError('maxDecimals fuera de rango');
  const step = 10n ** BigInt(3 - maxDecimals);
  return entered % step === 0n;
}

/** Prisma devuelve Decimal (decimal.js). Se convierte vía texto exacto, nunca vía Number. */
export function decimalToMilli(d: { toFixed(digits: number): string } | string): Milli {
  const t = typeof d === 'string' ? d : d.toFixed(3);
  return parseQuantity(t);
}
