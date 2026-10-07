import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocNumber, buildDocumentKey, planPurchaseLine, derivedUnitCost, planPurchaseVoid, assertDocNumberRequired } from '../../src/domain/purchases/purchases.ts';
import { percentFee, planChargesAtClose, buildFinancial, planLateCharge, planVoidCharge, type FeeRuleDef } from '../../src/domain/charges/charges.ts';
import type { Actor } from '../../src/core/permissions/permissions.ts';
import { AppError } from '../../src/core/errors/index.ts';

const admin: Actor = { userId: 'a', role: 'ADMINISTRADOR', email: 'a@x.cl', branchId: 'b', banned: false };
const seller: Actor = { ...admin, userId: 's', role: 'VENDEDOR' };

test('O: normalización y clave de documento', () => {
  assert.equal(normalizeDocNumber('  00123 '), '123'); assert.equal(normalizeDocNumber('0'), '0'); assert.equal(normalizeDocNumber('  '), null);
  const k = (o: Partial<Parameters<typeof buildDocumentKey>[0]> = {}) => buildDocumentKey({ supplierId: 'p1', docType: 'FACTURA', docNumber: '123', status: 'CONFIRMED', ...o });
  assert.equal(k(), 'p1|FACTURA|123'); assert.equal(k({ docNumber: ' 0123' }), 'p1|FACTURA|123'); // mismo documento
  assert.equal(k({ supplierId: null }), '-|FACTURA|123');                                          // O2
  assert.notEqual(k({ docType: 'BOLETA' }), k()); assert.notEqual(k({ supplierId: 'p2' }), k());   // O3
  assert.equal(k({ status: 'VOIDED' }), null); assert.equal(k({ docNumber: null }), null);          // O4
  assert.throws(() => assertDocNumberRequired('FACTURA', ' ')); assert.doesNotThrow(() => assertDocNumberRequired('OTRO', null));
});
test('compra: 10 kg, neto $68.780 -> $6.878/kg; factura suma neto, boleta suma total', () => {
  const f = planPurchaseLine({ quantityBase: 10000n, pricesIncludeVat: false, vatRecoverable: true, entered: { kind: 'lineAmount', amount: 68780 } });
  assert.equal(f.costBasis, 68780); assert.equal(derivedUnitCost(f.costBasis, 10000n), '6878.00');
  assert.equal(f.lineVat, 13068); assert.equal(f.lineTotal, 81848);
  const b = planPurchaseLine({ quantityBase: 10000n, pricesIncludeVat: true, vatRecoverable: false, entered: { kind: 'lineAmount', amount: 81848 } });
  assert.equal(b.costBasis, 81848); assert.equal(b.lineNet + b.lineVat, b.lineTotal);
  const u = planPurchaseLine({ quantityBase: 10000n, pricesIncludeVat: false, vatRecoverable: true, entered: { kind: 'unitCost', amount: 5000 } });
  assert.equal(u.costBasis, 50000);
});
const st = (qty: bigint, value: number, seq: number) => ({ qty, value, seq });
test('J1: compra fue el último movimiento -> EXACT', () => {
  const p = planPurchaseVoid([{ productId: 'p', qtyPurchased: 10000n, costBasis: 50000, purchaseMovementSeq: 1, current: st(10000n, 50000, 1) }], { adjusted: false, reason: 'error' });
  assert.equal(p.status, 'ok'); if (p.status === 'ok') { assert.equal(p.mode, 'EXACT'); assert.deepEqual([p.items[0].qtyAfter, p.items[0].valueAfter, p.totalVariance], [0n, 0, 0]); }
});
test('J2: tras la venta C está bloqueada por defecto; ADJUSTED retira 33.333, varianza 16.667 -> 9,920 kg / 66.134', () => {
  const it = { productId: 'p', qtyPurchased: 5000n, costBasis: 50000, purchaseMovementSeq: 2, current: st(14920n, 99467, 3) };
  const blocked = planPurchaseVoid([it], { adjusted: false, reason: 'x' });
  assert.deepEqual(blocked, { status: 'blocked', reason: 'LATER_MOVEMENTS_REQUIRE_ADJUSTED', productId: 'p' });
  const ok = planPurchaseVoid([it], { adjusted: true, reason: 'x' });
  assert.equal(ok.status, 'ok'); if (ok.status === 'ok') { assert.equal(ok.mode, 'ADJUSTED'); const i = ok.items[0];
    assert.deepEqual([i.valueRemoved, i.variance, i.qtyAfter, i.valueAfter], [33333, 16667, 9920n, 66134]); }
});
test('J3: stock actual menor que lo comprado -> bloqueada aun con ADJUSTED', () => {
  const p = planPurchaseVoid([{ productId: 'p', qtyPurchased: 5000n, costBasis: 50000, purchaseMovementSeq: 2, current: st(3000n, 30000, 5) }], { adjusted: true, reason: 'x' });
  assert.deepEqual(p, { status: 'blocked', reason: 'STOCK_BELOW_PURCHASED', productId: 'p' });
});
test('anular compra exige motivo', () => assert.throws(() => planPurchaseVoid([], { adjusted: false, reason: ' ' })));

