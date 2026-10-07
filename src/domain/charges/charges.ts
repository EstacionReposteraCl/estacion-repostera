import type { Peso } from '../../core/money/rounding.ts';
import { divRoundHalfUp } from '../../core/money/rounding.ts';
import { forbidden, businessRule, validation } from '../../core/errors/index.ts';
import type { Actor } from '../../core/permissions/permissions.ts';

export type ChargeType = 'PAYMENT_FEE' | 'CHANNEL_COMMISSION' | 'CHANNEL_FIXED_FEE' | 'SHIPPING_COST' | 'OTHER';
export interface FeeRuleDef { id: string; paymentMethodId: string | null; channelId: string | null; percentMilli: number /* 1,500% = 1500 */; fixedAmount: Peso; isManualPerSale: boolean; isActive: boolean }
export interface ChargePlan { type: ChargeType; amount: Peso; baseAmount: Peso | null; percentMilli: number | null; fixedApplied: Peso | null; paymentIndex: number | null; source: 'RULE'; addedAfterClose: false; ruleId: string }

/** % con 3 decimales: round(base × milli ÷ 100.000). 960 × 1,5% = 14. */
export function percentFee(base: Peso, percentMilli: number): Peso {
  if (percentMilli < 0 || !Number.isInteger(percentMilli)) throw validation('porcentaje inválido');
  return Number(divRoundHalfUp(BigInt(base) * BigInt(percentMilli), 100000n));
}

/**
 * Se aplican TODAS las reglas que correspondan y se SUMAN (una fila por regla):
 *  - regla del medio de pago: sobre el monto de cada pago -> PAYMENT_FEE
 *  - regla del canal: porcentaje sobre el total -> CHANNEL_COMMISSION; monto fijo -> CHANNEL_FIXED_FEE
 * Reglas "manual por venta" NO generan cargo al cierre: las agrega después el ADMINISTRADOR.
 */
export function planChargesAtClose(i: { total: Peso; channelId: string; payments: { methodId: string; amount: Peso }[]; rules: FeeRuleDef[] }): ChargePlan[] {
  const out: ChargePlan[] = [];
  i.payments.forEach((p, idx) => {
    const r = i.rules.find((x) => x.isActive && !x.isManualPerSale && x.paymentMethodId === p.methodId);
    if (!r) return;
    const amount = percentFee(p.amount, r.percentMilli) + r.fixedAmount;
    if (amount > 0) out.push({ type: 'PAYMENT_FEE', amount, baseAmount: p.amount, percentMilli: r.percentMilli, fixedApplied: r.fixedAmount, paymentIndex: idx, source: 'RULE', addedAfterClose: false, ruleId: r.id });
  });
  const ch = i.rules.find((x) => x.isActive && !x.isManualPerSale && x.channelId === i.channelId);
  if (ch) {
    const pct = percentFee(i.total, ch.percentMilli);
    if (pct > 0) out.push({ type: 'CHANNEL_COMMISSION', amount: pct, baseAmount: i.total, percentMilli: ch.percentMilli, fixedApplied: null, paymentIndex: null, source: 'RULE', addedAfterClose: false, ruleId: ch.id });
    if (ch.fixedAmount > 0) out.push({ type: 'CHANNEL_FIXED_FEE', amount: ch.fixedAmount, baseAmount: null, percentMilli: null, fixedApplied: ch.fixedAmount, paymentIndex: null, source: 'RULE', addedAfterClose: false, ruleId: ch.id });
  }
  return out;
}

export interface Financial { netTotal: Peso; costOfGoodsSold: Peso; grossProfit: Peso; totalCharges: Peso; realProfit: Peso }
export function buildFinancial(netTotal: Peso, cogs: Peso, charges: Peso[]): Financial {
  const totalCharges = charges.reduce((s, c) => s + c, 0);
  const grossProfit = netTotal - cogs;
  return { netTotal, costOfGoodsSold: cogs, grossProfit, totalCharges, realProfit: grossProfit - totalCharges };
}

export interface LateChargeInput { type: ChargeType; amount: Peso; description?: string; reason: string }
export interface LateChargePlan { financialAfter: Financial; audit: { action: 'sale.charge_added' | 'sale.charge_voided'; before: { totalCharges: Peso; realProfit: Peso }; after: { totalCharges: Peso; realProfit: Peso } } }

function guardAdminOnCompleted(actor: Actor, saleStatus: 'COMPLETED' | 'VOIDED') {
  if (actor.role !== 'ADMINISTRADOR') throw forbidden('Solo un administrador puede modificar cargos.');
  if (saleStatus !== 'COMPLETED') throw businessRule('No se pueden agregar cargos a una venta anulada.');
}
/** L1/L2/L5. Nunca toca netTotal, costOfGoodsSold ni grossProfit. */
export function planLateCharge(actor: Actor, saleStatus: 'COMPLETED' | 'VOIDED', f: Financial, c: LateChargeInput): LateChargePlan {
  guardAdminOnCompleted(actor, saleStatus);
  if (!Number.isSafeInteger(c.amount) || c.amount <= 0) throw validation('El monto del cargo debe ser un entero mayor que 0.');
  if (!c.reason.trim()) throw validation('El cargo posterior exige un motivo.');
  const totalCharges = f.totalCharges + c.amount;
  return { financialAfter: { ...f, totalCharges, realProfit: f.grossProfit - totalCharges },
    audit: { action: 'sale.charge_added', before: { totalCharges: f.totalCharges, realProfit: f.realProfit }, after: { totalCharges, realProfit: f.grossProfit - totalCharges } } };
}
/** L4: anular (no borrar) un cargo, con motivo. La venta puede estar anulada solo si se corrige historia; aquí se exige COMPLETED. */
export function planVoidCharge(actor: Actor, saleStatus: 'COMPLETED' | 'VOIDED', f: Financial, charge: { amount: Peso; voided: boolean }, reason: string): LateChargePlan {
  guardAdminOnCompleted(actor, saleStatus);
  if (charge.voided) throw businessRule('El cargo ya está anulado.');
  if (!reason.trim()) throw validation('Anular un cargo exige un motivo.');
  const totalCharges = f.totalCharges - charge.amount;
  if (totalCharges < 0) throw businessRule('Los cargos no pueden quedar negativos.');
  return { financialAfter: { ...f, totalCharges, realProfit: f.grossProfit - totalCharges },
    audit: { action: 'sale.charge_voided', before: { totalCharges: f.totalCharges, realProfit: f.realProfit }, after: { totalCharges, realProfit: f.grossProfit - totalCharges } } };
}
