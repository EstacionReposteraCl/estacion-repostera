import { assertCan, type Actor } from '../core/permissions/permissions.ts';
import { businessDateOf } from '../core/time/business-date.ts';
import { validation } from '../core/errors/index.ts';
import type { CatalogReader, ReportReader, ExpenseReader } from '../repositories/ports.ts';

export interface Deps { catalog: CatalogReader; reports: ReportReader; expenses?: ExpenseReader; now?: () => Date }
export function createReportsService({ catalog, reports, expenses, now = () => new Date() }: Deps) {
  return {
    /** Vendedor: SOLO conteo y total de SUS ventas de hoy. Sin costos, sin ganancias. */
    async sellerToday(actor: Actor | null): Promise<{ count: number; total: number }> {
      assertCan(actor, 'dashboard.seller');
      const s = await catalog.businessSettings(); const r = await reports.sellerToday(actor.userId, businessDateOf(now(), s.timezone));
      return { count: r.count, total: r.total };           // campos copiados uno a uno
    },
    async financial(actor: Actor | null, range: { from: string; to: string }) {
      assertCan(actor, 'report.financial');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to) || range.from > range.to) throw validation('Rango de fechas inválido.');
      return reports.financial(range, actor.branchId);      // ventas VOIDED no cuentan (lo garantiza el lector)
    },
    /** Reporte completo del período para el ADMINISTRADOR: totales, desglose e inventario valorizado. */
    async overview(actor: Actor | null, range: { from: string; to: string }) {
      assertCan(actor, 'report.financial');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to) || range.from > range.to) throw validation('Rango de fechas inválido.');
      const [totals, breakdown, inventory, exp] = await Promise.all([reports.financial(range, actor.branchId), reports.breakdown(range, actor.branchId), reports.inventorySnapshot(actor.branchId),
        expenses ? expenses.totalsByCategory(actor.branchId, range) : Promise.resolve([])]);
      const expenseCost = exp.reduce((a, x) => a + x.resultCost, 0);
      // Utilidad del negocio = ganancia real de las ventas − gastos (factura: neto; boleta/sin documento: total). No incluye impuestos a la renta.
      return { range, totals, breakdown, inventory, expenses: { byCategory: exp, total: exp.reduce((a, x) => a + x.total, 0), resultCost: expenseCost }, businessProfit: totals.realProfit - expenseCost };
    },
    async today(actor: Actor | null): Promise<string> { assertCan(actor, 'report.financial'); return businessDateOf(now(), (await catalog.businessSettings()).timezone); },
  };
}
export type ReportsService = ReturnType<typeof createReportsService>;
