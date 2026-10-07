import { assertCan, type Actor } from '../core/permissions/permissions.ts';
import { businessDateOf } from '../core/time/business-date.ts';
import { notFound, businessRule, insufficientStock, validation, idempotencyConflict, AppError } from '../core/errors/index.ts';
import { fingerprintOfRequest, fingerprintOfStored, sameOperation, type Fingerprint } from '../domain/sales/idempotency.ts';
import { planSale, type SaleInput } from '../domain/sales/sale-plan.ts';
import { planOutflow, planInflow } from '../domain/inventory/inventory.ts';
import { planChargesAtClose, buildFinancial, planLateCharge, planVoidCharge, type ChargeType } from '../domain/charges/charges.ts';
import type { CatalogReader, UnitOfWork, SaleRecord, SalesReader, SaleListRow, SaleMeta } from '../repositories/ports.ts';
import { canViewSale } from '../policies/sale.policy.ts';
import { assertChannelAndMethods } from '../domain/sales/channel-rules.ts';
import { saleScopeFor } from '../policies/sale.policy.ts';
import { toSaleFinancialAdminDTO, type SaleFinancialAdminDTO } from '../dto/sale-admin.dto.ts';
import { toSellerSaleDTO, type SellerSaleDTO } from '../dto/sales.dto.ts';

export interface Deps { uow: UnitOfWork; catalog: CatalogReader; sales: SalesReader; now?: () => Date }
export interface RequestMeta { ip?: string | null }

