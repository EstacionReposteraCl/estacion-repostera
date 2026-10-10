import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1 } from '../helpers/world.ts';
import { computeMoney, accountForMethod, accountForCharge } from '../../src/domain/money/money.ts';

const START = { CAJA: 22000, BANCO: 308022, MP: 482579, TUU: 159150, RAPPI: 34495 };
const get = (r: ReturnType<typeof computeMoney>, a: string) => r.lines.find((l) => l.account === a)!;

test('dominio: cada medio de pago llega a su cuenta; las comisiones se descuentan donde corresponde (TUU con IVA)', () => {
  assert.equal(accountForMethod('CASH'), 'CAJA'); assert.equal(accountForMethod('DEBIT'), 'TUU'); assert.equal(accountForMethod('CREDIT'), 'TUU');
  assert.equal(accountForMethod('TRANSFER'), 'BANCO'); assert.equal(accountForMethod('MERCADO_PAGO'), 'MP'); assert.equal(accountForMethod('RAPPI'), 'RAPPI'); assert.equal(accountForMethod('OTRO'), 'BANCO');
  assert.equal(accountForCharge({ paymentMethodCode: null, channelCode: 'MERCADO_LIBRE', mainPaymentCode: 'MERCADO_PAGO' }), 'MP');
  assert.equal(accountForCharge({ paymentMethodCode: null, channelCode: 'RAPPI', mainPaymentCode: 'RAPPI' }), 'RAPPI');
  assert.equal(accountForCharge({ paymentMethodCode: 'DEBIT', channelCode: 'LOCAL', mainPaymentCode: 'DEBIT' }), 'TUU');
  const r = computeMoney({
    start: START,
    payments: [{ methodCode: 'CASH', amount: 10000 }, { methodCode: 'DEBIT', amount: 20000 }, { methodCode: 'MERCADO_PAGO', amount: 7313 }, { methodCode: 'RAPPI', amount: 5000 }, { methodCode: 'TRANSFER', amount: 3000 }],
    charges: [{ paymentMethodCode: 'DEBIT', channelCode: 'LOCAL', mainPaymentCode: 'DEBIT', amount: 207 }, { paymentMethodCode: null, channelCode: 'MERCADO_LIBRE', mainPaymentCode: 'MERCADO_PAGO', amount: 1405 }, { paymentMethodCode: null, channelCode: 'RAPPI', mainPaymentCode: 'RAPPI', amount: 893 }],
    refunds: 0, outflows: [], moves: [],
  });
  assert.equal(get(r, 'CAJA').expected, 32000);
  assert.equal(get(r, 'TUU').fees, 246);                       // 207 × 1,19 = 246,33
  assert.equal(get(r, 'TUU').expected, 159150 + 20000 - 246);
  assert.equal(get(r, 'MP').expected, 482579 + 7313 - 1405);
  assert.equal(get(r, 'RAPPI').expected, 34495 + 5000 - 893);
  assert.equal(get(r, 'BANCO').expected, 311022);
  assert.equal(r.available, 32000 + 311022 + 488487); assert.equal(r.receivable, 178904 + 38602); assert.equal(r.total, r.available + r.receivable);
});

test('dominio: compras/gastos según "pagado con" (NONE no descuenta; sin indicar se resta del total), devoluciones desde la caja y traspasos', () => {
  const r = computeMoney({
    start: START, payments: [], charges: [], refunds: 1500,
    outflows: [{ amount: 100000, paidFrom: 'BANCO' }, { amount: 7350, paidFrom: 'CAJA' }, { amount: 432620, paidFrom: 'NONE' }, { amount: 4800, paidFrom: null }],
    moves: [{ from: 'TUU', to: 'BANCO', amount: 150000 }, { from: 'CAJA', to: 'EXTERNO', amount: 5000 }, { from: 'EXTERNO', to: 'MP', amount: 9999, voided: true }],
  });
  assert.equal(get(r, 'BANCO').expected, 308022 - 100000 + 150000);
  assert.equal(get(r, 'TUU').expected, 159150 - 150000);
  assert.equal(get(r, 'CAJA').expected, 22000 - 7350 - 1500 - 5000);
  assert.equal(get(r, 'MP').expected, 482579);                 // aporte anulado
  assert.equal(r.unassigned, 4800);
  const startTotal = Object.values(START).reduce((a, b) => a + b, 0);
  assert.equal(r.total, startTotal - 100000 - 7350 - 1500 - 5000 - 4800);   // el traspaso TUU→Banco no cambia el total
});

