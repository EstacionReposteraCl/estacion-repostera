/**
 * "Dinero disponible": cuánto dinero debería tener el negocio y dónde, a partir de un punto de partida
 * (saldos reales contados por el administrador) más todo lo registrado DESPUÉS de ese momento.
 *
 *   esperado(cuenta) = saldo de partida
 *                    + cobros de ventas en esa cuenta − comisiones que descuenta esa plataforma
 *                    − compras y gastos pagados desde esa cuenta − devoluciones (se asumen en efectivo)
 *                    ± traspasos, retiros y aportes
 *
 * Cuentas "disponibles": Caja (efectivo), Banco, Mercado Pago (disponible + por liberar).
 * Cuentas "por cobrar": TUU (ventas con tarjeta que TUU aún no abona) y Rappi.
 * Cuando TUU o Rappi depositan, se registra un traspaso TUU → Banco / Rappi → Banco.
 * Funciones puras: sin base de datos.
 */
export const ACCOUNTS = ['CAJA', 'BANCO', 'MP', 'TUU', 'RAPPI'] as const;
export type Account = (typeof ACCOUNTS)[number];
export const AVAILABLE: readonly Account[] = ['CAJA', 'BANCO', 'MP'];
export const RECEIVABLE: readonly Account[] = ['TUU', 'RAPPI'];
export const ACCOUNT_LABEL: Record<Account, string> = { CAJA: 'Caja (efectivo)', BANCO: 'Banco', MP: 'Mercado Pago', TUU: 'TUU por cobrar', RAPPI: 'Rappi por cobrar' };

/** Con qué se pagó una compra o gasto. NONE = crédito del proveedor, tarjeta personal o capital propio: no sale del dinero del negocio. */
export const PAID_FROM = ['CAJA', 'BANCO', 'MP', 'NONE'] as const;
export type PaidFrom = (typeof PAID_FROM)[number];
export const PAID_FROM_LABEL: Record<PaidFrom, string> = { CAJA: 'Efectivo de la caja', BANCO: 'Banco (transferencia o débito)', MP: 'Mercado Pago', NONE: 'Crédito / capital propio (no sale del dinero del negocio)' };
export const isPaidFrom = (v: unknown): v is PaidFrom => typeof v === 'string' && (PAID_FROM as readonly string[]).includes(v);

/** Para traspasos: EXTERNO = fuera del negocio (retiro personal o aporte de capital). */
export type MoveEnd = Account | 'EXTERNO';
export const isMoveEnd = (v: unknown): v is MoveEnd => v === 'EXTERNO' || (typeof v === 'string' && (ACCOUNTS as readonly string[]).includes(v));

/** TUU descuenta su comisión con IVA (0,71% + $65, más IVA); el sistema guarda la comisión neta. */
export const TUU_FEE_VAT_FACTOR = 1.19;

/** A qué cuenta llega el dinero de un medio de pago. */
export function accountForMethod(code: string | null | undefined): Account {
  switch (code) {
    case 'CASH': return 'CAJA';
    case 'DEBIT': case 'CREDIT': case 'HISTORICO_TUU': return 'TUU';
    case 'MERCADO_PAGO': return 'MP';
    case 'RAPPI': return 'RAPPI';
    default: return 'BANCO';
  }
}

/** Cuenta que soporta un cargo de una venta: la del pago que lo originó; si no, la plataforma del canal; si no, el pago principal. */
export function accountForCharge(c: { paymentMethodCode: string | null; channelCode: string; mainPaymentCode: string | null }): Account {
  if (c.paymentMethodCode) return accountForMethod(c.paymentMethodCode);
  if (c.channelCode === 'MERCADO_LIBRE') return 'MP';
  if (c.channelCode === 'RAPPI') return 'RAPPI';
  return accountForMethod(c.mainPaymentCode);
}

export interface MoneyInputs {
  start: Record<Account, number>;
  payments: { methodCode: string; amount: number }[];
  charges: { paymentMethodCode: string | null; channelCode: string; mainPaymentCode: string | null; amount: number }[];
  refunds: number;
  outflows: { amount: number; paidFrom: PaidFrom | null }[];
  moves: { from: MoveEnd; to: MoveEnd; amount: number; voided?: boolean }[];
}
export interface AccountLine { account: Account; start: number; sales: number; fees: number; outflows: number; movesIn: number; movesOut: number; expected: number }
export interface MoneyResult { lines: AccountLine[]; available: number; receivable: number; unassigned: number; total: number }

export function computeMoney(i: MoneyInputs): MoneyResult {
  const L = new Map<Account, AccountLine>(ACCOUNTS.map((a) => [a, { account: a, start: i.start[a] ?? 0, sales: 0, fees: 0, outflows: 0, movesIn: 0, movesOut: 0, expected: 0 }]));
  for (const p of i.payments) L.get(accountForMethod(p.methodCode))!.sales += p.amount;
  for (const c of i.charges) { const a = accountForCharge(c); L.get(a)!.fees += a === 'TUU' ? Math.round(c.amount * TUU_FEE_VAT_FACTOR) : c.amount; }
  L.get('CAJA')!.outflows += i.refunds;
  let unassigned = 0;
  for (const o of i.outflows) { if (o.paidFrom === null) unassigned += o.amount; else if (o.paidFrom !== 'NONE') L.get(o.paidFrom)!.outflows += o.amount; }
  for (const m of i.moves) {
    if (m.voided) continue;
    if (m.from !== 'EXTERNO') L.get(m.from)!.movesOut += m.amount;
    if (m.to !== 'EXTERNO') L.get(m.to)!.movesIn += m.amount;
  }
  const lines = ACCOUNTS.map((a) => { const l = L.get(a)!; l.expected = l.start + l.sales - l.fees - l.outflows + l.movesIn - l.movesOut; return l; });
  const sum = (as: readonly Account[]) => lines.filter((l) => as.includes(l.account)).reduce((s, l) => s + l.expected, 0);
  const available = sum(AVAILABLE); const receivable = sum(RECEIVABLE);
  return { lines, available, receivable, unassigned, total: available + receivable - unassigned };
}
