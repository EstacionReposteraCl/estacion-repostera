// Aritmética entera exacta. Sin flotantes. CLP = pesos enteros; cantidades = milésimas enteras (bigint).
export type Peso = number; // entero seguro
export type Milli = bigint; // cantidad en milésimas de la unidad base (1,000 KG = 1000n)

/** Redondeo "mitad hacia arriba" de num/den, num >= 0, den > 0. */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('den debe ser > 0');
  if (num < 0n) throw new RangeError('num debe ser >= 0');
  return (2n * num + den) / (2n * den);
}

export function toPeso(n: bigint): Peso {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('monto fuera de rango');
  return Number(n);
}

export function assertPeso(n: number, label = 'monto'): asserts n is Peso {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} debe ser un entero en pesos`);
}
