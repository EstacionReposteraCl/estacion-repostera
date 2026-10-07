import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity, formatQuantity, convertToBase, hasValidDecimals, FACTOR_SCALE, type UnitDef } from '../../src/core/money/quantity.ts';
import { lineTotalPerBase, lineTotalPerPack, netFromGross, computeSaleTotals } from '../../src/core/money/iva.ts';
import { divRoundHalfUp } from '../../src/core/money/rounding.ts';

const G: UnitDef = { code: 'G', dimension: 'MASS', factorToBase: 1n * FACTOR_SCALE, maxDecimals: 0 };
const KG: UnitDef = { code: 'KG', dimension: 'MASS', factorToBase: 1000n * FACTOR_SCALE, maxDecimals: 3 };
const L: UnitDef = { code: 'L', dimension: 'VOLUME', factorToBase: 1000n * FACTOR_SCALE, maxDecimals: 3 };

test('parseQuantity / formatQuantity', () => {
  assert.equal(parseQuantity('0,080'), 80n);
  assert.equal(parseQuantity('1.5'), 1500n);
  assert.equal(parseQuantity('80'), 80000n);
  assert.equal(formatQuantity(80n), '0.080');
  assert.equal(formatQuantity(-1500n), '-1.500');
  for (const bad of ['', '-1', '1.2345', 'abc', '1,2,3']) assert.throws(() => parseQuantity(bad));
});
test('Sprinkles: 80 g -> 0,080 KG -> $1.280 a $16.000/kg', () => {
  const qty = convertToBase(80n * 1000n /* 80 g en milésimas de g */, G, KG);
  assert.equal(qty, 80n);
  assert.equal(lineTotalPerBase(qty, 16000), 1280);
});
test('conversión de distinta dimensión falla', () => assert.throws(() => convertToBase(1000n, G, L)));
test('decimales permitidos por unidad', () => {
  assert.equal(hasValidDecimals(1500n, 0), false); // 1,5 UN
  assert.equal(hasValidDecimals(2000n, 0), true);
  assert.equal(hasValidDecimals(80n, 3), true);
  assert.equal(hasValidDecimals(85n, 2), false);
});
test('redondeo mitad hacia arriba', () => {
  assert.equal(divRoundHalfUp(5n, 2n), 3n); assert.equal(divRoundHalfUp(4n, 3n), 1n); assert.equal(divRoundHalfUp(1n, 2n), 1n);
});
test('C: 0,080 kg a $12.000/kg = 960; neto 807, IVA 153', () => {
  const total = lineTotalPerBase(80n, 12000); assert.equal(total, 960);
  const t = computeSaleTotals([{ total, taxable: true }]);
  assert.deepEqual([t.net, t.vat], [807, 153]);
});
test('F: Envío $2.500 -> neto 2.101, IVA 399', () => {
  const t = computeSaleTotals([{ total: 2500, taxable: true }]); assert.deepEqual([t.net, t.vat], [2101, 399]);
});
test('G: 2 bolsas de 500 g a $16.000/kg proporcional $8.000 -> total 16.000, neto 13.445, IVA 2.555', () => {
  const pack = lineTotalPerBase(500n, 16000); assert.equal(pack, 8000);
  const total = lineTotalPerPack(2000n, 8000); assert.equal(total, 16000);
  const t = computeSaleTotals([{ total, taxable: true }]); assert.deepEqual([t.net, t.vat], [13445, 2555]);
});
test('H (núcleo): presentaciones no enteras se rechazan', () => {
  assert.throws(() => lineTotalPerPack(1500n, 8000)); assert.throws(() => lineTotalPerPack(2300n, 8000));
});
test('M1: 3 líneas de $1.000 -> neto 2.521, IVA 479, líneas 841+840+840', () => {
  const t = computeSaleTotals([1000, 1000, 1000].map((total) => ({ total, taxable: true })));
  assert.deepEqual([t.total, t.net, t.vat], [3000, 2521, 479]);
  assert.deepEqual(t.lines.map((l) => l.net), [841, 840, 840]);
});
test('M3: mezcla afecto y exento; el exento suma íntegro con IVA 0', () => {
  const t = computeSaleTotals([{ total: 1190, taxable: true }, { total: 500, taxable: false }]);
  assert.deepEqual([t.total, t.net, t.vat], [1690, 1500, 190]);
  assert.deepEqual(t.lines[1], { total: 500, net: 500, vat: 0 });
});
test('M2: propiedad con 200.000 ventas pseudoaleatorias (semilla fija)', () => {
  let s = 123456789; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let k = 0; k < 200000; k++) {
    const n = 1 + Math.floor(rnd() * 12);
    const lines = Array.from({ length: n }, () => ({ total: 1 + Math.floor(rnd() * 200000), taxable: rnd() > 0.15 }));
    const t = computeSaleTotals(lines);
    assert.equal(t.lines.reduce((a, l) => a + l.total, 0), t.total);
    assert.equal(t.lines.reduce((a, l) => a + l.net, 0), t.net);
    assert.equal(t.lines.reduce((a, l) => a + l.vat, 0), t.vat);
    assert.equal(t.net + t.vat, t.total);
    const taxable = lines.filter((l) => l.taxable).reduce((a, l) => a + l.total, 0);
    const exempt = lines.filter((l) => !l.taxable).reduce((a, l) => a + l.total, 0);
    assert.equal(t.net, netFromGross(taxable) + exempt);
    t.lines.forEach((l, i) => {
      assert.equal(l.net + l.vat, l.total);
      const own = lines[i].taxable ? netFromGross(lines[i].total) : lines[i].total;
      assert.ok(Math.abs(l.net - own) <= 1, `línea difiere más de $1 (${l.net} vs ${own})`);
    });
  }
});
test('decimalToMilli convierte Decimal vía texto exacto', async () => {
  const { decimalToMilli } = await import('../../src/core/money/quantity.ts');
  assert.equal(decimalToMilli({ toFixed: (n: number) => (0.08).toFixed(n) }), 80n); assert.equal(decimalToMilli('14.920'), 14920n);
});
