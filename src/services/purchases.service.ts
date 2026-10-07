import { assertCan, type Actor } from '../core/permissions/permissions.ts';
import { notFound, businessRule, validation, duplicateDocument } from '../core/errors/index.ts';
import { parseQuantity, convertToBase, hasValidDecimals } from '../core/money/quantity.ts';
import type { Milli, Peso } from '../core/money/rounding.ts';
import { divRoundHalfUp } from '../core/money/rounding.ts';
import { buildDocumentKey, normalizeDocNumber, assertDocNumberRequired, planPurchaseLine, planPurchaseVoid, type DocType, type VoidPlan, type VoidItemState } from '../domain/purchases/purchases.ts';
import { planInflow } from '../domain/inventory/inventory.ts';
import type { CatalogReader, UnitOfWork, StockMovementRecord } from '../repositories/ports.ts';

export interface PurchaseLineInput { productId: string; presentationId?: string | null; quantity: string; unitCode?: string; unitCost?: Peso; lineAmount?: Peso }
export interface RegisterPurchaseInput { supplierId?: string | null; docType: DocType; docNumber?: string | null; docDate: string; pricesIncludeVat: boolean; lines: PurchaseLineInput[]; note?: string }
export interface Deps { uow: UnitOfWork; catalog: CatalogReader }
export interface VoidInput { adjusted: boolean; reason: string }

