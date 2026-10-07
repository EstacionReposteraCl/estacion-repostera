import { FakeDb } from './fake-db.ts';
import { createServices } from '../../src/services/composition.ts';
import { FACTOR_SCALE, type UnitDef } from '../../src/core/money/quantity.ts';
import type { Actor } from '../../src/core/permissions/permissions.ts';
import { AppError } from '../../src/core/errors/index.ts';

export const B = 'main';
export const U = (code: string, dim: UnitDef['dimension'], f: bigint, d: number): UnitDef => ({ code, dimension: dim, factorToBase: f * FACTOR_SCALE, maxDecimals: d });
export const admin: Actor = { userId: 'adm', role: 'ADMINISTRADOR', email: 'a@x.cl', branchId: B, banned: false };
export const admin2: Actor = { ...admin, userId: 'adm2', email: 'a2@x.cl' };
export const s1: Actor = { userId: 's1', role: 'VENDEDOR', email: 's1@x.cl', branchId: B, banned: false };
export const s2: Actor = { ...s1, userId: 's2', email: 's2@x.cl' };

export function world() {
  const db = new FakeDb();
  db.units = new Map([['UN', U('UN', 'COUNT', 1n, 0)], ['G', U('G', 'MASS', 1n, 0)], ['KG', U('KG', 'MASS', 1000n, 3)]]);
  const base = { sku: 'x', isActive: true, vatTreatment: 'AFECTO' as const };
  db.products.set('az', { ...base, sku: 'AZ-1', id: 'az', name: 'Azúcar', kind: 'GOODS', salePrice: 12000, unit: db.units.get('KG')!, presentations: [{ id: 'b500', name: 'Bolsa 500 g', baseQuantity: 500n, salePrice: null, isActive: true }] });
  db.products.set('envio', { ...base, sku: 'ENV', id: 'envio', name: 'Envío', kind: 'SERVICE', salePrice: 2500, unit: db.units.get('UN')!, presentations: [] });
  db.prodRows.set('az', { id: 'az', sku: 'AZ-1', name: 'Azúcar', kind: 'GOODS', unitCode: 'KG', salePrice: 12000, isActive: true });
  db.rules = [{ id: 'r1', paymentMethodId: 'DEBIT', channelId: null, percentMilli: 1500, fixedAmount: 0, isManualPerSale: false, isActive: true }];
  for (const u of [admin, admin2]) db.users.set(u.userId, { id: u.userId, email: u.email, role: 'ADMINISTRADOR', banned: false });
  for (const u of [s1, s2]) db.users.set(u.userId, { id: u.userId, email: u.email, role: 'VENDEDOR', banned: false });
  return { db, svc: createServices(db.ports) };
}
export const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e instanceof AppError ? e.code : 'OTHER:' + (e as Error).message; } return 'NONE'; };
export const sale = (lines: any[], total: number, key: string, method = 'DEBIT', channelId = 'LOCAL'): { lines: any[]; channelId: string; payments: { methodId: string; amount: number }[]; idempotencyKey: string; note?: string; externalRef?: string } => ({ lines, channelId, payments: [{ methodId: method, amount: total }], idempotencyKey: key });
export const fact = (n: string, lines: any[], extra: Record<string, unknown> = {}) => ({ supplierId: 'sup1', docType: 'FACTURA' as const, docNumber: n, docDate: '2026-10-01', pricesIncludeVat: false, lines, ...extra });
