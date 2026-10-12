import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, priceForMargin, roundPrice } from '../../src/domain/pricing/simulator.ts';

test('simulador: neto sin IVA, comisión % + fija, ganancia y margen', () => {
  const r = simulate({ price: 11900, discountPct: 0, cost: 5000, exempt: false, fee: { percent: 17.85, fixed: 0 } });
  assert.equal(r.net, 10000); assert.equal(r.iva, 1900); assert.equal(r.fee, 2124); assert.equal(r.profit, 2876); assert.equal(Math.round(r.marginPct!), 29);
  const d = simulate({ price: 11900, discountPct: 10, cost: 5000, exempt: false, fee: { percent: 0.71, fixed: 65 } });
  assert.equal(d.finalPrice, 10710); assert.equal(d.net, 9000); assert.equal(d.fee, 141); assert.equal(d.profit, 3859);
  const e = simulate({ price: 2000, discountPct: 0, cost: 1500, exempt: true, fee: { percent: 0, fixed: 0 } });
  assert.equal(e.net, 2000); assert.equal(e.iva, 0); assert.equal(e.profit, 500);
  assert.equal(simulate({ price: 1000, discountPct: 150, cost: 0, exempt: false, fee: { percent: 0, fixed: 65 } }).fee, 0);
});

test('simulador: precio para un margen (vuelve a dar ese margen) y redondeo a precio de vitrina', () => {
  const fee = { percent: 17.85, fixed: 0 };
  const p = priceForMargin(5000, 30, false, fee)!;
  const r = simulate({ price: p, discountPct: 0, cost: 5000, exempt: false, fee });
  assert.ok(Math.abs(r.marginPct! - 30) < 0.2);
  assert.equal(priceForMargin(5000, 90, false, fee), null);
  assert.equal(roundPrice(4812), 4890); assert.equal(roundPrice(4990), 4990); assert.equal(roundPrice(4991), 5090); assert.equal(roundPrice(643), 650);
});