export function createPurchasesService({ uow, catalog }: Deps) {
  /** Reparte el valor retirado de un producto entre sus líneas (proporcional a cantidad; la última recibe el resto). */
  const allocate = (total: Peso, qtys: Milli[]): Peso[] => {
    const sum = qtys.reduce((a, b) => a + b, 0n); let left = total;
    return qtys.map((q, i) => { if (i === qtys.length - 1) return left; const v = Number(divRoundHalfUp(BigInt(total) * q, sum)); left -= v; return v; });
  };
  /** Agrupa por producto: la decisión EXACT/ADJUSTED es por producto y la compra ocupa seq consecutivos (stock bloqueado). */
  async function buildVoidInputs(tx: Parameters<Parameters<UnitOfWork['run']>[0]>[0], branchId: string, items: { id: string; productId: string; quantity: Milli; costBasis: Peso }[]) {
    const byProduct = new Map<string, typeof items>(); for (const it of items) byProduct.set(it.productId, [...(byProduct.get(it.productId) ?? []), it]);
    const groups: { productId: string; items: typeof items; state: VoidItemState }[] = [];
    for (const [productId, its] of byProduct) {
      const seqs: number[] = [];
      for (const it of its) { const s = await tx.inventory.purchaseMovementSeq(it.id); if (s === null) throw businessRule('Falta el movimiento de la compra.'); seqs.push(s); }
      const cur = await tx.inventory.lockState(branchId, productId);
      groups.push({ productId, items: its, state: { productId, qtyPurchased: its.reduce((a, b) => a + b.quantity, 0n), costBasis: its.reduce((a, b) => a + b.costBasis, 0), purchaseMovementSeq: Math.max(...seqs), current: cur } });
    }
    return groups;
  }

  return {
    /** Registra la compra y SUMA costBasis al valor del inventario por línea (ver reglas v0.5). Solo ADMINISTRADOR. */
    async register(actor: Actor | null, input: RegisterPurchaseInput): Promise<{ id: string }> {
      assertCan(actor, 'purchase.create');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.docDate)) throw validation('Fecha del documento inválida.');
      if (input.lines.length === 0) throw validation('La compra debe tener al menos una línea.');
      assertDocNumberRequired(input.docType, input.docNumber ?? null);
      const [products, units] = await Promise.all([catalog.loadProducts(input.lines.map((l) => l.productId)), catalog.loadUnits()]);
      const vatRecoverable = input.docType === 'FACTURA';
      const lines = input.lines.map((l) => {
        const p = products.get(l.productId); if (!p) throw validation('Producto inexistente.');
        if (p.kind !== 'GOODS') throw businessRule(`"${p.name}" es un servicio: no se compra para inventario.`);
        if (!p.isActive) throw businessRule(`El producto "${p.name}" está inactivo.`);
        if ((l.unitCost === undefined) === (l.lineAmount === undefined)) throw validation(`"${p.name}": indica el costo unitario O el total de la línea (uno solo).`);
        if (l.presentationId && l.unitCost !== undefined) throw validation(`"${p.name}": con presentación se ingresa el TOTAL de la línea (no un costo unitario).`);
        let entered: Milli; try { entered = parseQuantity(l.quantity); } catch { throw validation(`Cantidad inválida para "${p.name}".`); }
        if (entered <= 0n) throw validation(`La cantidad de "${p.name}" debe ser mayor que 0.`);
        let qty: Milli, enteredUnit: string;
        if (l.presentationId) {
          const pr = p.presentations.find((x) => x.id === l.presentationId); if (!pr) throw validation('La presentación no pertenece a este producto.');
          if (entered % 1000n !== 0n) throw validation(`"${pr.name}": se compra en envases enteros.`);
          qty = (entered / 1000n) * pr.baseQuantity; enteredUnit = pr.name;
        } else {
          const from = l.unitCode ? units.get(l.unitCode) : p.unit; if (!from) throw validation('Unidad desconocida.');
          if (!hasValidDecimals(entered, from.maxDecimals)) throw validation(`"${p.name}": la unidad ${from.code} admite ${from.maxDecimals} decimales.`);
          qty = from.code === p.unit.code ? entered : convertToBase(entered, from, p.unit); enteredUnit = from.code;
          if (qty <= 0n) throw validation(`La cantidad de "${p.name}" es demasiado pequeña.`);
        }
        // el costo ingresado es el TOTAL de la línea (obligatorio con presentación); el costo por unidad base se DERIVA (costBasis ÷ cantidad base) y no se guarda
        const plan = planPurchaseLine({ quantityBase: qty, pricesIncludeVat: input.pricesIncludeVat, vatRecoverable,
          entered: l.unitCost !== undefined ? { kind: 'unitCost', amount: l.unitCost } : { kind: 'lineAmount', amount: l.lineAmount! } });
        return { productId: p.id, presentationId: l.presentationId ?? null, nameSnapshot: p.name, enteredQuantity: entered, enteredUnit, quantity: qty, ...plan };
      });
      const docNumber = normalizeDocNumber(input.docNumber ?? null);
      const key = buildDocumentKey({ supplierId: input.supplierId ?? null, docType: input.docType, docNumber, status: 'CONFIRMED' });
      return uow.run(async (tx) => {
        if (key) { const dup = await tx.purchases.findByDocumentKey(key); if (dup) throw duplicateDocument(dup.docDate); }
        const sum = (f: 'lineNet' | 'lineVat' | 'lineTotal') => lines.reduce((s, l) => s + l[f], 0);
        const { purchase, items } = await tx.purchases.insert({
          branchId: actor.branchId, supplierId: input.supplierId ?? null, docType: input.docType, docNumber, docDate: input.docDate, status: 'CONFIRMED',
          pricesIncludeVat: input.pricesIncludeVat, vatRecoverable, netAmount: sum('lineNet'), vatAmount: sum('lineVat'), totalAmount: sum('lineTotal'), documentKey: key, createdById: actor.userId, note: input.note ?? null,
        }, lines);
        for (const it of items) {
          const st = await tx.inventory.lockState(actor.branchId, it.productId);
          const m = planInflow(st, it.quantity, it.costBasis);
          await tx.inventory.saveState(actor.branchId, it.productId, { qty: m.qtyAfter, value: m.valueAfter, seq: m.seq });
          await tx.inventory.appendMovement({ branchId: actor.branchId, productId: it.productId, seq: m.seq, type: 'PURCHASE', quantity: m.quantity, quantityBefore: m.qtyBefore, quantityAfter: m.qtyAfter,
            valueChange: m.valueChange, valueAfter: m.valueAfter, purchaseItemId: it.id, createdById: actor.userId });
        }
        await tx.audit.write({ action: 'purchase.create', entity: 'Purchase', entityId: purchase.id, userId: actor.userId, after: { docType: input.docType, docNumber, total: purchase.totalAmount } });
        return { id: purchase.id };
      });
    },

    /** Vista previa (no escribe). Devuelve el plan por producto: modo, valor retirado, varianza o motivo de bloqueo. */
    async previewVoid(actor: Actor | null, purchaseId: string, adjusted: boolean): Promise<VoidPlan> {
      assertCan(actor, 'purchase.void');
      return uow.run(async (tx) => {
        const got = await tx.purchases.getWithItems(purchaseId); if (!got) throw notFound('Compra');
        if (got.purchase.status === 'VOIDED') throw businessRule('La compra ya está anulada.');
        const groups = await buildVoidInputs(tx, got.purchase.branchId, got.items);
        return planPurchaseVoid(groups.map((g) => g.state), { adjusted, reason: 'vista previa' });
      });
    },

    /** Anula (nunca borra). EXACT si fue lo último; ADJUSTED solo si el administrador lo pide. Libera documentKey. */
    async void(actor: Actor | null, purchaseId: string, input: VoidInput): Promise<void> {
      assertCan(actor, 'purchase.void');
      if (!input.reason.trim()) throw businessRule('Anular una compra exige un motivo.');
      await uow.run(async (tx) => {
        const got = await tx.purchases.getWithItems(purchaseId); if (!got) throw notFound('Compra');
        if (got.purchase.status === 'VOIDED') throw businessRule('La compra ya está anulada.');
        const groups = await buildVoidInputs(tx, got.purchase.branchId, got.items);
        const plan = planPurchaseVoid(groups.map((g) => g.state), input);
        if (plan.status === 'blocked') throw businessRule(plan.reason === 'STOCK_BELOW_PURCHASED' ? 'No se puede anular: ya se vendió parte de lo comprado (el stock actual es menor).' : 'Hubo movimientos posteriores: se requiere el procedimiento de anulación ajustada.', { reason: plan.reason, productId: plan.productId });
        for (const g of groups) {
          const out = plan.items.find((i) => i.productId === g.productId)!;
          const values = plan.mode === 'EXACT' ? g.items.map((i) => i.costBasis) : allocate(out.valueRemoved, g.items.map((i) => i.quantity));
          let st = await tx.inventory.lockState(got.purchase.branchId, g.productId);
          for (let k = 0; k < g.items.length; k++) {
            const it = g.items[k]; const next = { qty: st.qty - it.quantity, value: st.value - values[k], seq: st.seq + 1 };
            const mv: StockMovementRecord = { branchId: got.purchase.branchId, productId: g.productId, seq: next.seq, type: 'PURCHASE_VOID', quantity: -it.quantity, quantityBefore: st.qty, quantityAfter: next.qty,
              valueChange: -values[k], valueAfter: next.value, purchaseItemId: it.id, note: input.reason, createdById: actor.userId };
            await tx.inventory.saveState(got.purchase.branchId, g.productId, next); await tx.inventory.appendMovement(mv); st = next;
          }
        }
        await tx.purchases.markVoided(purchaseId, { reason: input.reason, userId: actor.userId, mode: plan.mode, variance: plan.totalVariance });
        await tx.audit.write({ action: 'purchase.void', entity: 'Purchase', entityId: purchaseId, userId: actor.userId, metadata: { reason: input.reason, mode: plan.mode } });
        if (plan.mode === 'ADJUSTED') await tx.audit.write({ action: 'purchase.void_adjusted', entity: 'Purchase', entityId: purchaseId, userId: actor.userId, before: { documentCost: got.items.reduce((s, i) => s + i.costBasis, 0) }, after: { valueRemoved: plan.items.reduce((s, i) => s + i.valueRemoved, 0), variance: plan.totalVariance }, metadata: { reason: input.reason } });
      });
    },
  };
}
export type PurchasesService = ReturnType<typeof createPurchasesService>;
