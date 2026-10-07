import { assertCan, type Actor } from '../core/permissions/permissions.ts';
import { notFound, businessRule, validation } from '../core/errors/index.ts';
import { parseQuantity, formatQuantity } from '../core/money/quantity.ts';
import { type Peso } from '../core/money/rounding.ts';
import { planOutflow, planInflow, planCostCorrection, reconcile, type MovementPlan } from '../domain/inventory/inventory.ts';
import { planCountAdjustment } from '../domain/inventory/count-adjust.ts';
import type { CatalogReader, UnitOfWork, StockMovementRecord } from '../repositories/ports.ts';

export interface Deps { uow: UnitOfWork; catalog: CatalogReader }
type WasteReason = 'EXPIRED' | 'DAMAGED' | 'SPILLAGE' | 'THEFT_LOSS' | 'OTHER';

export function createInventoryService({ uow, catalog }: Deps) {
  async function goods(productId: string) {
    const p = (await catalog.loadProducts([productId])).get(productId); if (!p) throw notFound('Producto');
    if (p.kind !== 'GOODS') throw businessRule('Un servicio no tiene inventario.'); return p;
  }
  const rec = (a: Actor, productId: string, type: StockMovementRecord['type'], m: MovementPlan, note?: string): StockMovementRecord => ({ branchId: a.branchId, productId, seq: m.seq, type, quantity: m.quantity,
    quantityBefore: m.qtyBefore, quantityAfter: m.qtyAfter, valueChange: m.valueChange, valueAfter: m.valueAfter, note: note ?? null, createdById: a.userId });
  const need = (note: string, what: string) => { if (!note || !note.trim()) throw validation(`${what} exige una nota.`); };

  return {
    /** Vendedor y administrador ven CANTIDAD; nunca valor. */
    async stockOf(actor: Actor | null, productId: string): Promise<{ qty: string }> {
      assertCan(actor, 'inventory.read.stock'); await goods(productId);
      const st = await uow.run((tx) => tx.inventory.lockState(actor.branchId, productId));
      return { qty: formatQuantity(st.qty) };
    },

    /** Saldo inicial: solo si el producto no tiene movimientos. Valor total en pesos enteros. */
    async openingBalance(actor: Actor | null, i: { productId: string; qty: string; totalValue: Peso; note?: string }): Promise<void> {
      assertCan(actor, 'inventory.adjust'); await goods(i.productId);
      const q = parseQuantity(i.qty); if (q <= 0n) throw validation('La cantidad inicial debe ser mayor que 0.');
      if (!Number.isSafeInteger(i.totalValue) || i.totalValue < 0) throw validation('Valor inicial inválido.');
      await uow.run(async (tx) => {
        if (await tx.inventory.hasAnyMovement(actor.branchId, i.productId)) throw businessRule('El producto ya tiene movimientos: no admite saldo inicial.');
        const st = await tx.inventory.lockState(actor.branchId, i.productId); const m = planInflow(st, q, i.totalValue);
        await tx.inventory.saveState(actor.branchId, i.productId, { qty: m.qtyAfter, value: m.valueAfter, seq: m.seq });
        await tx.inventory.appendMovement(rec(actor, i.productId, 'OPENING_BALANCE', m, i.note));
        await tx.audit.write({ action: 'inventory.opening_balance', entity: 'Product', entityId: i.productId, userId: actor.userId, after: { qty: i.qty, totalValue: i.totalValue } });
      });
    },

    /** Conteo físico (solo ADMINISTRADOR; nota obligatoria; auditado). Faltante y sobrante con stock: costo promedio vigente.
     *  Sobrante sin stock/costo previo: exige `unitCost` explícito (nunca se valora en $0 ni se inventa). Ver docs/DECISIONES.md. */
    async countAdjust(actor: Actor | null, i: { productId: string; countedQty: string; note: string; groupId?: string; unitCost?: Peso }): Promise<void> {
      assertCan(actor, 'inventory.adjust'); need(i.note, 'El ajuste de inventario'); await goods(i.productId);
      let counted: bigint; try { counted = parseQuantity(i.countedQty); } catch { throw validation('Cantidad contada inválida.'); }
      await uow.run(async (tx) => {
        const st = await tx.inventory.lockState(actor.branchId, i.productId);
        const plan = planCountAdjustment(st, counted, i.unitCost); if (!plan) return;
        const m = plan.movement;
        await tx.inventory.saveState(actor.branchId, i.productId, { qty: m.qtyAfter, value: m.valueAfter, seq: m.seq });
        await tx.inventory.appendMovement(rec(actor, i.productId, 'ADJUSTMENT', m, i.note));
        await tx.audit.write({ action: 'inventory.adjust', entity: 'Product', entityId: i.productId, userId: actor.userId,
          before: { qty: formatQuantity(m.qtyBefore), inventoryValue: st.value }, after: { qty: formatQuantity(m.qtyAfter), inventoryValue: m.valueAfter },
          metadata: { note: i.note, groupId: i.groupId, valuation: plan.valuation, unitCost: plan.unitCost, valueChange: m.valueChange } });
      });
    },

    async registerWaste(actor: Actor | null, i: { productId: string; qty: string; reason: WasteReason; note: string }): Promise<void> {
      assertCan(actor, 'inventory.waste'); need(i.note, 'La merma'); await goods(i.productId);
      const q = parseQuantity(i.qty); if (q <= 0n) throw validation('La cantidad de merma debe ser mayor que 0.');
      await uow.run(async (tx) => {
        const st = await tx.inventory.lockState(actor.branchId, i.productId); const m = planOutflow(st, q);
        await tx.inventory.saveState(actor.branchId, i.productId, { qty: m.qtyAfter, value: m.valueAfter, seq: m.seq });
        await tx.inventory.appendMovement({ ...rec(actor, i.productId, 'WASTE', m, i.note) });
        await tx.audit.write({ action: 'inventory.waste', entity: 'Product', entityId: i.productId, userId: actor.userId, metadata: { reason: i.reason, qty: i.qty } });
      });
    },

    /** Excepcional: cantidad 0, motivo obligatorio, AuditLog con antes/después. */
    async correctCost(actor: Actor | null, i: { productId: string; newInventoryValue: Peso; note: string }): Promise<void> {
      assertCan(actor, 'inventory.cost_correction'); await goods(i.productId);
      await uow.run(async (tx) => {
        const st = await tx.inventory.lockState(actor.branchId, i.productId); const m = planCostCorrection(st, i.newInventoryValue, i.note);
        await tx.inventory.saveState(actor.branchId, i.productId, { qty: m.qtyAfter, value: m.valueAfter, seq: m.seq });
        await tx.inventory.appendMovement(rec(actor, i.productId, 'COST_CORRECTION', m, i.note));
        await tx.audit.write({ action: 'cost.correction', entity: 'Product', entityId: i.productId, userId: actor.userId, before: { inventoryValue: st.value }, after: { inventoryValue: m.valueAfter }, metadata: { note: i.note } });
      });
    },

    /** Prueba K por producto. */
    async reconcile(actor: Actor | null, productId: string): Promise<{ ok: boolean; errors: string[] }> {
      assertCan(actor, 'audit.read');
      return uow.run(async (tx) => {
        const st = await tx.inventory.lockState(actor.branchId, productId); const mv = await tx.inventory.listMovements(actor.branchId, productId);
        const errors = reconcile(mv.map((x) => ({ seq: x.seq, quantity: x.quantity, valueChange: x.valueChange, qtyBefore: x.quantityBefore, qtyAfter: x.quantityAfter, valueAfter: x.valueAfter })), st);
        return { ok: errors.length === 0, errors };
      });
    },
  };
}
export type InventoryService = ReturnType<typeof createInventoryService>;
