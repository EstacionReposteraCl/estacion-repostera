import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1 } from '../helpers/world.ts';
import { toLabel, jumpsellerClient, type HttpGet } from '../../src/integrations/jumpseller.ts';
import { createShippingService } from '../../src/services/shipping.service.ts';
import { seal, open } from '../../src/core/crypto/secret-box.ts';

const ORDER = { order: { id: 1017, created_at: '2026-10-10T20:13:00.000Z', status: 'Paid', shipping_method_name: 'Envío Express – PedidosYa', payment_method_name: 'Pago online', total: 12345.0,
  customer: { email: 'isi@example.com', phone: '+56 9 1111 2222' },
  shipping_address: { name: 'Isidora', surname: 'Werner', address: 'Marchant Pereira 1778', complement: 'Depto 501', municipality: 'Providencia', city: 'Santiago', region: 'Región Metropolitana' },
  products: [{ name: 'Tamizador de harina', sku: 'SKU244', qty: 1 }, { name: 'Sprinkles 80 g', sku: 'SKU382', qty: 2 }],
  additional_information: [{ label: 'Comentario', value: 'Dejar en conserjería' }] } };

test('jumpseller: el pedido se convierte en etiqueta (nombre, dirección, comuna, teléfono, productos, nota) y tolera campos faltantes', () => {
  const l = toLabel(ORDER);
  assert.equal(l.id, 1017); assert.equal(l.name, 'Isidora Werner'); assert.equal(l.address, 'Marchant Pereira 1778'); assert.equal(l.complement, 'Depto 501');
  assert.equal(l.municipality, 'Providencia'); assert.equal(l.phone, '+56 9 1111 2222'); assert.equal(l.shippingMethod, 'Envío Express – PedidosYa');
  assert.deepEqual(l.products.map((p) => [p.qty, p.name]), [[1, 'Tamizador de harina'], [2, 'Sprinkles 80 g']]); assert.equal(l.notes, 'Comentario: Dejar en conserjería');
  const empty = toLabel({}); assert.equal(empty.id, 0); assert.equal(empty.name, ''); assert.deepEqual(empty.products, []);
});

const fakeGet = (pages: Record<string, unknown>, calls: string[] = []): HttpGet => async (url) => {
  calls.push(url); const u = new URL(url); const key = u.pathname.replace('/v1', '') + (u.searchParams.get('page') ? '?page=' + u.searchParams.get('page') : '');
  if (u.searchParams.get('authtoken') !== 'tok-123456') return { status: 401, json: async () => ({}) };
  if (!(key in pages)) return { status: 404, json: async () => ({}) };
  return { status: 200, json: async () => pages[key] };
};

test('jumpseller: últimos pedidos leen primera y última página (sirve si la API ordena ascendente o descendente)', async () => {
  const mk = (id: number) => ({ order: { ...ORDER.order, id } });
  const pages = { '/orders/count.json': { count: 120 }, '/orders.json?page=1': [mk(1), mk(2)], '/orders.json?page=3': [mk(119), mk(120)] };
  const calls: string[] = [];
  const rows = await jumpsellerClient({ login: 'tienda', token: 'tok-123456' }, fakeGet(pages, calls)).recent(3);
  assert.deepEqual(rows.map((r) => r.id), [120, 119, 2]);
  assert.ok(calls.every((c) => c.startsWith('https://api.jumpseller.com/v1/')));
});

test('secret-box: cifra y descifra; con otro secreto o propósito no se puede leer', () => {
  const box = seal('tok-123456', 'x'.repeat(32), 'p'); assert.ok(!box.includes('tok-123456'));
  assert.equal(open(box, 'x'.repeat(32), 'p'), 'tok-123456'); assert.equal(open(box, 'y'.repeat(32), 'p'), null); assert.equal(open(box, 'x'.repeat(32), 'q'), null);
});

test('servicio de etiquetas: solo el administrador conecta (credenciales comprobadas y token cifrado); ambos roles imprimen', async () => {
  const { db } = world();
  const pages = { '/orders/count.json': { count: 1 }, '/orders.json?page=1': [ORDER], '/orders/1017.json': ORDER };
  const svc = createShippingService({ uow: db.ports.uow, integrations: db.ports.integrations, get: fakeGet(pages), secret: () => 's'.repeat(32) });
  assert.equal((await svc.status(s1)).configured, false);
  await assert.rejects(svc.order(s1, 1017), /Falta conectar Jumpseller/);
  await assert.rejects(svc.connect(s1, { login: 'tienda', token: 'tok-123456' }), /permiso|autoriz|forbidden/i);
  await assert.rejects(svc.connect(admin, { login: 'tienda', token: 'malo-123456' }), /rechazó las credenciales/);
  await svc.connect(admin, { login: 'tienda', token: 'tok-123456' });
  const saved = db.audit.at(-1)!; assert.equal(saved.action, 'integration.set'); assert.ok(!JSON.stringify(saved.after).includes('tok-123456'));
  const st = await svc.status(s1); assert.equal(st.configured, true); assert.equal(st.canConfigure, false);
  assert.equal((await svc.order(s1, 1017)).name, 'Isidora Werner');
  await assert.rejects(svc.order(s1, 9999), /No existe ese pedido/);
  await assert.rejects(svc.order(s1, -1), /inválido/);
  assert.deepEqual((await svc.recent(admin)).map((r) => r.id), [1017]);
});

test('etiqueta: teléfono desde el cliente (con prefijo) o, si no, desde un campo adicional del checkout', () => {
  assert.equal(toLabel({ order: { customer: { phone: '912345678', phone_prefix: '56' } } }).phone, '+56 912345678');
  assert.equal(toLabel({ order: { customer: { phone: null }, additional_fields: [{ label: 'accepts_marketing', value: 'No' }, { label: 'Teléfono', value: '+56 9 8765 4321' }] } }).phone, '+56 9 8765 4321');
  assert.equal(toLabel({ order: { customer: { phone: null }, additional_fields: [{ label: 'accepts_marketing', value: 'No' }] } }).phone, '');
});
