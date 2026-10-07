// Implementación de `Ports` (src/repositories/ports.ts) con Prisma 7 + PostgreSQL.
// ÚNICO lugar que importa el cliente generado. Reglas (ver README.md de esta carpeta):
//  - Decimal ↔ milésimas siempre por texto (decimalToMilli / formatQuantity), nunca Number.
//  - lockState = SELECT … FOR UPDATE; saveState es la ÚNICA vía que escribe StockLevel/ProductCost.
//  - nextFolio = UPDATE … RETURNING (atómico). Los triggers/CHECK de prisma/sql/20_reglas.sql son la red de seguridad.
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { prisma as defaultClient } from '../../core/db/client';
import type {
  Ports, Tx, UnitOfWork, CatalogReader, ProductReader, SalesReader, ReportReader, UserStore, AuthAdmin,
  SaleRecord, SaleItemRecord, ChargeRecord, StockMovementRecord, PurchaseRecord, PurchaseItemRecord, ProductSearchRow, ProductSaveInput, ProductListFilter,
} from '../ports';
import type { CatalogProduct } from '../../domain/sales/sale-plan';
import type { UnitDef } from '../../core/money/quantity';
import { decimalToMilli, formatQuantity } from '../../core/money/quantity';
import type { Financial, FeeRuleDef } from '../../domain/charges/charges';
import { validation } from '../../core/errors';

const milli = (d: Prisma.Decimal | string | null | undefined): bigint | null => (d == null ? null : decimalToMilli(typeof d === 'string' ? d : d.toFixed(3)));
/** Con signo: los movimientos guardan cantidades negativas (salidas). */
const M = (d: Prisma.Decimal | string): bigint => { const t = typeof d === 'string' ? d.trim() : d.toFixed(3); return t.startsWith('-') ? -decimalToMilli(t.slice(1)) : decimalToMilli(t); };
const dec = (m: bigint) => formatQuantity(m);
const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Decimal(12,6) → micro-unidades (bigint). */
const micro = (d: Prisma.Decimal) => { const [i, f = ''] = d.toFixed(6).split('.'); return BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, '0')); };
const unitDef = (u: { code: string; dimension: string; factorToBase: Prisma.Decimal; maxDecimals: number }): UnitDef =>
  ({ code: u.code, dimension: u.dimension as UnitDef['dimension'], factorToBase: micro(u.factorToBase), maxDecimals: u.maxDecimals });
/** Decimal(6,3) de porcentaje → milésimas de punto (1,500 % = 1500). */
const pctMilli = (d: Prisma.Decimal) => Number(M(d));

