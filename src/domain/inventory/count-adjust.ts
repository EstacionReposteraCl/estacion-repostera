import type { Milli, Peso } from '../../core/money/rounding.ts';
import { divRoundHalfUp } from '../../core/money/rounding.ts';
import { businessRule, validation } from '../../core/errors/index.ts';
import { planOutflow, planInflow, type InventoryState, type MovementPlan } from './inventory.ts';

export type Valuation = 'OUTFLOW_AT_AVERAGE' | 'SURPLUS_AT_AVERAGE' | 'SURPLUS_EXPLICIT_UNIT_COST';
export interface CountAdjustPlan { movement: MovementPlan; valuation: Valuation; unitCost: Peso | null }

/**
 * Conteo físico (regla aprobada):
 *  · faltante  -> sale al costo promedio vigente (igual que cualquier salida).
 *  · sobrante con stock y costo previos -> entra valorado al costo promedio vigente.
 *  · sobrante SIN stock previo (o sin valor previo) -> NO se valora en $0 ni se inventa un costo: el ADMINISTRADOR debe
 *    indicar un costo unitario explícito (pesos por unidad base). Valor = round(costo × cantidad).
 *  · un costo explícito solo se acepta en ese caso (nunca para sobrescribir el promedio ni en faltantes).
 * Devuelve null si no hay diferencia.
 */
export function planCountAdjustment(st: InventoryState, counted: Milli, explicitUnitCost?: Peso): CountAdjustPlan | null {
  const diff = counted - st.qty;
  if (diff === 0n) return null;
  if (diff < 0n) {
    if (explicitUnitCost !== undefined) throw validation('Un costo explícito no aplica a un faltante: sale al costo promedio.');
    return { movement: planOutflow(st, -diff), valuation: 'OUTFLOW_AT_AVERAGE', unitCost: null };
  }
  const needsExplicit = st.qty === 0n || st.value === 0;
  if (!needsExplicit) {
    if (explicitUnitCost !== undefined) throw validation('Hay stock con costo vigente: el sobrante se valora al costo promedio; no se acepta un costo explícito.');
    return { movement: planInflow(st, diff, Number(divRoundHalfUp(BigInt(st.value) * diff, st.qty))), valuation: 'SURPLUS_AT_AVERAGE', unitCost: null };
  }
  if (explicitUnitCost === undefined) throw businessRule('Sobrante sin stock ni costo previo: el administrador debe indicar un costo unitario explícito para incorporarlo.', { requiresUnitCost: true });
  if (!Number.isSafeInteger(explicitUnitCost) || explicitUnitCost <= 0) throw validation('El costo unitario explícito debe ser un entero en pesos mayor que 0.');
  const value = Number(divRoundHalfUp(BigInt(explicitUnitCost) * diff, 1000n));
  if (value <= 0) throw validation('Con ese costo unitario el valor del sobrante resulta $0: indica un costo mayor.');
  return { movement: planInflow(st, diff, value), valuation: 'SURPLUS_EXPLICIT_UNIT_COST', unitCost: explicitUnitCost };
}
