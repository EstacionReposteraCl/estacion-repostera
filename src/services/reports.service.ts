import { assertCan, type Actor } from '../core/permissions/permissions.ts';
import { businessDateOf } from '../core/time/business-date.ts';
import { validation } from '../core/errors/index.ts';
import type { CatalogReader, ReportReader } from '../repositories/ports.ts';

export interface Deps { catalog: CatalogReader; reports: ReportReader; now?: () => Date }
export function createReportsService({ catalog, reports, now = () => new Date() }: Deps) {
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
  };
}
export type ReportsService = ReturnType<typeof createReportsService>;
