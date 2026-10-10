import { assertCan, type Actor } from '../core/permissions/permissions.ts';
import { validation, notFound, businessRule } from '../core/errors/index.ts';
import { businessDateOf } from '../core/time/business-date.ts';
import { planExpense, type ExpenseDocType } from '../domain/expenses/expenses.ts';
import { normalizeDocNumber } from '../domain/purchases/purchases.ts';
import { isPaidFrom } from '../domain/money/money.ts';
import type { UnitOfWork, ExpenseReader, ExpenseRecord, ExpenseCategoryRow, CatalogReader } from '../repositories/ports.ts';

export interface Deps { uow: UnitOfWork; expenses: ExpenseReader; catalog: CatalogReader; now?: () => Date }
export interface ExpenseInput { categoryId: string; description: string; expenseDate: string; totalAmount: number; docType?: ExpenseDocType | null; docNumber?: string | null; supplierId?: string | null; netAmount?: number | null; vatAmount?: number | null; paidFrom?: string | null }

export function createExpensesService({ uow, expenses, catalog, now = () => new Date() }: Deps) {
  const today = async () => businessDateOf(now(), (await catalog.businessSettings()).timezone);
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  return {
    async list(actor: Actor | null, f: { from: string; to: string; categoryId?: string; status?: 'CONFIRMED' | 'VOIDED' }): Promise<ExpenseRecord[]> {
      assertCan(actor, 'expense.read');
      if (!isDate(f.from) || !isDate(f.to) || f.from > f.to) throw validation('Rango de fechas inválido.');
      return expenses.list(actor.branchId, { ...f, limit: 500 });
    },
    async get(actor: Actor | null, id: string): Promise<ExpenseRecord> { assertCan(actor, 'expense.read'); const e = await expenses.get(id); if (!e) throw notFound('Gasto'); return e; },
    async categories(actor: Actor | null, includeInactive = false): Promise<ExpenseCategoryRow[]> { assertCan(actor, 'expense.read'); return expenses.categories(includeInactive); },
    async today(actor: Actor | null): Promise<string> { assertCan(actor, 'expense.read'); return today(); },

    /** Registra un gasto (solo ADMINISTRADOR). Factura: IVA recuperable (al resultado va el neto). Misma factura dos veces: rechazada. */
    async create(actor: Actor | null, i: ExpenseInput): Promise<{ id: string }> {
      assertCan(actor, 'expense.write');
      const description = i.description.trim(); if (description.length < 2 || description.length > 200) throw validation('Describe el gasto (entre 2 y 200 caracteres).');
      if (!isDate(i.expenseDate)) throw validation('Fecha inválida.');
      if (i.expenseDate > await today()) throw validation('La fecha del gasto no puede ser futura.');
      if (i.paidFrom != null && !isPaidFrom(i.paidFrom)) throw validation('Indica con qué se pagó el gasto.');
      const docType = i.docType ?? null; const docNumber = normalizeDocNumber(i.docNumber ?? null);
      if (docType === 'FACTURA' && !docNumber) throw validation('La factura exige número de documento.');
      const a = planExpense({ docType, totalAmount: i.totalAmount, netAmount: i.netAmount, vatAmount: i.vatAmount });
      return uow.run(async (tx) => {
        const active = await tx.expenses.categoryActive(i.categoryId);
        if (active === null) throw validation('Categoría inexistente.'); if (!active) throw businessRule('La categoría está inactiva.');
        if (docType && docNumber) { const dup = await tx.expenses.findDuplicate({ supplierId: i.supplierId ?? null, docType, docNumber }); if (dup) throw businessRule(`Ese documento ya está registrado como gasto (del ${dup.expenseDate.split('-').reverse().join('-')}).`); }
        const r = await tx.expenses.insert({ branchId: actor.branchId, categoryId: i.categoryId, supplierId: i.supplierId ?? null, description, docType, docNumber, expenseDate: i.expenseDate,
          vatRecoverable: a.vatRecoverable, netAmount: a.netAmount, vatAmount: a.vatAmount, totalAmount: a.totalAmount, createdById: actor.userId });
        await tx.audit.write({ action: 'expense.create', entity: 'Expense', entityId: r.id, userId: actor.userId, after: { description, total: a.totalAmount, docType, docNumber, expenseDate: i.expenseDate, paidFrom: i.paidFrom ?? null } });
        return r;
      });
    },
    /** Anular (nunca borrar), con motivo. */
    async void(actor: Actor | null, id: string, reason: string): Promise<void> {
      assertCan(actor, 'expense.write'); if (!reason.trim()) throw validation('Anular un gasto exige un motivo.');
      await uow.run(async (tx) => {
        const e = await tx.expenses.getForUpdate(id); if (!e) throw notFound('Gasto'); if (e.status === 'VOIDED') throw businessRule('El gasto ya está anulado.');
        await tx.expenses.markVoided(id, reason.trim(), actor.userId);
        await tx.audit.write({ action: 'expense.void', entity: 'Expense', entityId: id, userId: actor.userId, metadata: { reason: reason.trim() } });
      });
    },
    async createCategory(actor: Actor | null, name: string): Promise<{ id: string; name: string }> {
      assertCan(actor, 'expense.write'); const n = name.trim(); if (n.length < 2 || n.length > 60) throw validation('El nombre debe tener entre 2 y 60 caracteres.');
      return uow.run(async (tx) => { const c = await tx.expenses.ensureCategory(n); await tx.audit.write({ action: 'expense_category.ensure', entity: 'ExpenseCategory', entityId: c.id, userId: actor.userId, metadata: { name: c.name } }); return c; });
    },
    async updateCategory(actor: Actor | null, id: string, d: { name: string; isActive: boolean }): Promise<void> {
      assertCan(actor, 'expense.write'); const n = d.name.trim(); if (n.length < 2 || n.length > 60) throw validation('El nombre debe tener entre 2 y 60 caracteres.');
      await uow.run(async (tx) => { const before = await tx.expenses.updateCategory(id, { name: n, isActive: d.isActive }); if (!before) throw notFound('Categoría');
        await tx.audit.write({ action: 'expense_category.update', entity: 'ExpenseCategory', entityId: id, userId: actor.userId, before, after: { name: n, isActive: d.isActive } }); });
    },
  };
}
export type ExpensesService = ReturnType<typeof createExpensesService>;
