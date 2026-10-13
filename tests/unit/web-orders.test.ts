import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1 } from '../helpers/world.ts';
import { parseWebOrder, paymentFor, priceLines, orderBusinessDate, shippingSkuFor } from '../../src/domain/web-orders/web-orders.ts';
import { createWebOrdersService, type HttpPost } from '../../src/services/web-orders.service.ts';
import { createServices } from '../../src/services/composition.ts';
import { seal } from '../../src/core/crypto/secret-box.ts';
import type { HttpGet } from '../../src/integrations/jumpseller.ts';

const SECRET = 's'.repeat(32);
const ord = (id: number, extra: Record<string, unknown> = {}) => ({ order: { id, status: 'Paid', created_at: '2026-10-13 15:43:30 UTC', total: 14672, subtotal: 12000, shipping: 2672, discount: 0,
  payment_method_name: 'PAGO ONLINE', shipping_method_name: '🚀 Envío Express – PedidosYa', customer: { fullname: 'Ana Pérez' },
  products: [{ name: 'Azúcar 1 kg', sku: 'AZ-1', qty: 1, price: 12000, discount: 0 }], ...extra } });

test('pedido web: lectura, medio de pago, envío, fecha de Chile y reparto de descuentos', () => {
  const o = parseWebOrder(ord(1019));
  assert.deepEqual([o.id, o.status, o.total, o.shipping, o.customer, o.lines[0].lineTotal], [1019, 'Paid', 14672, 2672, 'Ana Pérez', 12000]);
  assert.equal(orderBusinessDate('2026-10-13 02:10:00 UTC'), '2026-10-12');            // 23:10 del 12 en Chile
  assert.equal(paymentFor('PAGO ONLINE'), 'DEBIT'); assert.equal(paymentFor('Mercado Pago (crédito, débito, prepago, transferencia)'), 'MERCADO_PAGO');
  assert.equal(paymentFor('Mercadolibre'), 'ML'); assert.equal(paymentFor('Transferencia bancaria'), 'TRANSFER'); assert.equal(paymentFor('Contra entrega'), null);
  assert.equal(shippingSkuFor('🚀 Envío Express – PedidosYa'), 'WB-ENVIO'); assert.equal(shippingSkuFor('Estándar a domicilio'), 'ENV-PRO-PIO');
  assert.deepEqual(priceLines(o), [{ index: 0, qty: 1, unitPrice: 12000 }]);
  const d = parseWebOrder(ord(1, { total: 10672, products: [{ name: 'A', sku: 'A', qty: 1, price: 6000 }, { name: 'B', sku: 'B', qty: 2, price: 3000 }] }));   // cupón de $2.000
  const p = priceLines(d)!; assert.equal(p.reduce((a, l) => a + l.qty * l.unitPrice, 0), 8000);
});

function setup() {
  const w = world(); const { db } = w; db.clock = new Date('2026-10-13T16:00:00Z');
  db.channels.set('PAGINA_WEB', { id: 'PAGINA_WEB', isActive: true }); db.methods.set('MERCADO_PAGO', { id: 'MERCADO_PAGO', isActive: true });
  db.products.set('wbenv', { sku: 'WB-ENVIO', isActive: true, vatTreatment: 'AFECTO', id: 'wbenv', name: 'Envío PedidosYA', kind: 'SERVICE', salePrice: 0, unit: db.units.get('UN')!, presentations: [] });
  db.setStock('main', 'az', 10000n, 80000, 1);
  const orders = new Map<number, unknown>([[1019, ord(1019)], [1020, ord(1020, { total: 3000, shipping: 0, products: [{ name: 'Base de cartón redonda (Color: Blanco)', sku: '', qty: 1, price: 3000 }] })],
    [1021, ord(1021, { status: 'Canceled' })], [1016, ord(1016, { payment_method_name: 'Mercadolibre' })], [1010, ord(1010, { created_at: '2026-10-01 12:00:00 UTC' })]]);
  const get: HttpGet = async (url) => {
    const u = new URL(url); if (u.searchParams.get('authtoken') !== 'tok-123456') return { status: 401, json: async () => ({}) };
    const path = u.pathname.replace('/v1', '');
    if (path === '/orders/count.json') return { status: 200, json: async () => ({ count: orders.size }) };
    if (path === '/orders.json') return { status: 200, json: async () => [...orders.values()] };
    if (path === '/hooks.json') return { status: 200, json: async () => [] };
    const m = path.match(/^\/orders\/(\d+)\.json$/); if (m && orders.has(Number(m[1]))) return { status: 200, json: async () => orders.get(Number(m[1])) };
    return { status: 404, json: async () => ({}) };
  };
  const posts: { url: string; body: string }[] = [];
  const post: HttpPost = async (url, _h, body) => { posts.push({ url, body }); return { status: 201, text: async () => JSON.stringify({ hook: { id: 99, event: 'order_paid' } }) }; };
  const svc = createServices(db.ports, { actorFor: async (id) => (id === admin.userId ? admin : null) });
  const web = createWebOrdersService({ uow: db.ports.uow, integrations: db.ports.integrations, catalog: db.ports.catalog, now: db.now, sales: svc.sales, products: svc.products,
    actorFor: async (id) => (id === admin.userId ? admin : null), get, post, secret: () => SECRET });
  return { ...w, svc, web, orders, posts };
}

