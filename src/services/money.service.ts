import { assertCan, type Actor } from '../core/permissions/permissions.ts';
import { validation, businessRule, notFound } from '../core/errors/index.ts';
import { businessDateOf } from '../core/time/business-date.ts';
import { ACCOUNTS, computeMoney, isMoveEnd, isPaidFrom, type Account, type MoneyResult, type MoveEnd, type PaidFrom } from '../domain/money/money.ts';
import type { UnitOfWork, CatalogReader, MoneyOps, MoneyStartRecord, MoneyMoveRecord, MoneyOutflowRow } from '../repositories/ports.ts';

export interface Deps { uow: UnitOfWork; money: MoneyOps; catalog: CatalogReader; now?: () => Date }
export interface MoneyStatus { today: string; start: MoneyStartRecord | null; startDate: string | null; result: MoneyResult | null; moves: MoneyMoveRecord[]; outflows: MoneyOutflowRow[]; salesCount: number }

const amountOf = (v: unknown, label: string, allowZero = true) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < (allowZero ? 0 : 1) || v > 10_000_000_000) throw validation(`${label}: ingresa un monto en pesos (entero${allowZero ? ', 0 o más' : ', mayor que 0'}).`);
  return v;
};
const noteOf = (v: unknown) => { const n = String(v ?? '').trim(); if (n.length > 300) throw validation('Nota: máximo 300 caracteres.'); return n || null; };

/**
 * Dinero disponible (solo ADMINISTRADOR): cuánto dinero debería haber y dónde.
 * Todo se guarda en la bitácora de auditoría (solo inserción): punto de partida ('money.start'),
 * traspasos/retiros/aportes ('money.move', anulables con 'money.move.void') y con qué se pagó una compra o gasto ('money.source').
 */
export function createMoneyService({ uow, money, catalog, now = () => new Date() }: Deps) {
  const today = async () => businessDateOf(now(), (await catalog.businessSettings()).timezone);
  return {
    async status(actor: Actor | null): Promise<MoneyStatus> {
      assertCan(actor, 'money.manage');
      const [start, t, tz] = await Promise.all([money.lastStart(actor.branchId), today(), catalog.businessSettings().then((b) => b.timezone)]);
      if (!start) return { today: t, start: null, startDate: null, result: null, moves: [], outflows: [], salesCount: 0 };
      const startDate = businessDateOf(start.at, tz);
      const [data, moves] = await Promise.all([money.data(actor.branchId, start.at, startDate), money.moves(actor.branchId, start.at)]);
      const result = computeMoney({ start: start.balances, payments: data.payments, charges: data.charges, refunds: data.refunds, outflows: data.outflows, moves });
      return { today: t, start, startDate, result, moves, outflows: data.outflows, salesCount: data.salesCount };
    },

    /** Nuevo punto de partida: los saldos reales contados ahora. Desde aquí se suma todo lo que se registre. */
    async setStart(actor: Actor | null, i: { balances: Partial<Record<Account, number>>; note?: string | null }): Promise<void> {
      assertCan(actor, 'money.manage');
      const balances = Object.fromEntries(ACCOUNTS.map((a) => [a, amountOf(i.balances[a] ?? 0, `Saldo ${a}`)])) as Record<Account, number>;
      const note = noteOf(i.note);
      await uow.run((tx) => tx.audit.write({ action: 'money.start', entity: 'MoneyStart', entityId: actor.branchId, userId: actor.userId, after: { branchId: actor.branchId, balances, note, at: now().toISOString() } }));
    },

    /** Traspaso entre cuentas (p. ej. TUU → Banco cuando TUU abona), retiro personal (→ EXTERNO) o aporte (EXTERNO →). */
    async addMove(actor: Actor | null, i: { date: string; from: string; to: string; amount: number; note?: string | null }): Promise<void> {
      assertCan(actor, 'money.manage');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw validation('Fecha inválida.');
      if (i.date > await today()) throw validation('La fecha no puede ser futura.');
      if (!isMoveEnd(i.from) || !isMoveEnd(i.to)) throw validation('Cuenta inválida.');
      if (i.from === i.to) throw validation('El origen y el destino deben ser distintos.');
      const amount = amountOf(i.amount, 'Monto', false); const note = noteOf(i.note);
      if (!(await money.lastStart(actor.branchId))) throw businessRule('Primero fija el punto de partida (los saldos reales de hoy).');
      const from: MoveEnd = i.from; const to: MoveEnd = i.to;
      await uow.run((tx) => tx.audit.write({ action: 'money.move', entity: 'MoneyMove', entityId: actor.branchId, userId: actor.userId, after: { branchId: actor.branchId, date: i.date, from, to, amount, note } }));
    },

    async voidMove(actor: Actor | null, id: string, reason: string): Promise<void> {
      assertCan(actor, 'money.manage');
      const r = reason.trim(); if (r.length < 3) throw validation('Indica el motivo de la anulación.');
      const m = await money.moveExists(String(id), actor.branchId); if (!m) throw notFound('Movimiento');
      if (m.voided) throw businessRule('Ese movimiento ya está anulado.');
      await uow.run((tx) => tx.audit.write({ action: 'money.move.void', entity: 'MoneyMove', entityId: String(id), userId: actor.userId, metadata: { reason: r } }));
    },

    /** Indica (o corrige) con qué se pagó una compra o un gasto. */
    async setSource(actor: Actor | null, kind: 'PURCHASE' | 'EXPENSE', id: string, paidFrom: string): Promise<void> {
      assertCan(actor, 'money.manage');
      if (kind !== 'PURCHASE' && kind !== 'EXPENSE') throw validation('Tipo inválido.');
      if (!isPaidFrom(paidFrom)) throw validation('Indica con qué se pagó.');
      if (!(await money.outflowExists(kind, String(id), actor.branchId))) throw notFound(kind === 'PURCHASE' ? 'Compra' : 'Gasto');
      const p: PaidFrom = paidFrom;
      await uow.run((tx) => tx.audit.write({ action: 'money.source', entity: kind === 'PURCHASE' ? 'Purchase' : 'Expense', entityId: String(id), userId: actor.userId, after: { paidFrom: p } }));
    },
  };
}
