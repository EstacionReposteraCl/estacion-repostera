import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from '../../prisma/seed-data.ts';
const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const enumVals = (n: string) => [...schema.match(new RegExp(`enum ${n} \\{([^}]*)\\}`))![1].matchAll(/^\s*(\w+)/gm)].map((m) => m[1]);
test('seed: unidades coherentes con el enum UnitDimension del schema', () => {
  const dims = enumVals('UnitDimension'); for (const u of S.SEED_UNITS) assert.ok(dims.includes(u.dimension), u.code);
  assert.deepEqual(S.SEED_UNITS.map((u) => u.code), ['UN', 'G', 'KG', 'ML', 'L']);
  assert.equal(S.SEED_UNITS.find((u) => u.code === 'KG')!.factorToBase, '1000');
});
test('seed: canales, medios de pago e IVA según lo aprobado', () => {
  assert.deepEqual(S.SEED_CHANNELS.map((c) => c.code), ['LOCAL', 'WHATSAPP', 'INSTAGRAM', 'MERCADO_LIBRE', 'RAPPI']);
  assert.deepEqual(S.SEED_PAYMENT_METHODS.map((c) => c.name), ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago']);
  assert.equal(S.SEED_SETTINGS.vatRate, '19.00'); assert.equal(S.SEED_SETTINGS.taxId, '78.485.985-1'); assert.equal(S.SEED_SETTINGS.legalName, 'OVELIX SPA');
  assert.equal(S.SEED_BRANCH.isMain, true);
});
test('seed: no inventa comisiones (porcentaje 0, IVA UNDEFINED) y los destinos existen', () => {
  assert.equal(S.SEED_FEE_RULES.defaults.percent, '0'); assert.equal(S.SEED_FEE_RULES.defaults.vatTreatment, 'UNDEFINED');
  assert.ok(enumVals('FeeVatTreatment').includes(S.SEED_FEE_RULES.defaults.vatTreatment));
  for (const c of S.SEED_FEE_RULES.channels) assert.ok(S.SEED_CHANNELS.some((x) => x.code === c));
  for (const m of S.SEED_FEE_RULES.paymentMethods) assert.ok(S.SEED_PAYMENT_METHODS.some((x) => x.code === m));
  assert.ok(enumVals('SequenceType').includes(S.SEED_SEQUENCE.type));
});
test('seed demo: SERVICE sin apertura; GOODS con apertura; códigos únicos', () => {
  for (const p of S.SEED_DEMO_PRODUCTS) assert.equal('opening' in p, p.kind === 'GOODS');
  assert.equal(new Set(S.SEED_DEMO_PRODUCTS.map((p) => p.sku)).size, S.SEED_DEMO_PRODUCTS.length);
  assert.ok(enumVals('ProductKind').includes('SERVICE'));
});
test('seed plan: saldos iniciales por el planificador de inventario (valor entero, seq 1)', async () => {
  const { planOpeningBalances } = await import('../../prisma/seed-plan.ts');
  assert.deepEqual(planOpeningBalances(), [{ sku: 'AZU-001', qty: '10.000', valueAfter: 25000, seq: 1, valueChange: 25000 }, { sku: 'SPR-001', qty: '2.000', valueAfter: 18000, seq: 1, valueChange: 18000 }]);
});
