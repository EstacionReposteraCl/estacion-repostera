import { assertCan, can, type Actor } from '../core/permissions/permissions.ts';
import { validation } from '../core/errors/index.ts';
import { businessDateOf } from '../core/time/business-date.ts';
import { businessRule } from '../core/errors/index.ts';
import type { UnitOfWork, CatalogReader, CashOps, CashSummary, CashCloseRecord, CashOpenRecord } from '../repositories/ports.ts';

/** Medios que se cuentan en el cierre: lo que queda en el local (efectivo) o en la máquina TUU (débito y crédito).
 *  Plataformas (Mercado Pago/ML, Rappi) y transferencias llegan después y no entran al arqueo (sí a reportes y a Dinero). */
/** Fondo sugerido solo si nunca se ha cerrado la caja. Lo normal: la caja parte con lo que quedó en el último cierre. */
export const STANDARD_FLOAT = 20000;

export const CLOSE_METHODS = ['CASH', 'DEBIT', 'CREDIT'];
export interface Deps { uow: UnitOfWork; cash: CashOps; catalog: CatalogReader; now?: () => Date }
/** Lo que ve el vendedor de un cierre: lo que él contó, sin el esperado ni la diferencia ("conteo a ciegas"). */
export type BlindClose = Pick<CashCloseRecord, 'id' | 'at' | 'date' | 'seq' | 'float' | 'counted' | 'withdrawals' | 'salesCount' | 'note' | 'userName' | 'declared' | 'takeOut'>;
export interface CloseInput { float?: number; counted: number; withdrawals?: number; note?: string | null; declared?: Record<string, number> | null; takeOut?: number }

