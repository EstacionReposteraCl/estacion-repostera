import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, sale, code, fact } from '../helpers/world.ts';
import { roundUp90, channelUnitPrice, parseChannelPriceLists } from '../../src/domain/sales/channel-prices.ts';

test('precios por canal: redondeo a ..90, lista, recargo y sin lista', () => {
  assert.deepEqual([roundUp90(1355), roundUp90(1390), roundUp90(1391), roundUp90(10050), roundUp90(7738)], [1390, 1390, 1490, 10090, 7790]);
  const l = { prices: { a: 3990 }, factor: 1.36 };
  assert.equal(channelUnitPrice(l, 'a', 2890), 3990);           // de la lista de la app
  assert.equal(channelUnitPrice(l, 'b', 5490), 7490);           // tienda × 1,36 → ..90
  assert.equal(channelUnitPrice({ prices: {}, factor: null }, 'b', 5490), 5490);
  assert.equal(channelUnitPrice(undefined, 'b', 5490), 5490);
  assert.deepEqual(parseChannelPriceLists({ lists: { UBER: { prices: { a: 100, b: -1, c: 'x' }, factor: 9 }, 'bad code': {} } }), { UBER: { prices: { a: 100 }, factor: null, source: null, updatedAt: null } });
});

test('venta Uber: el vendedor cobra el precio de la app sin "precio manual"; tienda sigue igual', async () => {
  const { db, svc } = world();
  db.channels.set('UBER', { id: 'UBER', isActive: true });
  await svc.purchases.register(admin, fact('1', [{ productId: 'az', quantity: '10', lineAmount: 50000 }]));
  assert.equal(await code(svc.sales.setChannelPriceList(s1, 'UBER', { prices: { az: 16990 }, factor: 1.36 })), 'FORBIDDEN');
  await svc.sales.setChannelPriceList(admin, 'UBER', { prices: { az: 16990 }, factor: 1.36, source: 'test' });
  const o = await svc.sales.posOptions(s1); assert.equal(o.channelPrices.UBER.prices.az, 16990);
  const u = await svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '1' }], 16990, 'U1', 'DEBIT', 'UBER'));
  assert.equal(u.total, 16990);
  const t = await svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '1' }], 12000, 'T1', 'DEBIT', 'LOCAL'));
  assert.equal(t.total, 12000);
  assert.equal(await code(svc.sales.closeSale(s1, sale([{ productId: 'az', quantity: '1' }], 12000, 'U2', 'DEBIT', 'UBER'))), 'VALIDATION');   // con precio de tienda no cuadra
});
