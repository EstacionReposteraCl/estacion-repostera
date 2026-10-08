import { assertCan, can, type Actor } from '../core/permissions/permissions.ts';
import { validation } from '../core/errors/index.ts';
import { businessDateOf } from '../core/time/business-date.ts';
import type { UnitOfWork, CatalogReader, CashOps, CashSummary, CashCloseRecord } from '../repositories/ports.ts';

export interface Deps { uow: UnitOfWork; cash: CashOps; catalog: CatalogReader; now?: () => Date }
/** Lo que ve el vendedor de un cierre: lo que él contó, sin el esperado ni la diferencia ("conteo a ciegas"). */
export type BlindClose = Pick<CashCloseRecord, 'id' | 'at' | 'date' | 'seq' | 'float' | 'counted' | 'withdrawals' | 'salesCount' | 'note' | 'userName'>;
export interface CloseInput { float: number; counted: number; withdrawals?: number; note?: string | null }

const blind = (r: CashCloseRecord): BlindClose => ({ id: r.id, at: r.at, date: r.date, seq: r.seq, float: r.float, counted: r.counted, withdrawals: r.withdrawals, salesCount: r.salesCount, note: r.note, userName: r.userName });
const money = (v: unknown, label: string) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > 1_000_000_000) throw validation(`${label}: ingresa un monto en pesos (entero, 0 o más).`);
  return v;
};

/**
 * Cierre de caja (control interno; TUU sigue emitiendo boletas).
 * Cada cierre cubre las ventas del día DESDE el cierre anterior del mismo día (permite cierres por turno).
 * Efectivo esperado = fondo inicial + ventas en efectivo − retiros/pagos hechos con efectivo de la caja. Diferencia = contado − esperado.
 * Se guarda en la bitácora de auditoría (action 'cash.close'), que es de solo inserción.
 */
export function createCashService({ uow, cash, catalog, now = () => new Date() }: Deps) {
  const today = async () => businessDateOf(now(), (await catalog.businessSettings()).timezone);
  return {
    /** Estado del tramo abierto. El vendedor solo recibe la cantidad de ventas (no montos). */
    async status(actor: Actor | null): Promise<{ date: string; closesToday: number; since: Date | null; suggestedFloat: number; salesCount: number; summary: CashSummary | null; review: boolean }> {
      assertCan(actor, 'cash.close');
      const date = await today();
      const [last, closesToday, lastEver] = await Promise.all([cash.lastClose(actor.branchId, date), cash.closes(actor.branchId, { from: date, to: date, limit: 500 }), cash.closes(actor.branchId, { from: '2000-01-01', to: date, limit: 1 })]);
      const summary = await cash.summary(actor.branchId, date, last?.at ?? null);
      const review = can(actor.role, 'cash.review');
      return { date, closesToday: closesToday.length, since: last?.at ?? null, suggestedFloat: lastEver[0]?.float ?? 0, salesCount: summary.salesCount, summary: review ? summary : null, review };
    },

    async close(actor: Actor | null, i: CloseInput): Promise<CashCloseRecord | BlindClose> {
      assertCan(actor, 'cash.close');
      const float = money(i.float, 'Fondo inicial'); const counted = money(i.counted, 'Efectivo contado'); const withdrawals = money(i.withdrawals ?? 0, 'Retiros');
      const note = (i.note ?? '').trim(); if (note.length > 300) throw validation('Nota: máximo 300 caracteres.');
      const date = await today();
      const rec = await uow.run(async (tx) => {
        await tx.cash.lock(actor.branchId, date);                       // dos cierres simultáneos no pueden tomar el mismo tramo
        const last = await tx.cash.lastClose(actor.branchId, date);
        const s = await tx.cash.summary(actor.branchId, date, last?.at ?? null);
        const expectedCash = float + s.cash - withdrawals; const diff = counted - expectedCash;
        const seq = (last?.seq ?? 0) + 1;
        const after = { branchId: actor.branchId, date, seq, periodFrom: last ? last.at.toISOString() : null, role: actor.role, float, counted, withdrawals, expectedCash, diff,
          salesCount: s.salesCount, total: s.total, byMethod: s.byMethod, voidedCount: s.voidedCount, note: note || null, closedAt: now().toISOString() };
        await tx.audit.write({ action: 'cash.close', entity: 'CashClose', entityId: `${date}#${seq}`, userId: actor.userId, after });
        return after;
      });
      const saved = (await cash.closes(actor.branchId, { from: date, to: date, userId: actor.userId, limit: 5 })).find((r) => r.seq === rec.seq);
      const full: CashCloseRecord = saved ?? { ...rec, id: `${date}#${rec.seq}`, at: new Date(rec.closedAt), userId: actor.userId, userName: actor.email };
      return can(actor.role, 'cash.review') ? full : blind(full);
    },

    /** Administrador: todos los cierres del rango con esperado y diferencia. Vendedor: solo los suyos de hoy, sin esos datos. */
    async history(actor: Actor | null, f?: { from: string; to: string }): Promise<{ review: true; rows: CashCloseRecord[] } | { review: false; rows: BlindClose[] }> {
      assertCan(actor, 'cash.close');
      const date = await today();
      if (can(actor.role, 'cash.review')) {
        const from = f?.from ?? date; const to = f?.to ?? date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw validation('Rango de fechas inválido.');
        return { review: true, rows: await cash.closes(actor.branchId, { from, to, limit: 500 }) };
      }
      return { review: false, rows: (await cash.closes(actor.branchId, { from: date, to: date, userId: actor.userId, limit: 50 })).map(blind) };
    },
    /** Nombre y RUT del negocio para el comprobante de cierre (ambos roles). */
    async issuer(actor: Actor | null) { assertCan(actor, 'cash.close'); const b = await catalog.businessSettings(); return { legalName: b.legalName, taxId: b.taxId }; },
    today: async (actor: Actor | null) => { assertCan(actor, 'cash.close'); return today(); },
  };
}
export type CashService = ReturnType<typeof createCashService>;