const blind = (r: CashCloseRecord): BlindClose => ({ id: r.id, at: r.at, date: r.date, seq: r.seq, float: r.float, counted: r.counted, withdrawals: r.withdrawals, salesCount: r.salesCount, note: r.note, userName: r.userName, declared: r.declared ?? null, takeOut: r.takeOut ?? 0 });
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
    async status(actor: Actor | null): Promise<{ date: string; closesToday: number; since: Date | null; suggestedFloat: number; salesCount: number; summary: CashSummary | null; review: boolean; open: CashOpenRecord | null; methods: { code: string; name: string }[] }> {
      assertCan(actor, 'cash.close');
      const date = await today();
      const [last, closesToday, lastEver] = await Promise.all([cash.lastClose(actor.branchId, date), cash.closes(actor.branchId, { from: date, to: date, limit: 500 }), cash.closes(actor.branchId, { from: '2000-01-01', to: date, limit: 1 })]);
      let left = lastEver[0] ? lastEver[0].counted - (lastEver[0].takeOut ?? 0) : null;      // lo que quedó en la caja al último cierre
      // Si un día anterior se abrió la caja y no se cerró: fondo de esa apertura + efectivo vendido en ese turno.
      const prevOpen = (await cash.opens(actor.branchId, { from: '2000-01-01', to: date, limit: 1 }))[0];
      const le = lastEver[0];
      if (prevOpen && prevOpen.date < date && (!le || prevOpen.date > le.date || (prevOpen.date === le.date && prevOpen.at > le.at))) {
        const s = await cash.summary(actor.branchId, prevOpen.date, (await cash.lastClose(actor.branchId, prevOpen.date))?.at ?? null, CLOSE_METHODS);
        left = prevOpen.float + s.cash;
      }
      const [summary, open] = await Promise.all([cash.summary(actor.branchId, date, last?.at ?? null, CLOSE_METHODS), currentOpen(cash, actor.branchId, date)]);
      const review = can(actor.role, 'cash.review');
      const methods = summary.byMethod.filter((m) => m.code !== 'CASH').map((m) => ({ code: m.code, name: m.name }));   // medios a declarar (sin montos para el vendedor)
      return { date, closesToday: closesToday.length, since: last?.at ?? null, suggestedFloat: open?.float ?? left ?? STANDARD_FLOAT, salesCount: summary.salesCount, summary: review ? summary : null, review, open, methods };
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

    /** Administrador: días anteriores (últimos 30) con la caja abierta y sin cierre. */
    async pendingDays(actor: Actor | null): Promise<{ date: string; float: number }[]> {
      assertCan(actor, 'cash.review');
      const date = await today(); const from = new Date(Date.parse(date + 'T12:00:00Z') - 30 * 86400e3).toISOString().slice(0, 10);
      const [opens, closes] = await Promise.all([cash.opens(actor.branchId, { from, to: date, limit: 200 }), cash.closes(actor.branchId, { from, to: date, limit: 500 })]);
      const closed = new Set(closes.map((c) => c.date)); const seen = new Set<string>(); const out: { date: string; float: number }[] = [];
      for (const o of opens) if (o.date < date && !closed.has(o.date) && !seen.has(o.date)) { seen.add(o.date); out.push({ date: o.date, float: o.float }); }
      return out.sort((a, b) => b.date.localeCompare(a.date));
    },
    /** Administrador: lo que necesita el formulario para cerrar un día anterior que quedó sin cierre. */
    async dayStatus(actor: Actor | null, day: string): Promise<{ date: string; open: CashOpenRecord | null; summary: CashSummary; closed: boolean }> {
      assertCan(actor, 'cash.review');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= await today()) throw validation('Elige un día anterior a hoy.');
      const [o, c, summary] = await Promise.all([cash.opens(actor.branchId, { from: day, to: day, limit: 1 }), cash.lastClose(actor.branchId, day), cash.summary(actor.branchId, day, null, CLOSE_METHODS)]);
      return { date: day, open: o[0] ?? null, summary, closed: !!c };
    },
    /** Administrador: registra el cierre de un día anterior que no se cerró (queda marcado como "registrado después"). */
    async closeDay(actor: Actor | null, day: string, i: CloseInput): Promise<CashCloseRecord> {
      assertCan(actor, 'cash.review');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= await today()) throw validation('Elige un día anterior a hoy.');
      const inputFloat = money(i.float ?? 0, 'Fondo inicial'); const counted = money(i.counted, 'Efectivo contado'); const withdrawals = money(i.withdrawals ?? 0, 'Retiros');
      const takeOut = money(i.takeOut ?? 0, 'Efectivo retirado'); if (takeOut > counted) throw validation('No puedes retirar más efectivo del que contaste.');
      const note = (i.note ?? '').trim(); if (note.length > 300) throw validation('Nota: máximo 300 caracteres.');
      const rec = await uow.run(async (tx) => {
        await tx.cash.lock(actor.branchId, day);
        if (await tx.cash.lastClose(actor.branchId, day)) throw businessRule('Ese día ya tiene cierre registrado.');
        const open = (await tx.cash.opens(actor.branchId, { from: day, to: day, limit: 1 }))[0] ?? null;
        const float = open ? open.float : inputFloat;
        const s = await tx.cash.summary(actor.branchId, day, null, CLOSE_METHODS);
        const expectedCash = float + s.cash - withdrawals; const diff = counted - expectedCash;
        const declared: Record<string, number> = {};
        for (const m of s.byMethod) { if (m.code === 'CASH') continue; const v = i.declared?.[m.code]; if (v !== undefined && v !== null) declared[m.code] = money(v, m.name); }
        const after = { branchId: actor.branchId, date: day, seq: 1, periodFrom: null, role: actor.role, float, counted, withdrawals, expectedCash, diff,
          salesCount: s.salesCount, total: s.total, byMethod: s.byMethod, voidedCount: s.voidedCount, note: note || null, closedAt: now().toISOString(),
          openId: open?.id ?? null, openedBy: open?.userName ?? null, openedAt: open ? open.at.toISOString() : null, withoutOpen: !open, declared: Object.keys(declared).length ? declared : null, takeOut, late: true };
        await tx.audit.write({ action: 'cash.close', entity: 'CashClose', entityId: `${day}#1`, userId: actor.userId, after });
        return after;
      });
      const saved = (await cash.closes(actor.branchId, { from: day, to: day, limit: 5 })).find((r) => r.seq === rec.seq);
      return saved ?? { ...rec, id: `${day}#1`, at: new Date(rec.closedAt), userId: actor.userId, userName: actor.email };
    },

    /**
     * Administrador: corrige un cierre ya registrado (p. ej. el fondo inicial incluía una venta que después se anuló).
     * No borra nada: agrega 'cash.close.fix' y el cierre se recalcula (esperado = fondo + efectivo − retiros).
     */
    /** Administrador: corrige el fondo de la apertura vigente de hoy (p. ej. quedó mal por ventas atrasadas del día anterior). */
    async fixOpenFloat(actor: Actor | null, float: number, reason: string): Promise<CashOpenRecord> {
      assertCan(actor, 'cash.review');
      const r = String(reason ?? '').trim(); if (r.length < 5) throw validation('Indica el motivo de la corrección.');
      const f = money(float, 'Fondo inicial'); const date = await today();
      const open = await currentOpen(cash, actor.branchId, date); if (!open) throw businessRule('La caja no está abierta hoy.');
      await uow.run((tx) => tx.audit.write({ action: 'cash.open.fix', entity: 'CashOpen', entityId: open.id, userId: actor.userId, before: { float: open.float }, after: { float: f, note: r } }));
      return { ...open, float: f, note: r };
    },
    /** `refreshSales`: vuelve a leer las ventas del día (sirve si después del cierre se registraron ventas atrasadas de ese día). */
    async fixClose(actor: Actor | null, closeId: string, i: { float?: number; counted?: number; reason: string; refreshSales?: boolean }): Promise<CashCloseRecord> {
      assertCan(actor, 'cash.review');
      const reason = String(i.reason ?? '').trim(); if (reason.length < 5) throw validation('Indica el motivo de la corrección.');
      const all = await cash.closes(actor.branchId, { from: '2000-01-01', to: await today(), limit: 2000 });
      const r = all.find((x) => x.id === closeId); if (!r) throw validation('Cierre no encontrado.');
      const float = i.float === undefined ? r.float : money(i.float, 'Fondo inicial'); const counted = i.counted === undefined ? r.counted : money(i.counted, 'Efectivo contado');
      let sales: Pick<CashCloseRecord, 'byMethod' | 'salesCount' | 'total' | 'voidedCount'> = { byMethod: r.byMethod, salesCount: r.salesCount, total: r.total, voidedCount: r.voidedCount };
      if (i.refreshSales) {
        if (all.some((x) => x.date === r.date && x.id !== r.id)) throw businessRule('Ese día tiene más de un cierre: no se pueden volver a leer sus ventas.');
        const s = await cash.summary(actor.branchId, r.date, null, CLOSE_METHODS); sales = { byMethod: s.byMethod, salesCount: s.salesCount, total: s.total, voidedCount: s.voidedCount };
      }
      const cashSales = sales.byMethod.filter((m) => m.code === 'CASH').reduce((a, m) => a + m.amount, 0);
      const expectedCash = float + cashSales - r.withdrawals; const diff = counted - expectedCash;
      if ((r.takeOut ?? 0) > counted) throw validation('El efectivo retirado al cerrar supera lo contado.');
      await uow.run((tx) => tx.audit.write({ action: 'cash.close.fix', entity: 'CashClose', entityId: closeId, userId: actor.userId,
        before: { float: r.float, counted: r.counted, expectedCash: r.expectedCash, diff: r.diff, note: r.note, salesCount: r.salesCount, total: r.total },
        after: { float, counted, expectedCash, diff, note: reason, ...sales, fixed: { at: now().toISOString(), reason } } }));
      return { ...r, ...sales, float, counted, expectedCash, diff, note: reason, fixed: { at: now().toISOString(), reason } };
    },

    async close(actor: Actor | null, i: CloseInput): Promise<CashCloseRecord | BlindClose> {
      assertCan(actor, 'cash.close');
      const inputFloat = money(i.float ?? 0, 'Fondo inicial'); const counted = money(i.counted, 'Efectivo contado'); const withdrawals = money(i.withdrawals ?? 0, 'Retiros');
      const takeOut = money(i.takeOut ?? 0, 'Efectivo retirado'); if (takeOut > counted) throw validation('No puedes retirar más efectivo del que contaste.');
      const note = (i.note ?? '').trim(); if (note.length > 300) throw validation('Nota: máximo 300 caracteres.');
      const date = await today();
      const rec = await uow.run(async (tx) => {
        await tx.cash.lock(actor.branchId, date);                       // dos cierres simultáneos no pueden tomar el mismo tramo
        const last = await tx.cash.lastClose(actor.branchId, date);
        const open = await currentOpen(tx.cash, actor.branchId, date);
        const float = open ? open.float : inputFloat;               // con apertura, el fondo lo fijó quien abrió
        const s = await tx.cash.summary(actor.branchId, date, last?.at ?? null, CLOSE_METHODS);
        const expectedCash = float + s.cash - withdrawals; const diff = counted - expectedCash;
        const declared: Record<string, number> = {};
        for (const m of s.byMethod) { if (m.code === 'CASH') continue; const v = i.declared?.[m.code]; if (v !== undefined && v !== null) declared[m.code] = money(v, m.name); }
        const seq = (last?.seq ?? 0) + 1;
        const after = { branchId: actor.branchId, date, seq, periodFrom: last ? last.at.toISOString() : null, role: actor.role, float, counted, withdrawals, expectedCash, diff,
          salesCount: s.salesCount, total: s.total, byMethod: s.byMethod, voidedCount: s.voidedCount, note: note || null, closedAt: now().toISOString(),
          openId: open?.id ?? null, openedBy: open?.userName ?? null, openedAt: open ? open.at.toISOString() : null, withoutOpen: !open, declared: Object.keys(declared).length ? declared : null, takeOut };
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
    async issuer(actor: Actor | null) { assertCan(actor, 'cash.close'); const b = await catalog.businessSettings(); return { legalName: b.legalName, taxId: b.taxId, address: b.address ?? null }; },
    today: async (actor: Actor | null) => { assertCan(actor, 'cash.close'); return today(); },
  };
}
export type CashService = ReturnType<typeof createCashService>;