test('ventas web: al activar se crea el aviso en Jumpseller; los pedidos pagados se registran solos y lo que no calza queda por revisar', async () => {
  const { db, svc, web, posts } = setup();
  await assert.rejects(web.enable(admin, { since: '2026-10-13', baseUrl: 'https://sistema.x.cl' }), /Falta conectar Jumpseller/);
  await db.ports.uow.run((tx) => tx.audit.write({ action: 'integration.set', entity: 'jumpseller', entityId: 'jumpseller', userId: admin.userId, after: { login: 'tienda', tokenBox: seal('tok-123456', SECRET, 'integration:jumpseller') } }));
  await assert.rejects(web.enable(s1, { since: '2026-10-13', baseUrl: 'https://sistema.x.cl' }), /permiso|autoriz|forbidden/i);
  const en = await web.enable(admin, { since: '2026-10-13', baseUrl: 'https://sistema.x.cl' });
  assert.equal(en.hookOk, true); assert.match(JSON.parse(posts[0].body).hook.url, /^https:\/\/sistema\.x\.cl\/api\/jumpseller\/pedido-pagado\?k=/);
  assert.equal(JSON.parse(posts[0].body).hook.event, 'order_paid');

  const r = await web.sync(true); assert.deepEqual(r, { done: 1, pending: 1 });
  const st = await web.status(admin);
  const done = st.recent.find((e) => e.orderId === 1019)!; assert.equal(done.state, 'DONE');
  const sale = db.sales.get(done.saleId!)!.sale;
  assert.deepEqual([sale.channelId, sale.externalRef, sale.total], ['PAGINA_WEB', '#1019', 14672]);
  assert.equal(db.sales.get(done.saleId!)!.payments[0].methodId, 'DEBIT');
  assert.equal(st.recent.find((e) => e.orderId === 1016)!.state, 'SKIPPED');                 // Mercado Libre
  assert.ok(!st.recent.some((e) => e.orderId === 1021 || e.orderId === 1010));            // anulado / anterior a la fecha de inicio
  assert.equal(st.pending.length, 1); assert.match(st.pending[0].reason!, /No encontré en el sistema: Base de cartón redonda/);

  const before = db.sales.size; await web.sync(true); assert.equal(db.sales.size, before, 'no duplica ventas');
  void svc;
});

test('ventas web: revisión manual (elegir producto), ignorar, y aviso de Jumpseller solo con la clave correcta', async () => {
  const { db, web, orders } = setup();
  await db.ports.uow.run((tx) => tx.audit.write({ action: 'integration.set', entity: 'jumpseller', entityId: 'jumpseller', userId: admin.userId, after: { login: 'tienda', tokenBox: seal('tok-123456', SECRET, 'integration:jumpseller') } }));
  const { url } = await web.enable(admin, { since: '2026-10-13', baseUrl: 'https://sistema.x.cl' });
  await web.sync(true);
  await assert.rejects(web.resolve(s1, 1020, { productIds: ['az'], payment: 'DEBIT' }), /permiso|autoriz|forbidden/i);
  const ok = await web.resolve(admin, 1020, { productIds: ['az'], payment: 'DEBIT' });
  assert.equal(ok.state, 'DONE'); assert.equal(db.sales.get(ok.saleId!)!.sale.total, 3000);
  await assert.rejects(web.ignore(admin, 1020, 'no va'), /ya tiene venta/);
  await assert.rejects(web.resolve(admin, 1020, { productIds: ['az'], payment: 'DEBIT' }), /ya está registrado/);

  orders.set(1022, ord(1022, { total: 12000, shipping: 0 }));
  assert.equal(await web.webhook('clave-falsa', 1022), null);
  const key = new URL(url).searchParams.get('k')!;
  const e = await web.webhook(key, 1022); assert.equal(e?.state, 'DONE');
  assert.equal((await web.webhook(key, 1022))?.saleId, e?.saleId, 'el aviso repetido no crea otra venta');

  orders.set(1023, ord(1023, { total: 2000, shipping: 0, products: [{ name: 'Algo raro', sku: 'NOPE', qty: 1, price: 2000 }] }));
  await web.webhook(key, 1023);
  await assert.rejects(web.ignore(admin, 1023, ''), /motivo/);
  await web.ignore(admin, 1023, 'pedido de prueba');
  assert.equal((await web.status(admin)).recent.find((x) => x.orderId === 1023)?.state, 'IGNORED');
});
