import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1 } from '../helpers/world.ts';
import { statusOf, type HttpCall } from '../../src/integrations/tuu.ts';
import { createTuuService } from '../../src/services/tuu.service.ts';

test('tuu: estado de la solicitud (número o texto)', () => {
  assert.equal(statusOf({ status: 5 }), 'completed'); assert.equal(statusOf({ data: { status: 'Processing' } }), 'processing');
  assert.equal(statusOf({ Status: '4' }), 'failed'); assert.equal(statusOf({ status: 'Canceled' }), 'canceled'); assert.equal(statusOf({}), 'unknown');
});

test('tuu: conectar (admin), enviar cobro con comprobante de pago (dteType 48) y consultar', async () => {
  const { db } = world(); const sent: { url: string; body: any; key: string }[] = [];
  const call: HttpCall = async (url, init) => {
    sent.push({ url, body: init.body ? JSON.parse(init.body) : null, key: init.headers['X-API-Key'] });
    if (url.endsWith('/RemotePayment/v2/Create')) return { status: 201, text: async () => JSON.stringify({ status: 0 }) };
    if (url.includes('/GetPaymentRequest/')) return { status: 200, text: async () => JSON.stringify({ status: 5 }) };
    return { status: 404, text: async () => '{}' };
  };
  const svc = createTuuService({ uow: db.ports.uow, integrations: db.ports.integrations, call, secret: () => 's'.repeat(32) });
  await assert.rejects(svc.connect(s1, { apiKey: 'k'.repeat(20), device: 'ABC123', enabled: true }));
  await assert.rejects(svc.start(s1, { amount: 1000, method: 'DEBIT', key: 'er-abcdef123' }), /no está activado/);
  await svc.connect(admin, { apiKey: 'k'.repeat(20), device: 'ABC123', enabled: true });
  assert.deepEqual((await svc.status(s1)).enabled, true);
  await assert.rejects(svc.start(s1, { amount: 50, method: 'DEBIT', key: 'er-abcdef123' }), /desde \$100/);
  await svc.start(s1, { amount: 2890, method: 'CREDIT', key: 'er-abcdef123' });
  assert.equal(sent[0].key, 'k'.repeat(20)); assert.deepEqual([sent[0].body.amount, sent[0].body.device, sent[0].body.dteType, sent[0].body.paymentMethod, sent[0].body.idempotencyKey], [2890, 'ABC123', 48, 1, 'er-abcdef123']);
  assert.equal((await svc.check(s1, 'er-abcdef123')).status, 'completed');
  await svc.connect(admin, { device: 'ABC123', enabled: false }); assert.equal((await svc.status(s1)).enabled, false);
});
