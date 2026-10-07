import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSale, type CatalogProduct, type PlanContext } from '../../src/domain/sales/sale-plan.ts';
import { FACTOR_SCALE, type UnitDef } from '../../src/core/money/quantity.ts';
import type { Actor } from '../../src/core/permissions/permissions.ts';
import { AppError } from '../../src/core/errors/index.ts';

const U = (code: string, dim: UnitDef['dimension'], f: bigint, d: number): UnitDef => ({ code, dimension: dim, factorToBase: f * FACTOR_SCALE, maxDecimals: d });
const units = new Map([['UN', U('UN', 'COUNT', 1n, 0)], ['G', U('G', 'MASS', 1n, 0)], ['KG', U('KG', 'MASS', 1000n, 3)]]);
const seller: Actor = { userId: 's', role: 'VENDEDOR', email: 's@x.cl', branchId: 'b', banned: false };
const admin: Actor = { ...seller, userId: 'a', role: 'ADMINISTRADOR' };
const prod = (o: Partial<CatalogProduct> & { id: string }): CatalogProduct => ({ sku: o.id, name: o.id, kind: 'GOODS', isActive: true, vatTreatment: 'AFECTO', salePrice: 12000, unit: units.get('KG')!, presentations: [], ...o });
const catalog = new Map<string, CatalogProduct>([
  ['harina', prod({ id: 'harina' })],
  ['sprinkles', prod({ id: 'sprinkles', salePrice: 16000, presentations: [{ id: 'b500', name: 'Bolsa 500 g', baseQuantity: 500n, salePrice: null, isActive: true }] })],
  ['envio', prod({ id: 'envio', kind: 'SERVICE', salePrice: 2500, unit: units.get('UN')! })],
  ['viejo', prod({ id: 'viejo', isActive: false })],
  ['exento', prod({ id: 'exento', vatTreatment: 'EXENTO', salePrice: 1000, unit: units.get('UN')! })],
  ['clavo', prod({ id: 'clavo', salePrice: 1000, unit: units.get('UN')! })],
]);
const ctx = (actor: Actor = seller): PlanContext => ({ actor, products: catalog, units });
const pay = (amount: number) => [{ methodId: 'DEBIT', amount }];
const sale = (lines: any[], total: number) => ({ lines, channelId: 'LOCAL', payments: pay(total), idempotencyKey: 'k1' });
const code = (f: () => unknown) => { try { f(); } catch (e) { return e instanceof AppError ? e.code : 'OTHER'; } return 'NONE'; };

test('C: 0,080 kg a $12.000/kg -> 960, neto 807, IVA 153, demanda 80 milésimas', () => {
  const p = planSale(sale([{ productId: 'harina', quantity: '0,080' }], 960), ctx());
  assert.deepEqual([p.total, p.net, p.vat], [960, 807, 153]); assert.equal(p.stockDemand.get('harina'), 80n);
});
test('Sprinkles 80 g a $16.000/kg -> 1.280 (conversión g -> kg)', () => {
  const p = planSale(sale([{ productId: 'sprinkles', quantity: '80', unitCode: 'G' }], 1280), ctx());
  assert.equal(p.lines[0].quantity, 80n); assert.equal(p.total, 1280); assert.equal(p.lines[0].enteredUnit, 'G');
});
test('G: 2 bolsas de 500 g -> total 16.000, neto 13.445, IVA 2.555, descuenta 1,000 kg', () => {
  const p = planSale(sale([{ productId: 'sprinkles', presentationId: 'b500', quantity: '2' }], 16000), ctx());
  assert.deepEqual([p.total, p.net, p.vat], [16000, 13445, 2555]); assert.equal(p.stockDemand.get('sprinkles'), 1000n);
  assert.equal(p.lines[0].priceBasis, 'PER_PRESENTATION');
});
test('H: 1,5 y 2,3 bolsas se rechazan; presentación de otro producto se rechaza (H2)', () => {
  assert.equal(code(() => planSale(sale([{ productId: 'sprinkles', presentationId: 'b500', quantity: '1,5' }], 12000), ctx())), 'VALIDATION');
  assert.equal(code(() => planSale(sale([{ productId: 'sprinkles', presentationId: 'b500', quantity: '2.3' }], 12000), ctx())), 'VALIDATION');
  assert.equal(code(() => planSale(sale([{ productId: 'harina', presentationId: 'b500', quantity: '1' }], 1), ctx())), 'VALIDATION');
});
test('F/N3: servicio Envío sin demanda de stock; neto 2.101', () => {
  const p = planSale(sale([{ productId: 'envio', quantity: '1' }], 2500), ctx());
  assert.equal(p.stockDemand.size, 0); assert.deepEqual([p.net, p.vat], [2101, 399]);
});
test('N1/N2: venta sin líneas, producto inexistente o inactivo -> rechazada', () => {
  assert.equal(code(() => planSale(sale([], 0), ctx())), 'VALIDATION');
  assert.equal(code(() => planSale(sale([{ productId: 'fantasma', quantity: '1' }], 1), ctx())), 'VALIDATION');
  assert.equal(code(() => planSale(sale([{ productId: 'viejo', quantity: '1' }], 12000), ctx())), 'BUSINESS_RULE');
});
test('vendedor: no puede enviar precio ni descuento; ADMIN sí puede precio manual', () => {
  assert.equal(code(() => planSale(sale([{ productId: 'harina', quantity: '1', manualUnitPrice: 1 }], 1), ctx())), 'FORBIDDEN');
  assert.equal(code(() => planSale(sale([{ productId: 'harina', quantity: '1', discount: 10 }], 1), ctx())), 'FORBIDDEN');
  const p = planSale(sale([{ productId: 'harina', quantity: '1', manualUnitPrice: 10000 }], 10000), ctx(admin));
  assert.equal(p.lines[0].isManualPrice, true);
});
test('decimales por unidad: 1,5 UN rechazado; M1 tres líneas de $1.000 -> 2.521', () => {
  assert.equal(code(() => planSale(sale([{ productId: 'clavo', quantity: '1,5' }], 1500), ctx())), 'VALIDATION');
  const p = planSale(sale([1, 2, 3].map(() => ({ productId: 'clavo', quantity: '1' })), 3000), ctx());
  assert.deepEqual([p.net, p.vat, p.lines.map((l) => l.lineNet)], [2521, 479, [841, 840, 840]]);
});
test('M3: exento y afecto', () => {
  const p = planSale(sale([{ productId: 'clavo', quantity: '1' }, { productId: 'exento', quantity: '1' }], 2000), ctx());
  assert.deepEqual([p.total, p.net, p.vat], [2000, 1840, 160]); assert.equal(p.lines[1].vatRate, 0);
});
test('pagos deben cuadrar con el total; sin pago se rechaza; idempotencyKey obligatoria', () => {
  assert.equal(code(() => planSale(sale([{ productId: 'harina', quantity: '0,080' }], 961), ctx())), 'VALIDATION');
  assert.equal(code(() => planSale({ ...sale([{ productId: 'harina', quantity: '0,080' }], 960), payments: [] }, ctx())), 'VALIDATION');
  assert.equal(code(() => planSale({ ...sale([{ productId: 'harina', quantity: '0,080' }], 960), idempotencyKey: ' ' }, ctx())), 'VALIDATION');
});
test('demanda de stock agrega líneas repetidas del mismo producto', () => {
  const p = planSale(sale([{ productId: 'harina', quantity: '1' }, { productId: 'harina', quantity: '0,5' }], 18000), ctx());
  assert.equal(p.stockDemand.get('harina'), 1500n);
});
