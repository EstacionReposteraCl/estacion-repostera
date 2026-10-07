// Plan PURO de los saldos iniciales del seed demo (verificable sin Prisma). seed.ts solo lo traduce a escrituras.
import { parseQuantity } from '../src/core/money/quantity.ts';
import { planInflow } from '../src/domain/inventory/inventory.ts';
import { SEED_DEMO_PRODUCTS } from './seed-data.ts';
export function planOpeningBalances() {
  return SEED_DEMO_PRODUCTS.flatMap((p) => {
    if (!('opening' in p)) return [];
    const m = planInflow({ qty: 0n, value: 0, seq: 0 }, parseQuantity(p.opening.qty), p.opening.value);
    return [{ sku: p.sku, qty: p.opening.qty, valueAfter: m.valueAfter, seq: m.seq, valueChange: m.valueChange }];
  });
}