function saleRecord(s: Prisma.SaleGetPayload<object>): SaleRecord {
  const snap = (s.issuerSnapshot ?? {}) as { legalName?: string; taxId?: string | null; address?: string | null };
  return { id: s.id, branchId: s.branchId, folio: s.folio, channelId: s.channelId, status: s.status, soldAt: s.soldAt, businessDate: ymd(s.businessDate),
    netTotal: s.netTotal, vatTotal: s.vatTotal, total: s.total, idempotencyKey: s.idempotencyKey, createdById: s.createdById, externalRef: s.externalRef, note: s.note,
    voidReason: s.voidReason, issuerSnapshot: { legalName: snap.legalName ?? '', taxId: snap.taxId ?? null, address: snap.address ?? null } };
}
type ItemRow = Prisma.SaleItemGetPayload<{ include: { product: { select: { kind: true } } } }>;
function itemRecord(i: ItemRow): SaleItemRecord {
  return { id: i.id, saleId: i.saleId, lineNumber: i.lineNumber, productId: i.productId, kind: i.product.kind, presentationId: i.presentationId, presentationBaseQuantity: milli(i.presentationBaseQuantity),
    skuSnapshot: i.skuSnapshot ?? '', nameSnapshot: i.nameSnapshot, baseUnitSnapshot: i.baseUnitSnapshot, enteredQuantity: M(i.enteredQuantity), enteredUnit: i.enteredUnit, quantity: M(i.quantity),
    priceBasis: i.priceBasis, unitPrice: i.unitPrice, isManualPrice: i.isManualPrice, vatTreatment: i.vatTreatment, vatRate: Number(i.vatRate.toFixed(2)), lineTotal: i.lineTotal, lineNet: i.lineNet, lineVat: i.lineVat };
}
function chargeRecord(c: Prisma.SaleChargeGetPayload<object>): ChargeRecord {
  return { id: c.id, saleId: c.saleId, type: c.type, amount: c.amount, baseAmount: c.baseAmount, percentMilli: c.percentApplied ? pctMilli(c.percentApplied) : null, fixedApplied: c.fixedApplied,
    source: c.source as 'RULE', addedAfterClose: c.addedAfterClose as false, createdById: c.createdById, createdAt: c.createdAt, voidedAt: c.voidedAt, description: c.description, reason: c.voidReason ?? c.description ?? null };
}
function movementRecord(m: Prisma.StockMovementGetPayload<object>): StockMovementRecord {
  return { branchId: m.branchId, productId: m.productId, seq: m.seq, type: m.type, quantity: M(m.quantity), quantityBefore: M(m.quantityBefore), quantityAfter: M(m.quantityAfter),
    valueChange: m.valueChange, valueAfter: m.valueAfter, saleItemId: m.saleItemId, purchaseItemId: m.purchaseItemId, note: m.note, createdById: m.createdById };
}
function purchaseRecord(p: Prisma.PurchaseGetPayload<object>): PurchaseRecord {
  return { id: p.id, branchId: p.branchId, supplierId: p.supplierId, docType: p.docType, docNumber: p.docNumber, docDate: ymd(p.docDate), status: p.status, pricesIncludeVat: p.pricesIncludeVat,
    vatRecoverable: p.vatRecoverable, netAmount: p.netAmount, vatAmount: p.vatAmount, totalAmount: p.totalAmount, documentKey: p.documentKey, createdById: p.createdById, note: p.note,
    voidReason: p.voidReason, voidMode: p.voidMode, voidVariance: p.voidVariance };
}
function purchaseItemRecord(i: Prisma.PurchaseItemGetPayload<object>): PurchaseItemRecord {
  return { id: i.id, purchaseId: i.purchaseId, productId: i.productId, presentationId: i.presentationId, nameSnapshot: i.nameSnapshot, enteredQuantity: M(i.enteredQuantity), enteredUnit: i.enteredUnit,
    quantity: M(i.quantity), lineNet: i.lineNet, lineVat: i.lineVat, lineTotal: i.lineTotal, costBasis: i.costBasis };
}
const isUnique = (e: unknown, field?: string) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && (!field || JSON.stringify(e.meta ?? {}).includes(field));

// ---------------------------------------------------------------- productos (lectura)
const productInclude = (branchId: string, admin: boolean) => ({
  unit: true, category: true,
  presentations: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }] },
  barcodes: { where: { presentationId: null }, orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }] },
  stockLevels: { where: { branchId } },
  ...(admin ? { costs: { where: { branchId } } } : {}),
});
type ProductFull = Prisma.ProductGetPayload<{ include: { unit: true; category: true; presentations: true; barcodes: true; stockLevels: true; costs: true } }>;
function searchRow(p: ProductFull | Omit<ProductFull, 'costs'>, admin: boolean): ProductSearchRow {
  const sl = p.stockLevels[0]; const qty = p.kind === 'GOODS' ? (sl ? M(sl.quantity) : 0n) : null;
  const cost = 'costs' in p ? p.costs[0] : undefined;
  return {
    id: p.id, sku: p.sku, name: p.name, unitCode: p.unit.code, salePrice: p.salePrice, kind: p.kind, stockQty: qty, category: p.category?.name ?? null, isActive: p.isActive,
    brand: p.brand, barcodes: p.barcodes.map((b) => b.code), categoryId: p.categoryId, vatTreatment: p.vatTreatment,
    presentations: p.presentations.map((x) => ({ id: x.id, name: x.name, salePrice: x.salePrice, baseQuantity: M(x.baseQuantity) })),
    ...(admin ? { adminOnly: { inventoryValue: p.kind === 'GOODS' ? (cost?.inventoryValue ?? 0) : null, stockQty: qty } } : {}),
  };
}