export function createSalesService({ uow, catalog, sales, now = () => new Date() }: Deps) {
  /** (interno, no expuesto) Misma clave: si es la misma operación (mismo usuario y mismo contenido) devuelve el resultado anterior; si no, CONFLICT auditado. */
  async function resolveReplay(actor: Actor, saleId: string, fp: Fingerprint, key: string): Promise<SellerSaleDTO> {
      const got = await uow.run((tx) => tx.sales.getWithItems(saleId));
      if (!got || !sameOperation(fp, fingerprintOfStored({ ...got.sale, items: got.items, payments: got.payments }))) { await auditIdempotencyConflict(actor, saleId, key); throw idempotencyConflict(saleId); }
      return toSellerSaleDTO(got.sale, got.items);   // mismo usuario y misma operación: no depende del día
  }

  async function auditIdempotencyConflict(actor: Actor, existingSaleId: string, key: string): Promise<void> {
      await uow.run((tx) => tx.audit.write({ action: 'sale.idempotency_conflict', entity: 'Sale', entityId: existingSaleId, userId: actor.userId, metadata: { idempotencyKey: key } }));
  }

  const today = async () => businessDateOf(now(), (await catalog.businessSettings()).timezone);
  return {
    /** Pie de página vigente para el comprobante (texto público). */
    async receiptFooter(actor: Actor | null): Promise<string | null> {
      assertCan(actor, actor?.role === 'ADMINISTRADOR' ? 'sale.read.any' : 'sale.read.own_today');
      return (await catalog.businessSettings()).receiptFooter ?? null;
    },
    /** Canales y medios de pago activos para la caja. */
    async posOptions(actor: Actor | null): Promise<{ channels: { id: string; code: string; name: string }[]; methods: { id: string; code: string; name: string }[]; today: string }> {
      assertCan(actor, 'sale.create');
      const [channels, methods, d] = await Promise.all([catalog.listChannels(), catalog.listPaymentMethods(), today()]);
      return { channels, methods, today: d };
    },

    /** Listado del ADMINISTRADOR (todas las ventas del rango, incluidas anuladas). Sin costos. */
    async listAdmin(actor: Actor | null, f: { from?: string; to?: string; status?: 'COMPLETED' | 'VOIDED' }): Promise<{ from: string; to: string; rows: SaleListRow[]; totals: { count: number; total: number } }> {
      assertCan(actor, 'sale.read.any');
      const d = await today(); const from = f.from || d; const to = f.to || from;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw validation('Rango de fechas inválido.');
      const r = await sales.listAdmin(actor.branchId, { from, to, status: f.status, limit: 500 });
      return { from, to, ...r };
    },

    /** Datos visibles de una venta (canal, vendedor, pagos) con el MISMO alcance que el comprobante: vendedor solo las suyas de hoy. */
    async metaForActor(actor: Actor | null, saleId: string): Promise<SaleMeta> {
      assertCan(actor, actor?.role === 'ADMINISTRADOR' ? 'sale.read.any' : 'sale.read.own_today');
      await this.getSaleForActor(actor, saleId, true);               // aplica canViewSale (NOT_FOUND si no corresponde)
      const m = await sales.meta(saleId); if (!m) throw notFound('Venta'); return m;
    },

    /** Cierra una venta en UNA transacción (ver docs/OPERACIONES.md §Ventas). Devuelve solo el DTO seguro para el vendedor. */
    async closeSale(actor: Actor | null, input: SaleInput): Promise<SellerSaleDTO> {
      assertCan(actor, 'sale.create');
      if (!input.idempotencyKey?.trim()) throw validation('Falta la clave de idempotencia.');
      const [products, units, rules, settings] = await Promise.all([catalog.loadProducts(input.lines.map((l) => l.productId)), catalog.loadUnits(), catalog.loadFeeRules(), catalog.businessSettings()]);
      // Reintento: solo es "la misma venta" si es EXACTAMENTE la misma operación; si no, conflicto auditado (no se toca nada).
      let fp: Fingerprint; try { fp = fingerprintOfRequest(actor.userId, input, products); } catch { throw validation('Cantidad inválida en una línea.'); }
      const existing = await catalog.findSaleByIdempotencyKey(input.idempotencyKey);
      if (existing) return resolveReplay(actor, existing.id, fp, input.idempotencyKey);
      const [channel, methods] = await Promise.all([catalog.loadChannel(input.channelId), catalog.loadPaymentMethods(input.payments.map((p) => p.methodId))]);
      assertChannelAndMethods(channel, input.payments.map((p) => p.methodId), methods);
      const plan = planSale(input, { actor, products, units, vatRate: settings.vatRate });
      const charges = planChargesAtClose({ total: plan.total, channelId: input.channelId, payments: input.payments, rules });
      const soldAt = now();
      let saleId: string;
      try { saleId = await uow.run(async (tx) => {
        const dup = await tx.sales.findByIdempotencyKey(input.idempotencyKey);
        if (dup) {                                                  // carrera: otra petición con la misma clave ganó
          const got = await tx.sales.getWithItems(dup.id);
          if (!got || !sameOperation(fp, fingerprintOfStored({ ...got.sale, items: got.items, payments: got.payments }))) throw idempotencyConflict(dup.id);
          return dup.id;
        }
        const folio = await tx.sales.nextFolio(actor.branchId);
        const { sale, items } = await tx.sales.insert({
          branchId: actor.branchId, folio, channelId: input.channelId, status: 'COMPLETED', soldAt, businessDate: businessDateOf(soldAt, settings.timezone),
          netTotal: plan.net, vatTotal: plan.vat, total: plan.total, idempotencyKey: input.idempotencyKey, createdById: actor.userId, externalRef: input.externalRef?.trim() || null, note: input.note?.trim() || null,
          issuerSnapshot: { legalName: settings.legalName, taxId: settings.taxId, address: settings.address },
        }, plan.lines, input.payments);
        let cogs = 0;
        // orden estable por productId para evitar interbloqueos entre ventas concurrentes
        for (const item of [...items].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : a.lineNumber - b.lineNumber))) {
          if (item.kind !== 'GOODS') continue;
          const state = await tx.inventory.lockState(actor.branchId, item.productId);
          if (item.quantity > state.qty) throw insufficientStock(item.nameSnapshot);
          const m = planOutflow(state, item.quantity);
          await tx.inventory.saveState(actor.branchId, item.productId, { qty: m.qtyAfter, value: m.valueAfter, seq: m.seq });
          await tx.inventory.appendMovement({ branchId: actor.branchId, productId: item.productId, seq: m.seq, type: 'SALE', quantity: m.quantity, quantityBefore: m.qtyBefore,
            quantityAfter: m.qtyAfter, valueChange: m.valueChange, valueAfter: m.valueAfter, saleItemId: item.id, createdById: actor.userId });
          await tx.inventory.saveItemCost(item.id, -m.valueChange);
          cogs += -m.valueChange;
        }
        const manual = items.filter((i) => i.isManualPrice);
        if (manual.length) await tx.audit.write({ action: 'sale.price_override', entity: 'Sale', entityId: sale.id, userId: actor.userId,
          metadata: { channelId: input.channelId, lines: manual.map((i) => ({ productId: i.productId, name: i.nameSnapshot, catalogPrice: products.get(i.productId)?.salePrice ?? null, appliedPrice: i.unitPrice })) } });
        await tx.charges.insertMany(sale.id, charges, actor.userId);
        await tx.financial.insert(sale.id, buildFinancial(plan.net, cogs, charges.map((c) => c.amount)));
        return sale.id;
      }); } catch (e) {
        if (e instanceof AppError && e.code === 'CONFLICT' && typeof e.details?.existingSaleId === 'string') await auditIdempotencyConflict(actor, e.details.existingSaleId, input.idempotencyKey);
        throw e;
      }
      return this.getSaleForActor(actor, saleId, true);
    },

    /** Vendedor: solo SUS ventas de HOY; cualquier otra devuelve "no encontrado" (indistinguible de inexistente). */
    async getSaleForActor(actor: Actor | null, saleId: string, skipPerm = false): Promise<SellerSaleDTO> {
      if (!skipPerm) assertCan(actor, 'sale.read.own_today'); else if (!actor) assertCan(actor, 'sale.create');
      const a = actor!;
      const got = await uow.run((tx) => tx.sales.getWithItems(saleId));
      if (!got) throw notFound('Venta');
      const settings = await catalog.businessSettings();
      if (!canViewSale(a, got.sale, businessDateOf(now(), settings.timezone))) throw notFound('Venta');
      return toSellerSaleDTO(got.sale, got.items);
    },

    /** Reimpresión: vendedor solo sus ventas de hoy; administrador cualquiera. Queda en AuditLog ('sale.reprint'). */
    async reprintSale(actor: Actor | null, saleId: string, meta: RequestMeta = {}): Promise<SellerSaleDTO> {
      assertCan(actor, actor?.role === 'ADMINISTRADOR' ? 'sale.reprint.any' : 'sale.reprint.own_today');
      const dto = await this.getSaleForActor(actor, saleId, true);
      await uow.run((tx) => tx.audit.write({ action: 'sale.reprint', entity: 'Sale', entityId: saleId, userId: actor!.userId, ipAddress: meta.ip }));
      return dto;
    },

    /** "Mis ventas de hoy" (vendedor) o listado completo (administrador). El alcance se aplica en el lector. */
    async listSales(actor: Actor | null, limit = 50): Promise<SellerSaleDTO[]> {
      assertCan(actor, actor?.role === 'ADMINISTRADOR' ? 'sale.read.any' : 'sale.read.own_today');
      const a = actor!; const settings = await catalog.businessSettings();
      const rows = await sales.list(saleScopeFor(a, businessDateOf(now(), settings.timezone)), a.branchId, Math.min(Math.max(limit, 1), 200));
      const out: SellerSaleDTO[] = [];
      for (const r of rows) { const got = await uow.run((tx) => tx.sales.getWithItems(r.id)); if (got) out.push(toSellerSaleDTO(got.sale, got.items)); }
      return out;
    },

    /** Resultado financiero de una venta: SOLO ADMINISTRADOR. */
    async getSaleFinancial(actor: Actor | null, saleId: string): Promise<SaleFinancialAdminDTO> {
      assertCan(actor, 'report.financial');
      const r = await sales.financialOf(saleId); if (!r) throw notFound('Venta');
      return toSaleFinancialAdminDTO(saleId, r.financial, r.charges);
    },

    /** Solo ADMINISTRADOR, con motivo. Restaura cantidad y el COSTO CONGELADO (no el promedio actual). */
    async voidSale(actor: Actor | null, saleId: string, reason: string, meta: RequestMeta = {}): Promise<void> {
      assertCan(actor, 'sale.void');
      if (!reason.trim()) throw businessRule('Anular una venta exige un motivo.');
      await uow.run(async (tx) => {
        const got = await tx.sales.getWithItems(saleId);
        if (!got) throw notFound('Venta');
        if (got.sale.status === 'VOIDED') throw businessRule('La venta ya está anulada.');
        for (const item of got.items) {
          if (item.kind !== 'GOODS') continue;
          const frozen = await tx.inventory.getItemCost(item.id);
          if (frozen === null) throw businessRule('Falta el costo congelado de una línea.');
          const state = await tx.inventory.lockState(got.sale.branchId, item.productId);
          const m = planInflow(state, item.quantity, frozen);
          await tx.inventory.saveState(got.sale.branchId, item.productId, { qty: m.qtyAfter, value: m.valueAfter, seq: m.seq });
          await tx.inventory.appendMovement({ branchId: got.sale.branchId, productId: item.productId, seq: m.seq, type: 'SALE_VOID', quantity: m.quantity, quantityBefore: m.qtyBefore,
            quantityAfter: m.qtyAfter, valueChange: m.valueChange, valueAfter: m.valueAfter, saleItemId: item.id, note: reason, createdById: actor.userId });
        }
        await tx.sales.markVoided(saleId, reason, actor.userId);
        await tx.audit.write({ action: 'sale.void', entity: 'Sale', entityId: saleId, userId: actor.userId, metadata: { reason }, ipAddress: meta.ip });
      });
    },

    /** Cargo posterior (ML/Rappi/envío asumido/otros): solo ADMINISTRADOR. Recalcula totalCharges y realProfit + AuditLog. */
    async addLateCharge(actor: Actor | null, saleId: string, c: { type: ChargeType; amount: number; description?: string; reason: string }, meta: RequestMeta = {}): Promise<void> {
      assertCan(actor, 'sale.charge.add');
      await uow.run(async (tx) => {
        const got = await tx.sales.getWithItems(saleId); if (!got) throw notFound('Venta');
        const f = await tx.financial.lock(saleId); if (!f) throw notFound('Resultado de la venta');
        const plan = planLateCharge(actor, got.sale.status, f, c);
        await tx.charges.insertLate(saleId, c, actor.userId);
        await tx.financial.update(saleId, plan.financialAfter, actor.userId, now());
        await tx.audit.write({ action: plan.audit.action, entity: 'SaleFinancial', entityId: saleId, userId: actor.userId, before: plan.audit.before, after: plan.audit.after, metadata: c, ipAddress: meta.ip });
      });
    },

    async voidCharge(actor: Actor | null, chargeId: string, saleId: string, reason: string, meta: RequestMeta = {}): Promise<void> {
      assertCan(actor, 'sale.charge.void');
      await uow.run(async (tx) => {
        const got = await tx.sales.getWithItems(saleId); if (!got) throw notFound('Venta');
        const ch = await tx.charges.get(chargeId); if (!ch || ch.saleId !== saleId) throw notFound('Cargo');
        const f = await tx.financial.lock(saleId); if (!f) throw notFound('Resultado de la venta');
        const plan = planVoidCharge(actor, got.sale.status, f, { amount: ch.amount, voided: ch.voidedAt !== null }, reason);
        await tx.charges.void(chargeId, reason, actor.userId);
        await tx.financial.update(saleId, plan.financialAfter, actor.userId, now());
        await tx.audit.write({ action: plan.audit.action, entity: 'SaleFinancial', entityId: saleId, userId: actor.userId, before: plan.audit.before, after: plan.audit.after, metadata: { chargeId, reason }, ipAddress: meta.ip });
      });
    },
  };
}
export type SalesService = ReturnType<typeof createSalesService>;
export type { SaleRecord };