const rules: FeeRuleDef[] = [
  { id: 'r-debit', paymentMethodId: 'DEBIT', channelId: null, percentMilli: 1500, fixedAmount: 0, isManualPerSale: false, isActive: true },
  { id: 'r-card', paymentMethodId: 'CREDIT', channelId: null, percentMilli: 2500, fixedAmount: 0, isManualPerSale: false, isActive: true },
  { id: 'r-ml', paymentMethodId: null, channelId: 'ML', percentMilli: 12000, fixedAmount: 700, isManualPerSale: false, isActive: true },
  { id: 'r-rappi', paymentMethodId: null, channelId: 'RAPPI', percentMilli: 20000, fixedAmount: 0, isManualPerSale: true, isActive: true },
];
test('C: cargo débito 1,5% sobre $960 = $14', () => assert.equal(percentFee(960, 1500), 14));
test('P1: Mercado Libre pagada con tarjeta -> CHANNEL_COMMISSION + CHANNEL_FIXED_FEE + PAYMENT_FEE, se suman', () => {
  const c = planChargesAtClose({ total: 12000, channelId: 'ML', payments: [{ methodId: 'CREDIT', amount: 12000 }], rules });
  assert.deepEqual(c.map((x) => [x.type, x.amount]), [['PAYMENT_FEE', 300], ['CHANNEL_COMMISSION', 1440], ['CHANNEL_FIXED_FEE', 700]]);
});
test('regla manual por venta no genera cargo al cierre; inactiva tampoco', () => {
  assert.equal(planChargesAtClose({ total: 5000, channelId: 'RAPPI', payments: [{ methodId: 'CASH', amount: 5000 }], rules }).length, 0);
  assert.equal(planChargesAtClose({ total: 960, channelId: 'LOCAL', payments: [{ methodId: 'DEBIT', amount: 960 }], rules: rules.map((r) => ({ ...r, isActive: false })) }).length, 0);
});
test('L1: cargos posteriores 1.700 + 900 -> totalCharges 300 -> 2.900, realProfit 2.784 -> 184; gross y COGS intactos', () => {
  const f0 = buildFinancial(10084, 7000, [300]); assert.deepEqual([f0.grossProfit, f0.realProfit], [3084, 2784]);
  const p1 = planLateCharge(admin, 'COMPLETED', f0, { type: 'CHANNEL_COMMISSION', amount: 1700, reason: 'detalle ML' });
  const p2 = planLateCharge(admin, 'COMPLETED', p1.financialAfter, { type: 'SHIPPING_COST', amount: 900, reason: 'envío asumido' });
  const f = p2.financialAfter; assert.deepEqual([f.totalCharges, f.realProfit, f.grossProfit, f.costOfGoodsSold, f.netTotal], [2900, 184, 3084, 7000, 10084]);
  assert.deepEqual(p2.audit, { action: 'sale.charge_added', before: { totalCharges: 2000, realProfit: 1084 }, after: { totalCharges: 2900, realProfit: 184 } });
});
test('L2: VENDEDOR no puede agregar cargo posterior; L5: venta anulada no admite cargos', () => {
  const f = buildFinancial(1000, 500, []);
  assert.throws(() => planLateCharge(seller, 'COMPLETED', f, { type: 'OTHER', amount: 10, reason: 'x' }), (e: unknown) => e instanceof AppError && e.code === 'FORBIDDEN');
  assert.throws(() => planLateCharge(admin, 'VOIDED', f, { type: 'OTHER', amount: 10, reason: 'x' }), (e: unknown) => e instanceof AppError && e.code === 'BUSINESS_RULE');
  assert.throws(() => planLateCharge(admin, 'COMPLETED', f, { type: 'OTHER', amount: 10, reason: ' ' }));
  assert.throws(() => planLateCharge(admin, 'COMPLETED', f, { type: 'OTHER', amount: 0, reason: 'x' }));
});
test('L4: anular un cargo recalcula y audita; no se anula dos veces', () => {
  const f = buildFinancial(10084, 7000, [300, 1700]);
  const p = planVoidCharge(admin, 'COMPLETED', f, { amount: 1700, voided: false }, 'monto equivocado');
  assert.deepEqual([p.financialAfter.totalCharges, p.financialAfter.realProfit], [300, 2784]); assert.equal(p.audit.action, 'sale.charge_voided');
  assert.throws(() => planVoidCharge(admin, 'COMPLETED', f, { amount: 1700, voided: true }, 'x'));
  assert.throws(() => planVoidCharge(seller, 'COMPLETED', f, { amount: 1700, voided: false }, 'x'));
});
test('C: SaleFinancial congelado 807 / 533 / 274 / 14 / 260', () => {
  assert.deepEqual(buildFinancial(807, 533, [14]), { netTotal: 807, costOfGoodsSold: 533, grossProfit: 274, totalCharges: 14, realProfit: 260 });
});
test('F: servicio sin costo -> grossProfit 2.101', () => assert.equal(buildFinancial(2101, 0, []).grossProfit, 2101));
