/**
 * Precios por canal (Uber, Rappi…): la lista de precios de cada app, cargada desde su catálogo.
 * Si un producto no está en la lista se usa el precio de tienda × factor, redondeado hacia arriba a "…90".
 * Sin lista para el canal: precio de tienda.
 */
export interface ChannelPriceList { prices: Record<string, number>; factor: number | null; source?: string | null; updatedAt?: string | null }
export type ChannelPriceLists = Record<string, ChannelPriceList>;   // por código de canal (UBER, RAPPI…)

/** Redondea hacia arriba al siguiente valor terminado en 90 (1.355 → 1.390; 1.390 → 1.390). */
export const roundUp90 = (x: number): number => Math.max(90, Math.ceil((Math.round(x) + 10) / 100) * 100 - 10);

export function channelUnitPrice(list: ChannelPriceList | null | undefined, productId: string, salePrice: number): number {
  if (!list) return salePrice;
  const p = list.prices[productId];
  if (Number.isSafeInteger(p) && p > 0) return p;
  if (list.factor && list.factor > 0 && salePrice > 0) return roundUp90(salePrice * list.factor);
  return salePrice;
}

/** Valida y normaliza lo guardado en la bitácora (datos externos: nunca se confía en la forma). */
export function parseChannelPriceLists(raw: unknown): ChannelPriceLists {
  const out: ChannelPriceLists = {};
  const lists = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).lists : null;
  if (!lists || typeof lists !== 'object') return out;
  for (const [code, v] of Object.entries(lists as Record<string, unknown>)) {
    if (!/^[A-Z_]{2,30}$/.test(code) || !v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>; const prices: Record<string, number> = {};
    if (o.prices && typeof o.prices === 'object') for (const [pid, n] of Object.entries(o.prices as Record<string, unknown>)) if (typeof n === 'number' && Number.isSafeInteger(n) && n > 0) prices[pid] = n;
    const factor = typeof o.factor === 'number' && o.factor > 0 && o.factor < 5 ? o.factor : null;
    out[code] = { prices, factor, source: typeof o.source === 'string' ? o.source : null, updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null };
  }
  return out;
}
