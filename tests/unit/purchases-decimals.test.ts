import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyCents } from '../../src/core/money/parse-money.ts';
import { planPurchaseDocument, planPurchaseLine } from '../../src/domain/purchases/purchases.ts';

test('parseMoneyCents: formato chileno con centavos', () => {
  assert.equal(parseMoneyCents('1.508,50'), 150850);
  assert.equal(parseMoneyCents('1508,5'), 150850);
  assert.equal(parseMoneyCents('$ 1.508'), 150800);
  assert.equal(parseMoneyCents('1508.50'), 150850);
  assert.equal(parseMoneyCents('12.345.678'), 1234567800);
  assert.equal(parseMoneyCents('130.513'), 13051300);
  assert.equal(parseMoneyCents('0,29'), 29);
  for (const bad of ['', 'abc', '1,234,5', '1.50.0', '1,505', '-3', '15.0000']) assert.equal(parseMoneyCents(bad), null, bad);
});

test('costo unitario con centavos: se redondea UNA vez sobre el total de la línea', () => {
  // 6 × $1.508,50 = $9.051 exacto (antes, con $1.508 entero, daba $9.048)
  const [l] = planPurchaseDocument([{ quantityBase: 6000n, entered: { kind: 'unitCostCents', cents: 150850 } }], { pricesIncludeVat: false, vatRecoverable: true });
  assert.equal(l.lineNet, 9051);
  // 7 × $1.508,50 = 10.559,5 -> $10.560 (half-up)
  const [m] = planPurchaseDocument([{ quantityBase: 7000n, entered: { kind: 'unitCostCents', cents: 150850 } }], { pricesIncludeVat: false, vatRecoverable: true });
  assert.equal(m.lineNet, 10560);
});

test('IVA sobre el total del documento (como la factura), repartido por mayor resto', () => {
  const lines = [3, 5, 7].map((n) => ({ quantityBase: 1000n, entered: { kind: 'lineAmount' as const, amount: 101 + n } }));
  const doc = planPurchaseDocument(lines, { pricesIncludeVat: false, vatRecoverable: true });
  const net = doc.reduce((s, l) => s + l.lineNet, 0), vat = doc.reduce((s, l) => s + l.lineVat, 0);
  assert.equal(net, 104 + 106 + 108);
  assert.equal(vat, Math.round(318 * 0.19));            // 60,42 -> 60 sobre el total
  const perLine = lines.map((l) => planPurchaseLine({ ...l, pricesIncludeVat: false, vatRecoverable: true }).lineVat).reduce((a, b) => a + b, 0);
  assert.equal(perLine, 20 + 20 + 21);                   // por línea habría dado 61 (1 peso de diferencia)
  for (const l of doc) { assert.equal(l.lineNet + l.lineVat, l.lineTotal); assert.equal(l.costBasis, l.lineNet); }
});

test('con IVA incluido: neto = redondeo(Σtotal ÷ 1,19) repartido; boleta costea el total', () => {
  const lines = [1000, 2000, 3001].map((a) => ({ quantityBase: 1000n, entered: { kind: 'lineAmount' as const, amount: a } }));
  const doc = planPurchaseDocument(lines, { pricesIncludeVat: true, vatRecoverable: false });
  assert.equal(doc.reduce((s, l) => s + l.lineTotal, 0), 6001);
  assert.equal(doc.reduce((s, l) => s + l.lineNet, 0), Math.round(6001 / 1.19));
  for (const [i, l] of doc.entries()) { assert.equal(l.lineTotal, [1000, 2000, 3001][i]); assert.equal(l.costBasis, l.lineTotal); assert.ok(l.lineVat >= 0); }
});

test('costo unitario inválido', () => {
  assert.throws(() => planPurchaseDocument([{ quantityBase: 1000n, entered: { kind: 'unitCostCents', cents: 1.5 } }], { pricesIncludeVat: false, vatRecoverable: true }));
  assert.throws(() => planPurchaseDocument([{ quantityBase: 0n, entered: { kind: 'unitCostCents', cents: 100 } }], { pricesIncludeVat: false, vatRecoverable: true }));
});

test('pack sin precio unitario con descuento: caja de 12 a $39.696 con 20 % = $31.757 -> $2.646,42 c/u', async () => {
  const { derivedUnitCost } = await import('../../src/domain/purchases/purchases.ts');
  const [l] = planPurchaseDocument([{ quantityBase: 12000n, entered: { kind: 'lineAmount', amount: 39696 }, discountMilli: 20000 }], { pricesIncludeVat: false, vatRecoverable: true });
  assert.equal(l.lineNet, 31757);
  assert.equal(derivedUnitCost(l.costBasis, 12000n), '2646.42');
  // por unidad con descuento: redondeo una sola vez (6 × 1.508,50 × 0,875 = 7.919,625 -> 7.920)
  const [u] = planPurchaseDocument([{ quantityBase: 6000n, entered: { kind: 'unitCostCents', cents: 150850 }, discountMilli: 12500 }], { pricesIncludeVat: false, vatRecoverable: true });
  assert.equal(u.lineNet, 7920);
  assert.throws(() => planPurchaseDocument([{ quantityBase: 1000n, entered: { kind: 'lineAmount', amount: 100 }, discountMilli: 100000 }], { pricesIncludeVat: false, vatRecoverable: true }));
});
