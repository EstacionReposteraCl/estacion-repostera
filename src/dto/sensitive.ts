// Defensa en profundidad: ningún DTO destinado al VENDEDOR puede contener estas claves, a ninguna profundidad.
export const SENSITIVE_KEYS: readonly string[] = [
  'cost', 'costs', 'unitcost', 'avgcost', 'averagecost', 'inventoryvalue', 'linecost', 'costofgoodssold', 'cogs', 'costrecovered',
  'grossprofit', 'realprofit', 'margin', 'profit', 'totalcharges', 'charges', 'fee', 'feerule', 'feerules', 'percentapplied', 'fixedapplied',
  'valuechange', 'valueafter', 'costbasis', 'voidvariance', 'purchaseprice', 'recalculatedat', 'recalculatedbyid',
];
export function findSensitiveKeys(value: unknown, path = '$'): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => hits.push(...findSensitiveKeys(v, `${path}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) hits.push(`${path}.${k}`);
      hits.push(...findSensitiveKeys(v, `${path}.${k}`));
    }
  }
  return hits;
}
export function assertNoSensitiveKeys<T>(dto: T): T {
  const hits = findSensitiveKeys(dto);
  if (hits.length) throw new Error(`DTO de vendedor con claves sensibles: ${hits.join(', ')}`);
  return dto;
}
