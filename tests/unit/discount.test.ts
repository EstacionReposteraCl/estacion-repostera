import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscount, spreadDiscount } from '../../src/domain/pricing/discount.ts';

test('descuento: interpreta % o pesos', () => {
  assert.equal(parseDiscount('10%', 10770), 1077); assert.equal(parseDiscount('12,5 %', 1000), 125);
  assert.equal(parseDiscount('$1.500', 10770), 1500); assert.equal(parseDiscount('', 100), 0);
  assert.equal(parseDiscount('100%', 100), null); assert.equal(parseDiscount('abc', 100), null); assert.equal(parseDiscount('20000', 10770), null);
});

test('descuento: se reparte entre las líneas y el total cuadra exacto', () => {
  const lines = [{ qty: 1, unitPrice: 2790 }, { qty: 2, unitPrice: 3990 }];
  for (const d of [1, 1077, 1500, 3333, 5000]) {
    const r = spreadDiscount(lines, d)!; const sum = r.prices.reduce((a, p, i) => a + p * lines[i].qty, 0);
    assert.equal(r.applied, d); assert.equal(sum, 10770 - d); assert.ok(r.prices.every((p) => p > 0));
  }
  const odd = spreadDiscount([{ qty: 3, unitPrice: 1000 }], 100)!;   // 2900/3 no es entero: queda lo más cercano
  assert.equal(odd.prices[0], 966); assert.equal(odd.applied, 102);
  assert.equal(spreadDiscount([{ qty: 1.5, unitPrice: 100 }], 10), null);
});
