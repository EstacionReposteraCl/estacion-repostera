// DTO de producto. El del VENDEDOR se arma campo a campo y NUNCA lee `row.adminOnly`.
import type { ProductSearchRow } from '../repositories/ports.ts';
import { formatQuantity } from '../core/money/quantity.ts';
import { lineTotalPerBase } from '../core/money/iva.ts';
import { averageCostDisplay } from '../domain/inventory/inventory.ts';
import { assertNoSensitiveKeys } from './sensitive.ts';

export interface ProductPublicDTO { id: string; sku: string; name: string; unit: string; salePrice: number; stock: string | null; presentations: { id: string; name: string; salePrice: number }[] }
export interface ProductAdminDTO extends ProductPublicDTO { category: string | null; isActive: boolean; avgCost: string | null; inventoryValue: number | null }

export function toProductPublicDTO(r: ProductSearchRow): ProductPublicDTO {
  return assertNoSensitiveKeys({
    id: r.id, sku: r.sku, name: r.name, unit: r.unitCode, salePrice: r.salePrice, stock: r.stockQty === null ? null : formatQuantity(r.stockQty),
    presentations: r.presentations.map((p) => ({ id: p.id, name: p.name, salePrice: p.salePrice ?? lineTotalPerBase(p.baseQuantity, r.salePrice) })),
  });
}
/** Solo se llama tras assertCan('product.read.admin'). Los nombres `avgCost`/`inventoryValue` son sensibles A PROPÓSITO: este DTO jamás llega al vendedor. */
export function toProductAdminDTO(r: ProductSearchRow): ProductAdminDTO {
  const a = r.adminOnly; const qty = a?.stockQty ?? null;
  return { ...toProductPublicDTO(r), category: r.category, isActive: r.isActive, inventoryValue: a?.inventoryValue ?? null,
    avgCost: qty !== null && a?.inventoryValue != null ? averageCostDisplay({ qty, value: a.inventoryValue }) : null };
}