test('servicio: solo administrador; sin punto de partida no hay cálculo; luego suma lo registrado desde ese momento', async () => {
  const { db, svc } = world(); db.clock = new Date('2026-10-10T15:30:00-03:00');
  await assert.rejects(svc.money.status(s1), /permiso|autoriz|forbidden/i);
  const empty = await svc.money.status(admin); assert.equal(empty.start, null); assert.equal(empty.result, null);
  await assert.rejects(svc.money.addMove(admin, { date: '2026-10-10', from: 'TUU', to: 'BANCO', amount: 1000 }), /punto de partida/);
  await svc.money.setStart(admin, { balances: START, note: 'saldos reales' });
  db.moneyData = { payments: [{ methodCode: 'CASH', amount: 5000 }], charges: [], refunds: 0, salesCount: 1,
    outflows: [{ kind: 'EXPENSE', id: 'g1', date: '2026-10-10', label: 'Transporte · repartidor', amount: 4800, paidFrom: null }] };
  const st = await svc.money.status(admin);
  assert.equal(st.startDate, '2026-10-10'); assert.equal(db.moneyQueries.at(-1)!.sinceDate, '2026-10-10');
  assert.equal(st.result!.lines.find((l) => l.account === 'CAJA')!.expected, 27000); assert.equal(st.result!.unassigned, 4800);
  await svc.money.setSource(admin, 'EXPENSE', 'g1', 'CAJA');
  assert.equal(db.audit.at(-1)!.action, 'money.source'); assert.deepEqual(db.audit.at(-1)!.after, { paidFrom: 'CAJA' });
  await assert.rejects(svc.money.setSource(admin, 'EXPENSE', 'g1', 'BITCOIN'), /con qué se pagó/);
  await assert.rejects(svc.money.setSource(admin, 'PURCHASE', 'no-existe', 'BANCO'), /no encontrad|no existe|Compra/i);
});

test('servicio: traspasos validados, anulables una sola vez y con motivo', async () => {
  const { db, svc } = world(); db.clock = new Date('2026-10-10T15:30:00-03:00');
  await svc.money.setStart(admin, { balances: START });
  await assert.rejects(svc.money.addMove(admin, { date: '2026-10-10', from: 'BANCO', to: 'BANCO', amount: 1000 }), /distintos/);
  await assert.rejects(svc.money.addMove(admin, { date: '2026-10-10', from: 'TUU', to: 'BANCO', amount: 0 }), /mayor que 0/);
  await assert.rejects(svc.money.addMove(admin, { date: '2026-10-11', from: 'TUU', to: 'BANCO', amount: 1000 }), /futura/);
  await assert.rejects(svc.money.addMove(admin, { date: '2026-10-10', from: 'TUU', to: 'LUNA', amount: 1000 }), /Cuenta inválida/);
  await svc.money.addMove(admin, { date: '2026-10-10', from: 'TUU', to: 'BANCO', amount: 171796, note: 'abono TUU' });
  let st = await svc.money.status(admin);
  assert.equal(st.moves.length, 1); assert.equal(st.result!.lines.find((l) => l.account === 'BANCO')!.expected, 308022 + 171796);
  const id = st.moves[0].id;
  await assert.rejects(svc.money.voidMove(admin, id, ''), /motivo/);
  await svc.money.voidMove(admin, id, 'monto equivocado');
  await assert.rejects(svc.money.voidMove(admin, id, 'otra vez'), /ya está anulado/);
  st = await svc.money.status(admin);
  assert.equal(st.moves[0].voided, true); assert.equal(st.result!.lines.find((l) => l.account === 'BANCO')!.expected, 308022);
  await assert.rejects(svc.money.setStart(admin, { balances: { CAJA: -5 } }), /monto/);
});

test('compras y gastos guardan "pagado con" en la bitácora; un valor inválido se rechaza', async () => {
  const { db, svc } = world(); db.clock = new Date('2026-10-10T15:30:00-03:00');
  const cat = (await svc.expenses.categories(admin))[0];
  await svc.expenses.create(admin, { categoryId: cat.id, description: 'Papel film', expenseDate: '2026-10-10', totalAmount: 7350, paidFrom: 'CAJA' });
  const a = db.audit.find((e) => e.action === 'expense.create')!; assert.equal((a.after as { paidFrom: string }).paidFrom, 'CAJA');
  await assert.rejects(svc.expenses.create(admin, { categoryId: cat.id, description: 'Huevos', expenseDate: '2026-10-10', totalAmount: 27000, paidFrom: 'TARJETA' }), /con qué se pagó/);
});
