import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, code } from '../helpers/world.ts';
import type { CashCloseRecord } from '../../src/repositories/ports.ts';

const T = (hhmm: string) => new Date(`2026-10-07T${hhmm}:00-03:00`);
function setup() {
  const w = world(); w.db.clock = T('20:00');
  const efe = (amount: number) => ({ code: 'CASH', name: 'Efectivo', amount }); const deb = (amount: number) => ({ code: 'DEBIT', name: 'Débito', amount });
  w.db.cashSales.push(
    { date: '2026-10-07', at: T('10:00'), total: 5000, payments: [efe(5000)] },
    { date: '2026-10-07', at: T('11:00'), total: 8000, payments: [efe(3000), deb(5000)] },
    { date: '2026-10-07', at: T('12:00'), total: 9990, voided: true, payments: [efe(9990)] },
    { date: '2026-10-06', at: new Date('2026-10-06T18:00:00-03:00'), total: 7777, payments: [efe(7777)] },
  );
  return { ...w, efe, deb, setClock: (d: Date) => { w.db.clock = d; } };
}

test('cierre del administrador: esperado = fondo + efectivo − retiros; diferencia = contado − esperado', async () => {
  const { svc } = setup();
  const st = await svc.cash.status(admin);
  assert.equal(st.date, '2026-10-07'); assert.equal(st.salesCount, 2); assert.equal(st.summary!.cash, 8000); assert.equal(st.summary!.total, 13000); assert.equal(st.summary!.voidedCount, 1);
  const r = await svc.cash.close(admin, { float: 20000, counted: 26500, withdrawals: 1000, note: 'pagué el pan' }) as CashCloseRecord;
  assert.equal(r.expectedCash, 20000 + 8000 - 1000); assert.equal(r.diff, -500); assert.equal(r.seq, 1); assert.equal(r.periodFrom, null);
  assert.deepEqual(r.byMethod.map((m) => [m.code, m.amount]), [['CASH', 8000], ['DEBIT', 5000]]);
});

test('vendedor: cierre a ciegas (no recibe esperado ni diferencia ni montos); el administrador sí los ve en el historial', async () => {
  const { svc } = setup();
  const st = await svc.cash.status(s1);
  assert.equal(st.summary, null); assert.equal(st.review, false); assert.equal(st.salesCount, 2);
  const r = await svc.cash.close(s1, { float: 20000, counted: 28000 });
  assert.ok(!('expectedCash' in r) && !('diff' in r) && !('byMethod' in r) && !('total' in r));
  const h = await svc.cash.history(s1); assert.equal(h.review, false); assert.equal(h.rows.length, 1); assert.ok(!('diff' in h.rows[0]));
  const ha = await svc.cash.history(admin); assert.equal(ha.review, true);
  const row = ha.rows[0] as CashCloseRecord; assert.equal(row.expectedCash, 28000); assert.equal(row.diff, 0); assert.equal(row.role, 'VENDEDOR');
});

test('cierres por turno: el segundo cierre del día solo cuenta las ventas posteriores al primero; fondo sugerido = último fondo', async () => {
  const { db, svc, efe, setClock } = setup();
  setClock(T('14:00')); await svc.cash.close(admin, { float: 15000, counted: 23000 });
  db.cashSales.push({ date: '2026-10-07', at: T('15:00'), total: 2500, payments: [efe(2500)] }); // venta posterior al cierre
  setClock(T('20:00'));
  const st = await svc.cash.status(admin);
  assert.equal(st.closesToday, 1); assert.equal(st.salesCount, 1); assert.equal(st.summary!.cash, 2500); assert.equal(st.suggestedFloat, 15000);
  const r = await svc.cash.close(admin, { float: 15000, counted: 17500 }) as CashCloseRecord;
  assert.equal(r.seq, 2); assert.equal(r.expectedCash, 17500); assert.equal(r.diff, 0); assert.ok(r.periodFrom);
});

test('validaciones: montos enteros ≥ 0, nota máx. 300; sin sesión no', async () => {
  const { svc } = setup();
  for (const bad of [{ float: -1, counted: 0 }, { float: 0, counted: 10.5 }, { float: 0, counted: 0, withdrawals: -5 }, { float: 0, counted: 0, note: 'x'.repeat(301) }])
    assert.equal(await code(svc.cash.close(admin, bad)), 'VALIDATION');
  assert.equal(await code(svc.cash.close(null, { float: 0, counted: 0 })), 'UNAUTHENTICATED');
  assert.equal(await code(svc.cash.history(admin, { from: '2026-10-08', to: '2026-10-01' })), 'VALIDATION');
});

test('apertura: fija el fondo para el cierre (el monto escrito al cerrar se ignora); no se abre dos veces; tras cerrar se puede volver a abrir', async () => {
  const { svc, setClock } = setup();
  setClock(T('09:00'));
  const o = await svc.cash.open(s1, { float: 15000 });
  assert.equal(o.float, 15000);
  assert.equal(await code(svc.cash.open(admin, { float: 1 })), 'BUSINESS_RULE');
  setClock(T('20:00'));
  const st = await svc.cash.status(admin); assert.equal(st.open?.float, 15000); assert.equal(st.suggestedFloat, 15000);
  const r = await svc.cash.close(admin, { float: 999999, counted: 23000 }) as CashCloseRecord;
  assert.equal(r.float, 15000); assert.equal(r.expectedCash, 23000); assert.equal(r.diff, 0); assert.equal(r.withoutOpen, false);
  assert.equal((await svc.cash.status(admin)).open, null, 'tras el cierre no hay apertura vigente');
  setClock(T('20:30'));
  await svc.cash.open(admin, { float: 5000 });
  assert.equal((await svc.cash.status(admin)).open?.float, 5000);
});
test('cierre sin apertura: usa el fondo escrito y queda marcado', async () => {
  const { svc } = setup();
  const r = await svc.cash.close(admin, { float: 1000, counted: 9000 }) as CashCloseRecord;
  assert.equal(r.withoutOpen, true); assert.equal(r.expectedCash, 9000);
  assert.equal(await code(svc.cash.open(admin, { float: -5 })), 'VALIDATION');
});
