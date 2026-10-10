import { assertCan, can, type Actor } from '../core/permissions/permissions.ts';
import { validation } from '../core/errors/index.ts';
import { businessDateOf } from '../core/time/business-date.ts';
import { businessRule } from '../core/errors/index.ts';
import type { UnitOfWork, CatalogReader, CashOps, CashSummary, CashCloseRecord, CashOpenRecord } from '../repositories/ports.ts';

export interface Deps { uow: UnitOfWork; cash: CashOps; catalog: CatalogReader; now?: () => Date }
/** Lo que ve el vendedor de un cierre: lo que él contó, sin el esperado ni la diferencia ("conteo a ciegas"). */
export type BlindClose = Pick<CashCloseRecord, 'id' | 'at' | 'date' | 'seq' | 'float' | 'counted' | 'withdrawals' | 'salesCount' | 'note' | 'userName'>;
export interface CloseInput { float?: number; counted: number; withdrawals?: number; note?: string | null }

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
  /** Apertura vigente: la última del día posterior al último cierre del día. */
  const currentOpen = async (ops: Pick<CashOps, 'opens' | 'lastClose'>, branchId: string, date: string): Promise<CashOpenRecord | null> => {
    const [o, c] = await Promise.all([ops.opens(branchId, { from: date, to: date, limit: 1 }), ops.lastClose(branchId, date)]);
    const open = o[0] ?? null;
    return open && (!c || open.at > c.at) ? open : null;
  };
  return {
    /** Estado del tramo abierto. El vendedor solo recibe la cantidad de ventas (no montos). */
    async status(actor: Actor | null): Promise<{ date: string; closesToday: number; since: Date | null; suggestedFloat: number; salesCount: number; summary: CashSummary | null; review: boolean; open: CashOpenRecord | null }> {
      assertCan(actor, 'cash.close');
      const date = await today();
      const [last, closesToday, lastEver] = await Promise.all([cash.lastClose(actor.branchId, date), cash.closes(actor.branchId, { from: date, to: date, limit: 500 }), cash.closes(actor.branchId, { from: '2000-01-01', to: date, limit: 1 })]);
      const [summary, open] = await Promise.all([cash.summary(actor.branchId, date, last?.at ?? null), currentOpen(cash, actor.branchId, date)]);
      const review = can(actor.role, 'cash.review');
      return { date, closesToday: closesToday.length, since: last?.at ?? null, suggestedFloat: open?.float ?? lastEver[0]?.float ?? 0, salesCount: summary.salesCount, summary: review ? summary : null, review, open };
    },

    /** Apertura: quien abre fija el fondo inicial (sencillo). Una sola apertura vigente por turno. */
    async open(actor: Actor | null, i: { float: number; note?: string | null }): Promise<CashOpenRecord> {
      assertCan(actor, 'cash.close');
      const float = money(i.float, 'Fondo inicial');
      const note = (i.note ?? '').trim(); if (note.length > 300) throw validation('Nota: máximo 300 caracteres.');
      const date = await today();
      await uow.run(async (tx) => {
        await tx.cash.lock(actor.branchId, date);
        const cur = await currentOpen(tx.cash, actor.branchId, date);
        if (cur) throw businessRule(`La caja ya está abierta (por ${cur.userName}). Ciérrala antes de abrir un nuevo turno.`);
        await tx.audit.write({ action: 'cash.open', entity: 'CashOpen', entityId: `${date}#open`, userId: actor.userId, after: { branchId: actor.branchId, date, float, note: note || null, openedAt: now().toISOString() } });
      });
      const o = await currentOpen(cash, actor.branchId, date);
      return o ?? { id: '', at: now(), userId: actor.userId, userName: actor.email, branchId: actor.branchId, date, float, note: note || null };
    },

    async close(actor: Actor | null, i: CloseInput): Promise<CashCloseRecord | BlindClose> {
      assertCan(actor, 'cash.close');
      const inputFloat = money(i.float ?? 0, 'Fondo inicial'); const counted = money(i.counted, 'Efectivo contado'); const withdrawals = money(i.withdrawals ?? 0, 'Retiros');
      const note = (i.note ?? '').trim(); if (note.length > 300) throw validation('Nota: máximo 300 caracteres.');
      const date = await today();
      const rec = await uow.run(async (tx) => {
        await tx.cash.lock(actor.branchId, date);                       // dos cierres simultáneos no pueden tomar el mismo tramo
        const last = await tx.cash.lastClose(actor.branchId, date);
        const open = await currentOpen(tx.cash, actor.branchId, date);
        const float = open ? open.float : inputFloat;               // con apertura, el fondo lo fijó quien abrió
        const s = await tx.cash.summary(actor.branchId, date, last?.at ?? null);
        const expectedCash = float + s.cash - withdrawals; const diff = counted - expectedCash;
        const seq = (last?.seq ?? 0) + 1;
        const after = { branchId: actor.branchId, date, seq, periodFrom: last ? last.at.toISOString() : null, role: actor.role, float, counted, withdrawals, expectedCash, diff,
          salesCount: s.salesCount, total: s.total, byMethod: s.byMethod, voidedCount: s.voidedCount, note: note || null, closedAt: now().toISOString(),
          openId: open?.id ?? null, openedBy: open?.userName ?? null, openedAt: open ? open.at.toISOString() : null, withoutOpen: !open };
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
