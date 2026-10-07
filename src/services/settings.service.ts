import { assertCan, type Actor } from '../core/permissions/permissions.ts';
import { parsePercent } from '../core/money/parse-money.ts';
import { validation, notFound } from '../core/errors/index.ts';
import type { UnitOfWork, SettingsStore, BusinessSettingsRow, FeeRuleRow, CatalogEntryRow } from '../repositories/ports.ts';

export interface Deps { uow: UnitOfWork; settings: SettingsStore }
const opt = (s: string | null | undefined, max: number, label: string) => {
  const t = (s ?? '').trim(); if (t.length > max) throw validation(`${label}: máximo ${max} caracteres.`); return t || null;
};
export { parsePercent } from '../core/money/parse-money.ts';
/** RUT chileno con dígito verificador (acepta con o sin puntos/guion). Devuelve formato 12.345.678-9. */
export function normalizeRut(raw: string): string {
  const c = raw.replace(/[.\s-]/g, '').toUpperCase(); const m = /^(\d{7,8})([0-9K])$/.exec(c);
  if (!m) throw validation('RUT inválido.');
  let sum = 0, mul = 2; for (const d of [...m[1]].reverse()) { sum += Number(d) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const dv = 11 - (sum % 11); const exp = dv === 11 ? '0' : dv === 10 ? 'K' : String(dv);
  if (exp !== m[2]) throw validation('El dígito verificador del RUT no coincide.');
  return `${Number(m[1]).toLocaleString('es-CL').replace(/,/g, '.')}-${m[2]}`;
}

export function createSettingsService({ uow, settings }: Deps) {
  return {
    async overview(actor: Actor | null): Promise<{ business: BusinessSettingsRow; feeRules: FeeRuleRow[]; channels: CatalogEntryRow[]; paymentMethods: CatalogEntryRow[] }> {
      assertCan(actor, 'settings.write');
      const [business, feeRules, channels, paymentMethods] = await Promise.all([settings.get(), settings.feeRules(), settings.channels(), settings.paymentMethods()]);
      return { business, feeRules, channels, paymentMethods };
    },
    /** Datos del negocio (salen en los comprobantes NUEVOS; los emitidos conservan su copia). */
    async updateBusiness(actor: Actor | null, i: { legalName: string; taxId?: string | null; address?: string | null; phone?: string | null; email?: string | null; receiptFooter?: string | null }): Promise<void> {
      assertCan(actor, 'settings.write');
      const legalName = i.legalName.trim(); if (legalName.length < 2 || legalName.length > 120) throw validation('El nombre del negocio debe tener entre 2 y 120 caracteres.');
      const taxId = i.taxId?.trim() ? normalizeRut(i.taxId) : null;
      const email = opt(i.email, 120, 'Correo'); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validation('Correo inválido.');
      const d = { legalName, taxId, address: opt(i.address, 160, 'Dirección'), phone: opt(i.phone, 40, 'Teléfono'), email, receiptFooter: opt(i.receiptFooter, 200, 'Pie del comprobante') };
      await uow.run(async (tx) => { const before = await tx.settings.updateBusiness(d); await tx.audit.write({ action: 'settings.business', entity: 'BusinessSettings', entityId: 'singleton', userId: actor.userId, before, after: d }); });
    },
    /** Regla de cargo automático de un medio de pago o canal. Solo afecta ventas FUTURAS (las cerradas conservan sus cargos). */
    async saveFeeRule(actor: Actor | null, i: { target: 'PAYMENT_METHOD' | 'CHANNEL'; targetId: string; percent: string; fixedAmount: number; isManualPerSale: boolean; isActive: boolean; vatTreatment?: FeeRuleRow['vatTreatment'] }): Promise<void> {
      assertCan(actor, 'feerule.write');
      const percentMilli = parsePercent(i.percent);
      if (!Number.isSafeInteger(i.fixedAmount) || i.fixedAmount < 0) throw validation('El cargo fijo debe ser un entero en pesos ≥ 0.');
      const d = { percentMilli, fixedAmount: i.fixedAmount, isManualPerSale: i.isManualPerSale, isActive: i.isActive, vatTreatment: i.vatTreatment ?? 'UNDEFINED' };
      await uow.run(async (tx) => {
        const before = await tx.settings.upsertFeeRule(i.target, i.targetId, d);
        await tx.audit.write({ action: 'feerule.update', entity: 'FeeRule', entityId: `${i.target}:${i.targetId}`, userId: actor.userId, before, after: d });
      });
    },
    /** Nuevo canal o medio de pago (p. ej. "Rappi" como medio de pago). El código se deriva del nombre: RAPPI, MERCADO_PAGO… */
    async createEntry(actor: Actor | null, kind: 'channel' | 'paymentMethod', rawName: string): Promise<CatalogEntryRow> {
      assertCan(actor, kind === 'channel' ? 'channel.write' : 'paymentmethod.write');
      const name = rawName.trim().replace(/\s+/g, ' '); if (name.length < 2 || name.length > 40) throw validation('El nombre debe tener entre 2 y 40 caracteres.');
      const code = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
      if (!code) throw validation('El nombre debe contener letras o números.');
      return uow.run(async (tx) => {
        const row = await tx.settings.createEntry(kind, { code, name });
        await tx.audit.write({ action: `${kind === 'channel' ? 'channel' : 'paymentmethod'}.create`, entity: kind === 'channel' ? 'SaleChannel' : 'PaymentMethod', entityId: row.id, userId: actor.userId, after: { code, name } });
        return row;
      });
    },
    async updateEntry(actor: Actor | null, kind: 'channel' | 'paymentMethod', id: string, d: { name: string; isActive: boolean }): Promise<void> {
      assertCan(actor, kind === 'channel' ? 'channel.write' : 'paymentmethod.write');
      const name = d.name.trim(); if (name.length < 2 || name.length > 40) throw validation('El nombre debe tener entre 2 y 40 caracteres.');
      await uow.run(async (tx) => {
        const before = await tx.settings.updateEntry(kind, id, { name, isActive: d.isActive }); if (!before) throw notFound(kind === 'channel' ? 'Canal' : 'Medio de pago');
        await tx.audit.write({ action: `${kind === 'channel' ? 'channel' : 'paymentmethod'}.update`, entity: kind === 'channel' ? 'SaleChannel' : 'PaymentMethod', entityId: id, userId: actor.userId, before, after: { name, isActive: d.isActive } });
      });
    },
  };
}
export type SettingsService = ReturnType<typeof createSettingsService>;
