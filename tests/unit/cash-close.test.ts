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

test('cierres por turno: el segundo cierre del día solo cuenta las ventas posteriores al primero; fondo sugerido = lo que quedó en caja al último cierre', async () => {
  const { db, svc, efe, setClock } = setup();
  setClock(T('14:00')); await svc.cash.close(admin, { float: 15000, counted: 23000 });
  db.cashSales.push({ date: '2026-10-07', at: T('15:00'), total: 2500, payments: [efe(2500)] }); // venta posterior al cierre
  setClock(T('20:00'));
  const st = await svc.cash.status(admin);
  assert.equal(st.closesToday, 1); assert.equal(st.salesCount, 1); assert.equal(st.summary!.cash, 2500); assert.equal(st.suggestedFloat, 23000);
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

test('arqueo: montos declarados de otros medios (p. ej. cierre TUU) se guardan; medios sin ventas se ignoran; el vendedor ve la lista de medios sin montos', async () => {
  const { svc } = setup();
  const sst = await svc.cash.status(s1); assert.deepEqual(sst.methods, [{ code: 'DEBIT', name: 'Débito' }]); assert.equal(sst.summary, null);
  await assert.rejects(svc.cash.close(admin, { float: 0, counted: 8000, declared: { DEBIT: -1 } }), /monto/);
  const r = await svc.cash.close(admin, { float: 0, counted: 8000, declared: { DEBIT: 4990, CREDIT: 123, CASH: 999 } }) as CashCloseRecord;
  assert.deepEqual(r.declared, { DEBIT: 4990 });
  const h = await svc.cash.history(admin); assert.deepEqual((h.rows[0] as CashCloseRecord).declared, { DEBIT: 4990 });
});

test('el cierre solo cuenta efectivo, débito y crédito: Mercado Pago, Rappi y transferencias quedan fuera', async () => {
  const { db, svc } = setup();
  db.cashSales.push({ date: '2026-10-07', at: T('13:00'), total: 7313, payments: [{ code: 'MERCADO_PAGO', name: 'Mercado Pago', amount: 7313 }] },
    { date: '2026-10-07', at: T('13:30'), total: 6000, payments: [{ code: 'CASH', name: 'Efectivo', amount: 1000 }, { code: 'TRANSFER', name: 'Transferencia', amount: 5000 }] });
  const st = await svc.cash.status(admin);
  assert.deepEqual(st.summary!.byMethod.map((m) => m.code).sort(), ['CASH', 'DEBIT']);
  assert.equal(st.summary!.total, 13000 + 1000); assert.equal(st.summary!.cash, 9000); assert.equal(st.salesCount, 3);
  assert.deepEqual(st.methods, [{ code: 'DEBIT', name: 'Débito' }]);
});

test('caja acumulada: el próximo turno parte con lo que quedó; el retiro (lunes) se descuenta y no puede superar lo contado', async () => {
  const { svc, setClock } = setup();
  setClock(T('14:00')); await assert.rejects(svc.cash.close(admin, { float: 30000, counted: 30000, takeOut: 30001 }), /más efectivo del que contaste/);
  const r = await svc.cash.close(admin, { float: 30000, counted: 52000, takeOut: 40000 }) as CashCloseRecord;
  assert.equal(r.takeOut, 40000); assert.equal(r.counted, 52000);
  setClock(T('20:00')); assert.equal((await svc.cash.status(admin)).suggestedFloat, 12000);
  await svc.cash.close(admin, { float: 12000, counted: 15500 });
  assert.equal((await svc.cash.status(admin)).suggestedFloat, 15500);
  const b = await svc.cash.close(s1, { float: 15500, counted: 15500, takeOut: 500 }); assert.equal(b.takeOut, 500);
});

test('caja sin cerrar el día anterior: al día siguiente sugiere el fondo de esa apertura + el efectivo vendido', async () => {
  const { db, svc, setClock } = setup();
  db.cashSales.length = 0;
  setClock(T('09:00')); await svc.cash.open(admin, { float: 48850 });
  db.cashSales.push({ date: '2026-10-07', at: T('11:00'), total: 8290, payments: [{ code: 'CASH', name: 'Efectivo', amount: 8290 }] });
  setClock(new Date('2026-10-08T10:00:00-03:00'));
  const st = await svc.cash.status(admin);
  assert.equal(st.open, null); assert.equal(st.suggestedFloat, 48850 + 8290);
});

test('cierre de un día anterior sin cerrar: aparece pendiente, se registra con su fecha (solo admin) y no se repite', async () => {
  const { db, svc, setClock } = setup();
  db.cashSales.length = 0;
  setClock(T('09:00')); await svc.cash.open(admin, { float: 43730 });
  db.cashSales.push({ date: '2026-10-07', at: T('11:00'), total: 3580, payments: [{ code: 'CASH', name: 'Efectivo', amount: 3580 }] });
  setClock(new Date('2026-10-09T10:00:00-03:00'));
  assert.deepEqual(await svc.cash.pendingDays(admin), [{ date: '2026-10-07', float: 43730 }]);
  await assert.rejects(svc.cash.closeDay(s1, '2026-10-07', { counted: 1 }));
  await assert.rejects(svc.cash.closeDay(admin, '2026-10-09', { counted: 1 }), /anterior a hoy/);
  const ds = await svc.cash.dayStatus(admin, '2026-10-07'); assert.equal(ds.open?.float, 43730); assert.equal(ds.summary.cash, 3580);
  const r = await svc.cash.closeDay(admin, '2026-10-07', { counted: 47310 });
  assert.equal(r.date, '2026-10-07'); assert.equal(r.expectedCash, 47310); assert.equal(r.diff, 0); assert.equal(r.late, true);
  assert.deepEqual(await svc.cash.pendingDays(admin), []);
  await assert.rejects(svc.cash.closeDay(admin, '2026-10-07', { counted: 1 }), /ya tiene cierre/);
});

test('corregir un cierre: queda auditado y se recalcula esperado y diferencia (solo admin)', async () => {
  const { svc, setClock } = setup();
  setClock(T('14:00')); const r = await svc.cash.close(admin, { float: 52200, counted: 47310 }) as CashCloseRecord;
  assert.equal(r.diff, 47310 - (52200 + r.byMethod.filter((m) => m.code === 'CASH').reduce((a, m) => a + m.amount, 0)));
  await assert.rejects(svc.cash.fixClose(s1, r.id, { float: 47310, reason: 'ajuste venta anulada' }));
  await assert.rejects(svc.cash.fixClose(admin, r.id, { float: 47310, reason: '' }), /motivo/);
  const f = await svc.cash.fixClose(admin, r.id, { float: 47310 - r.byMethod.filter((m) => m.code === 'CASH').reduce((a, m) => a + m.amount, 0), reason: 'Fondo incluía venta anulada' });
  assert.equal(f.diff, 0);
  const h = await svc.cash.history(admin) as { rows: CashCloseRecord[] }; const again = h.rows.find((x) => x.id === r.id)!;
  assert.equal(again.diff, 0); assert.equal(again.note, 'Fondo incluía venta anulada'); assert.ok(again.fixed);
});

test('ventas atrasadas después del cierre: se relee el día y se corrige el fondo de la apertura de hoy', async () => {
  const { db, svc, setClock } = setup();
  db.cashSales.length = 0;
  setClock(T('20:00')); const r = await svc.cash.close(admin, { float: 47310, counted: 47310 }) as CashCloseRecord;
  db.cashSales.push({ date: '2026-10-07', at: T('19:00'), total: 5970, payments: [{ code: 'CASH', name: 'Efectivo', amount: 5970 }] });
  const f = await svc.cash.fixClose(admin, r.id, { counted: 53280, reason: 'Venta atrasada en efectivo', refreshSales: true });
  assert.equal(f.expectedCash, 53280); assert.equal(f.diff, 0); assert.equal(f.salesCount, 1);
  setClock(new Date('2026-10-08T10:00:00-03:00')); await svc.cash.open(admin, { float: 47310 });
  await assert.rejects(svc.cash.fixOpenFloat(s1, 53280, 'ajuste'));
  await svc.cash.fixOpenFloat(admin, 53280, 'Venta atrasada del día anterior');
  const st = await svc.cash.status(admin); assert.equal(st.open?.float, 53280); assert.equal(st.suggestedFloat, 53280);
});
