// DTO financiero: SOLO ADMINISTRADOR (tras assertCan('report.financial')). Nunca lo importa código del vendedor.
import type { Financial } from '../domain/charges/charges.ts';
import type { ChargeRecord } from '../repositories/ports.ts';
export interface SaleFinancialAdminDTO {
  saleId: string; financial: Financial;
  charges: { id: string; type: string; amount: number; addedAfterClose: boolean; voided: boolean; createdById: string; reason: string | null }[];
}
export function toSaleFinancialAdminDTO(saleId: string, financial: Financial, charges: ChargeRecord[]): SaleFinancialAdminDTO {
  return { saleId, financial: { ...financial }, charges: charges.map((c) => ({ id: c.id, type: c.type, amount: c.amount, addedAfterClose: c.addedAfterClose, voided: c.voidedAt !== null, createdById: c.createdById, reason: c.reason ?? null })) };
}