export function createPrismaPorts(client: PrismaClient = defaultClient): Ports {
  const catalog: CatalogReader = {
    async loadProducts(ids) {
      const rows = await client.product.findMany({ where: { id: { in: [...new Set(ids)] } }, include: { unit: true, presentations: true } });
      return new Map(rows.map((p): [string, CatalogProduct] => [p.id, { id: p.id, sku: p.sku, name: p.name, kind: p.kind, isActive: p.isActive, vatTreatment: p.vatTreatment, salePrice: p.salePrice, unit: unitDef(p.unit),
        presentations: p.presentations.map((x) => ({ id: x.id, name: x.name, baseQuantity: M(x.baseQuantity), salePrice: x.salePrice, isActive: x.isActive })) }]));
    },
    async loadUnits() { return new Map((await client.unit.findMany({ where: { isActive: true } })).map((u) => [u.code, unitDef(u)])); },
    async loadFeeRules() {
      return (await client.feeRule.findMany()).map((r): FeeRuleDef => ({ id: r.id, paymentMethodId: r.paymentMethodId, channelId: r.channelId, percentMilli: pctMilli(r.percent), fixedAmount: r.fixedAmount, isManualPerSale: r.isManualPerSale, isActive: r.isActive }));
    },
    async businessSettings() {
      const s = await client.businessSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
      return { legalName: s.legalName, taxId: s.taxId, address: s.address, timezone: s.timezone, vatRate: Number(s.vatRate.toFixed(2)) };
    },
    async findSaleByIdempotencyKey(key) { const s = await client.sale.findUnique({ where: { idempotencyKey: key } }); return s ? saleRecord(s) : null; },
    async loadChannel(id) { return client.saleChannel.findUnique({ where: { id }, select: { id: true, isActive: true } }); },
    async loadPaymentMethods(ids) { return new Map((await client.paymentMethod.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } })).map((m) => [m.id, m])); },
  };

  const products: ProductReader = {
    async search(q, branchId, o) {
      const text = q.trim();
      const rows = await client.product.findMany({
        where: { AND: [o.includeInactive ? {} : { isActive: true }, { OR: [{ name: { contains: text, mode: 'insensitive' } }, { sku: { equals: text, mode: 'insensitive' } }, { barcodes: { some: { code: text } } }, { brand: { contains: text, mode: 'insensitive' } }] }] },
        include: productInclude(branchId, o.withAdminData), orderBy: { name: 'asc' }, take: o.limit,
      });
      // coincidencia exacta de código de barras o SKU primero (escáner)
      const exact = (p: (typeof rows)[number]) => (p.sku.toLowerCase() === text.toLowerCase() || p.barcodes.some((b) => b.code === text) ? 0 : 1);
      return rows.sort((a, b) => exact(a) - exact(b)).map((p) => searchRow(p as ProductFull, o.withAdminData));
    },
    async getById(id, branchId, admin) {
      const p = await client.product.findUnique({ where: { id }, include: productInclude(branchId, admin) });
      return p ? searchRow(p as ProductFull, admin) : null;
    },
    async listAdmin(branchId, f: ProductListFilter) {
      const text = f.q?.trim();
      const where: Prisma.ProductWhereInput = { AND: [
        f.status === 'archived' ? { isActive: false } : f.status === 'all' ? {} : { isActive: true },
        f.categoryId ? { categoryId: f.categoryId } : {},
        text ? { OR: [{ name: { contains: text, mode: 'insensitive' } }, { sku: { equals: text, mode: 'insensitive' } }, { barcodes: { some: { code: text } } }, { brand: { contains: text, mode: 'insensitive' } }] } : {},
      ] };
      const [total, rows] = await Promise.all([client.product.count({ where }),
        client.product.findMany({ where, include: productInclude(branchId, true), orderBy: { name: 'asc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize })]);
      return { total, rows: rows.map((p) => searchRow(p as ProductFull, true)) };
    },
    async referenceCosts(productIds) {
      const rows = await client.auditLog.findMany({ where: { action: 'product.import', entity: 'Product', entityId: { in: productIds } }, orderBy: { occurredAt: 'asc' }, select: { entityId: true, metadata: true } });
      const out = new Map<string, number>();
      for (const r of rows) { const c = (r.metadata as { referenceCost?: unknown } | null)?.referenceCost; if (r.entityId && Number.isSafeInteger(c) && (c as number) > 0) out.set(r.entityId, c as number); }
      return out;
    },
    async withMovements(branchId, productIds) {
      const rows = await client.stockMovement.groupBy({ by: ['productId'], where: { branchId, productId: { in: productIds } } });
      return new Set(rows.map((r) => r.productId));
    },
    async options() {
      const [units, categories] = await Promise.all([client.unit.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }), client.category.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } })]);
      return { units: units.map((u) => ({ code: u.code, name: u.name, symbol: u.symbol })), categories: categories.map((c) => ({ id: c.id, name: c.name })) };
    },
  };

  function tx(db: Prisma.TransactionClient): Tx {
    const paymentIds = new Map<string, string[]>();
    return {
      sales: {
        async findByIdempotencyKey(key) {
          // Bloqueo por clave hasta el fin de la transacción: una petición gemela espera, y al continuar ya VE la venta
          // confirmada (READ COMMITTED) y el servicio devuelve la original en vez de chocar con el índice único.
          await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'sale-idem:' + key}, 0))`;
          const s = await db.sale.findUnique({ where: { idempotencyKey: key } }); return s ? saleRecord(s) : null;
        },
        async nextFolio(branchId) {
          const r = await db.$queryRaw<{ n: number }[]>`UPDATE document_sequences SET "nextNumber" = "nextNumber" + 1 WHERE "branchId" = ${branchId} AND type = 'SALE' RETURNING "nextNumber" - 1 AS n`;
          if (!r[0]) throw new Error('Falta la secuencia de folios de la sucursal.');
          return Number(r[0].n);
        },
        async insert(s, items, payments) {
          const sale = await db.sale.create({ data: { branchId: s.branchId, folio: s.folio, channelId: s.channelId, status: s.status, soldAt: s.soldAt, businessDate: dateOnly(s.businessDate),
            netTotal: s.netTotal, vatTotal: s.vatTotal, total: s.total, idempotencyKey: s.idempotencyKey, createdById: s.createdById, externalRef: s.externalRef ?? null, note: s.note ?? null,
            issuerSnapshot: s.issuerSnapshot } });
          const recs: SaleItemRecord[] = [];
          for (const i of items) {
            const row = await db.saleItem.create({ data: { saleId: sale.id, lineNumber: i.lineNumber, productId: i.productId, presentationId: i.presentationId, presentationProductId: i.presentationId ? i.productId : null,
              presentationBaseQuantity: i.presentationBaseQuantity === null ? null : dec(i.presentationBaseQuantity), skuSnapshot: i.skuSnapshot, nameSnapshot: i.nameSnapshot, baseUnitSnapshot: i.baseUnitSnapshot,
              enteredQuantity: dec(i.enteredQuantity), enteredUnit: i.enteredUnit, quantity: dec(i.quantity), priceBasis: i.priceBasis, unitPrice: i.unitPrice, isManualPrice: i.isManualPrice,
              vatTreatment: i.vatTreatment, vatRate: i.vatRate.toFixed(2), lineTotal: i.lineTotal, lineNet: i.lineNet, lineVat: i.lineVat }, include: { product: { select: { kind: true } } } });
            recs.push(itemRecord(row));
          }
          const ids: string[] = [];
          for (const p of payments) ids.push((await db.salePayment.create({ data: { saleId: sale.id, paymentMethodId: p.methodId, amount: p.amount } })).id);
          paymentIds.set(sale.id, ids);
          return { sale: saleRecord(sale), items: recs };
        },
        async getWithItems(id) {
          const s = await db.sale.findUnique({ where: { id }, include: { items: { include: { product: { select: { kind: true } } }, orderBy: { lineNumber: 'asc' } }, payments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
          if (!s) return null;
          return { sale: saleRecord(s), items: s.items.map(itemRecord), payments: s.payments.map((p) => ({ methodId: p.paymentMethodId, amount: p.amount })) };
        },
        async markVoided(id, reason, userId) { await db.sale.update({ where: { id }, data: { status: 'VOIDED', voidReason: reason, voidedAt: new Date(), voidedById: userId } }); },
      },
      inventory: {
        async lockState(branchId, productId) {
          await db.$executeRaw`INSERT INTO stock_levels (id, "branchId", "productId", quantity, "minQuantity", "movementSeq", "updatedAt") VALUES (gen_random_uuid()::text, ${branchId}, ${productId}, 0, 0, 0, now()) ON CONFLICT ("branchId", "productId") DO NOTHING`;
          await db.$executeRaw`INSERT INTO product_costs (id, "branchId", "productId", "inventoryValue", "updatedAt") VALUES (gen_random_uuid()::text, ${branchId}, ${productId}, 0, now()) ON CONFLICT ("branchId", "productId") DO NOTHING`;
          const r = await db.$queryRaw<{ quantity: string; seq: number; value: number }[]>`
            SELECT sl.quantity::text AS quantity, sl."movementSeq" AS seq, pc."inventoryValue" AS value
            FROM stock_levels sl JOIN product_costs pc ON pc."branchId" = sl."branchId" AND pc."productId" = sl."productId"
            WHERE sl."branchId" = ${branchId} AND sl."productId" = ${productId} FOR UPDATE OF sl, pc`;
          return { qty: M(r[0].quantity), value: Number(r[0].value), seq: Number(r[0].seq) };
        },
        async saveState(branchId, productId, s) {
          const a = await db.stockLevel.updateMany({ where: { branchId, productId }, data: { quantity: dec(s.qty), movementSeq: s.seq } });
          const b = await db.productCost.updateMany({ where: { branchId, productId }, data: { inventoryValue: s.value } });
          if (a.count !== 1 || b.count !== 1) throw new Error('saveState sin lockState previo');
        },
        async appendMovement(m) {
          await db.stockMovement.create({ data: { branchId: m.branchId, productId: m.productId, seq: m.seq, type: m.type, quantity: dec(m.quantity), quantityBefore: dec(m.quantityBefore), quantityAfter: dec(m.quantityAfter),
            valueChange: m.valueChange, valueAfter: m.valueAfter, saleItemId: m.saleItemId ?? null, purchaseItemId: m.purchaseItemId ?? null, note: m.note ?? null, createdById: m.createdById } });
        },
        async saveItemCost(saleItemId, lineCost) { await db.saleItemCost.create({ data: { saleItemId, lineCost } }); },
        async getItemCost(saleItemId) { return (await db.saleItemCost.findUnique({ where: { saleItemId } }))?.lineCost ?? null; },
        async purchaseMovementSeq(purchaseItemId) { return (await db.stockMovement.findUnique({ where: { purchaseItemId_type: { purchaseItemId, type: 'PURCHASE' } } }))?.seq ?? null; },
        async listMovements(branchId, productId) { return (await db.stockMovement.findMany({ where: { branchId, productId }, orderBy: { seq: 'asc' } })).map(movementRecord); },
        async hasAnyMovement(branchId, productId) { return (await db.stockMovement.count({ where: { branchId, productId } })) > 0; },
      },
      purchases: {
        async findByDocumentKey(key) { const p = await db.purchase.findUnique({ where: { documentKey: key } }); return p ? { id: p.id, docDate: ymd(p.docDate) } : null; },
        async insert(p, items) {
          const pur = await db.purchase.create({ data: { branchId: p.branchId, supplierId: p.supplierId, docType: p.docType, docNumber: p.docNumber, docDate: dateOnly(p.docDate), status: p.status,
            pricesIncludeVat: p.pricesIncludeVat, vatRecoverable: p.vatRecoverable, netAmount: p.netAmount, vatAmount: p.vatAmount, totalAmount: p.totalAmount, documentKey: p.documentKey, createdById: p.createdById, note: p.note ?? null } });
          const recs: PurchaseItemRecord[] = [];
          for (const i of items) recs.push(purchaseItemRecord(await db.purchaseItem.create({ data: { purchaseId: pur.id, productId: i.productId, presentationId: i.presentationId, presentationProductId: i.presentationId ? i.productId : null,
            nameSnapshot: i.nameSnapshot, enteredQuantity: dec(i.enteredQuantity), enteredUnit: i.enteredUnit, quantity: dec(i.quantity), lineNet: i.lineNet, lineVat: i.lineVat, lineTotal: i.lineTotal, costBasis: i.costBasis } })));
          return { purchase: purchaseRecord(pur), items: recs };
        },
        async getWithItems(id) { const p = await db.purchase.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } }); return p ? { purchase: purchaseRecord(p), items: p.items.map(purchaseItemRecord) } : null; },
        async markVoided(id, v) { await db.purchase.update({ where: { id }, data: { status: 'VOIDED', documentKey: null, voidReason: v.reason, voidedAt: new Date(), voidedById: v.userId, voidMode: v.mode, voidVariance: v.variance } }); },
      },
      products: {
        async findById(id) { const p = await db.product.findUnique({ where: { id }, include: { unit: true } }); return p ? { id: p.id, sku: p.sku, name: p.name, kind: p.kind, unitCode: p.unit.code, salePrice: p.salePrice, isActive: p.isActive } : null; },
        async hasMovements(productId) { return (await db.stockMovement.count({ where: { productId } })) > 0; },
        async save(i: ProductSaveInput) {
          const unit = await db.unit.findUnique({ where: { code: i.unitCode } }); if (!unit) throw validation('Unidad desconocida.');
          const data = { sku: i.sku.trim(), name: i.name.trim(), kind: i.kind, unitId: unit.id, salePrice: i.salePrice, categoryId: i.categoryId ?? null, vatTreatment: i.vatTreatment, brand: i.brand?.trim() || null };
          let id: string;
          try { id = i.id ? (await db.product.update({ where: { id: i.id }, data })).id : (await db.product.create({ data })).id; }
          catch (e) { if (isUnique(e, 'sku')) throw validation(`El SKU "${data.sku}" ya existe en otro producto.`); throw e; }
          if (i.barcodes) {
            const codes = [...new Set(i.barcodes.map((c) => c.trim()).filter(Boolean))];
            const taken = await db.productBarcode.findMany({ where: { code: { in: codes }, productId: { not: id } }, include: { product: { select: { name: true } } } });
            if (taken.length) throw validation(`El código ${taken[0].code} ya pertenece a "${taken[0].product.name}".`);
            await db.productBarcode.deleteMany({ where: { productId: id, presentationId: null, code: { notIn: codes } } });
            const have = new Set((await db.productBarcode.findMany({ where: { productId: id }, select: { code: true } })).map((b) => b.code));
            for (const [n, code] of codes.entries()) if (!have.has(code)) await db.productBarcode.create({ data: { productId: id, code, isPrimary: n === 0 } });
          }
          return { id };
        },
        async archive(id) { await db.product.update({ where: { id }, data: { isActive: false, archivedAt: new Date() } }); },
        async restore(id) { await db.product.update({ where: { id }, data: { isActive: true, archivedAt: null } }); },
        async ensureCategory(name) {
          const n = name.trim().replace(/\s+/g, ' ');
          const found = await db.category.findFirst({ where: { name: { equals: n, mode: 'insensitive' } } });
          if (found) { if (!found.isActive) await db.category.update({ where: { id: found.id }, data: { isActive: true } }); return { id: found.id, name: found.name }; }
          const c = await db.category.create({ data: { name: n } }); return { id: c.id, name: c.name };
        },
      },
      financial: {
        async insert(saleId, f) { await db.saleFinancial.create({ data: { saleId, ...f } }); },
        async lock(saleId) {
          const r = await db.$queryRaw<Financial[]>`SELECT "netTotal", "costOfGoodsSold", "grossProfit", "totalCharges", "realProfit" FROM sale_financials WHERE "saleId" = ${saleId} FOR UPDATE`;
          return r[0] ? { netTotal: r[0].netTotal, costOfGoodsSold: r[0].costOfGoodsSold, grossProfit: r[0].grossProfit, totalCharges: r[0].totalCharges, realProfit: r[0].realProfit } : null;
        },
        async update(saleId, f, by, at) { await db.saleFinancial.update({ where: { saleId }, data: { totalCharges: f.totalCharges, realProfit: f.realProfit, recalculatedAt: at, recalculatedById: by } }); },
      },
      charges: {
        async insertMany(saleId, plans, createdById) {
          const ids = paymentIds.get(saleId) ?? (await db.salePayment.findMany({ where: { saleId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((p) => p.id);
          for (const p of plans) await db.saleCharge.create({ data: { saleId, paymentId: p.paymentIndex === null ? null : ids[p.paymentIndex] ?? null, type: p.type, amount: p.amount, baseAmount: p.baseAmount,
            percentApplied: p.percentMilli === null ? null : dec(BigInt(p.percentMilli)), fixedApplied: p.fixedApplied, source: 'RULE', addedAfterClose: false, createdById } });
        },
        async insertLate(saleId, c, createdById) {
          return chargeRecord(await db.saleCharge.create({ data: { saleId, type: c.type, amount: c.amount, description: [c.description, c.reason].filter(Boolean).join(' — ') || null, source: 'MANUAL', addedAfterClose: true, createdById } }));
        },
        async get(id) { const c = await db.saleCharge.findUnique({ where: { id } }); return c ? chargeRecord(c) : null; },
        async void(id, reason, userId) { await db.saleCharge.update({ where: { id }, data: { voidedAt: new Date(), voidedById: userId, voidReason: reason } }); },
        async sumActive(saleId) { return (await db.saleCharge.aggregate({ where: { saleId, voidedAt: null }, _sum: { amount: true } }))._sum.amount ?? 0; },
      },
      audit: {
        async write(e) {
          const j = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) as Prisma.InputJsonValue));
          await db.auditLog.create({ data: { userId: e.userId, action: e.action, entity: e.entity, entityId: e.entityId, before: j(e.before), after: j(e.after), metadata: j(e.metadata), ipAddress: e.ipAddress ?? null } });
        },
      },
    };
  }

  const uow: UnitOfWork = {
    async run(fn) {
      for (let attempt = 1; ; attempt++) {
        try { return await client.$transaction((db) => fn(tx(db)), { timeout: 20_000, maxWait: 10_000 }); }
        catch (e) {
          // reintento acotado ante interbloqueo/serialización (40P01/40001); cualquier otro error sube tal cual
          const code = (e as { code?: string; meta?: { code?: string } }).meta?.code ?? (e as { code?: string }).code;
          if (attempt < 3 && (code === '40P01' || code === '40001' || /deadlock detected/i.test(String((e as Error).message)))) continue;
          throw e;
        }
      }
    },
  };

  const sales: SalesReader = {
    async list(scope, branchId, limit) {
      return (await client.sale.findMany({ where: { branchId, ...(scope.createdById ? { createdById: scope.createdById } : {}), ...(scope.businessDate ? { businessDate: dateOnly(scope.businessDate) } : {}) },
        orderBy: { soldAt: 'desc' }, take: limit })).map(saleRecord);
    },
    async financialOf(saleId) {
      const f = await client.saleFinancial.findUnique({ where: { saleId } }); if (!f) return null;
      const charges = await client.saleCharge.findMany({ where: { saleId }, orderBy: { createdAt: 'asc' } });
      return { financial: { netTotal: f.netTotal, costOfGoodsSold: f.costOfGoodsSold, grossProfit: f.grossProfit, totalCharges: f.totalCharges, realProfit: f.realProfit }, charges: charges.map(chargeRecord) };
    },
  };

  const reports: ReportReader = {
    async sellerToday(userId, date) {
      const r = await client.sale.aggregate({ where: { createdById: userId, businessDate: dateOnly(date), status: 'COMPLETED' }, _count: { _all: true }, _sum: { total: true } });
      return { count: r._count._all, total: r._sum.total ?? 0 };
    },
    async financial(range, branchId) {
      const r = await client.saleFinancial.aggregate({ where: { sale: { branchId, status: 'COMPLETED', businessDate: { gte: dateOnly(range.from), lte: dateOnly(range.to) } } },
        _count: { _all: true }, _sum: { netTotal: true, costOfGoodsSold: true, grossProfit: true, totalCharges: true, realProfit: true } });
      const s = r._sum;
      return { sales: r._count._all, netTotal: s.netTotal ?? 0, costOfGoodsSold: s.costOfGoodsSold ?? 0, grossProfit: s.grossProfit ?? 0, totalCharges: s.totalCharges ?? 0, realProfit: s.realProfit ?? 0 };
    },
  };

  const users: UserStore = {
    async getById(id) { return client.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, banned: true } }); },
    async countActiveAdmins() { return client.user.count({ where: { role: 'ADMINISTRADOR', banned: false } }); },
  };

  const authAdmin: AuthAdmin = {
    async createUser() { throw new Error('authAdmin: se conecta en src/server/container.ts (requiere Next.js).'); },
    async setBanned() { throw new Error('authAdmin no conectado'); },
    async setRole() { throw new Error('authAdmin no conectado'); },
  };

  return { uow, catalog, products, sales, reports, users, authAdmin };
}
