// DTOs de salida. Lista blanca explícita: se construyen campo a campo, nunca se hace spread de un registro de BD.
import type { SaleRecord, SaleItemRecord } from '../repositories/ports.ts';
import { assertNoSensitiveKeys } from './sensitive.ts';

export interface SellerSaleLineDTO { lineNumber: number; name: string; quantity: string; unit: string; unitPrice: number; lineTotal: number }
export interface SellerSaleDTO {
  id: string; folio: number; soldAt: string; issuer: { legalName: string; taxId: string | null; address: string | null };
  lines: SellerSaleLineDTO[]; subtotal: number; vat: number; total: number; status: 'COMPLETED' | 'VOIDED';
}
const q3 = (m: bigint) => `${m / 1000n}.${(m % 1000n).toString().padStart(3, '0')}`;
export function toSellerSaleDTO(sale: SaleRecord, items: SaleItemRecord[]): SellerSaleDTO {
  return assertNoSensitiveKeys({
    id: sale.id, folio: sale.folio, soldAt: sale.soldAt.toISOString(), issuer: { ...sale.issuerSnapshot },
    lines: items.map((i) => ({ lineNumber: i.lineNumber, name: i.nameSnapshot, quantity: q3(i.enteredQuantity), unit: i.enteredUnit, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
    subtotal: sale.netTotal, vat: sale.vatTotal, total: sale.total, status: sale.status,
  });
}
// El administrador recibe además el resultado financiero por un DTO distinto (AdminSaleFinancialDTO) servido solo tras assertCan('report.financial').
