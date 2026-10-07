import type { Peso } from '../../core/money/rounding.ts';
import { netFromGross } from '../../core/money/iva.ts';
import { validation } from '../../core/errors/index.ts';

export type ExpenseDocType = 'FACTURA' | 'BOLETA' | 'OTRO';
export interface ExpenseAmounts { netAmount: Peso; vatAmount: Peso; totalAmount: Peso; vatRecoverable: boolean; resultCost: Peso }

/**
 * Montos de un gasto a partir del TOTAL pagado (lo que dice el documento):
 *  - FACTURA: IVA recuperable (crédito fiscal). neto = redondeo(total ÷ 1,19); al resultado va el NETO.
 *    Si el documento trae neto e IVA explícitos y suman el total, se respetan tal cual.
 *  - BOLETA / OTRO / sin documento: IVA no recuperable; neto = total, IVA = 0; al resultado va el TOTAL.
 * Mismo criterio que las compras (costBasis): lo recuperable no es costo.
 */
export function planExpense(i: { docType: ExpenseDocType | null; totalAmount: Peso; netAmount?: Peso | null; vatAmount?: Peso | null }, rateHundredths = 1900): ExpenseAmounts {
  const t = i.totalAmount;
  if (!Number.isSafeInteger(t) || t <= 0) throw validation('El monto total debe ser un entero en pesos mayor que 0.');
  if (i.docType === 'FACTURA') {
    if (i.netAmount != null || i.vatAmount != null) {
      const n = i.netAmount ?? NaN, v = i.vatAmount ?? NaN;
      if (!Number.isSafeInteger(n) || !Number.isSafeInteger(v) || n < 0 || v < 0) throw validation('Neto e IVA deben ser enteros en pesos.');
      if (n + v !== t) throw validation(`Neto (${n}) + IVA (${v}) no suma el total (${t}).`);
      return { netAmount: n, vatAmount: v, totalAmount: t, vatRecoverable: true, resultCost: n };
    }
    const n = netFromGross(t, rateHundredths);
    return { netAmount: n, vatAmount: t - n, totalAmount: t, vatRecoverable: true, resultCost: n };
  }
  return { netAmount: t, vatAmount: 0, totalAmount: t, vatRecoverable: false, resultCost: t };
}
