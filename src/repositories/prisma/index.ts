// Implementación de `Ports` (src/repositories/ports.ts) con Prisma 7 + PostgreSQL.
// ÚNICO lugar que importa el cliente generado. Reglas (ver README.md de esta carpeta):
//  - Decimal ↔ milésimas siempre por texto (decimalToMilli / formatQuantity), nunca Number.
//  - lockState = SELECT … FOR UPDATE; saveState es la ÚNICA vía que escribe StockLevel/ProductCost.
//  - nextFolio = UPDATE … RETURNING (atómico). Los triggers/CHECK de prisma/sql/20_reglas.sql son la red de seguridad.
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { prisma as defaultClient } from '../../core/db/client';
import type {
  Ports, Tx, UnitOfWork, CatalogReader, ProductReader, SalesReader, ReportReader, UserStore, AuthAdmin,
  PurchaseReader, SupplierRow, ExpenseReader, ExpenseRecord, CashOps, CashCloseRecord, CashOpenRecord, MoneyOps, MoneyStartRecord, MoneyMoveRecord,
  SettingsStore, FeeRuleRow, CatalogEntryRow, BusinessSettingsRow,
  SaleRecord, SaleItemRecord, ChargeRecord, StockMovementRecord, PurchaseRecord, PurchaseItemRecord, ProductSearchRow, ProductSaveInput, ProductListFilter,
} from '../ports';
import type { CatalogProduct } from '../../domain/sales/sale-plan';
import type { UnitDef } from '../../core/money/quantity';
import { decimalToMilli, formatQuantity } from '../../core/money/quantity';
import type { Financial, FeeRuleDef } from '../../domain/charges/charges';
import { validation, businessRule } from '../../core/errors';
import { isPaidFrom } from '../../domain/money/money';

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
function bizRow(s: Prisma.BusinessSettingsGetPayload<object>): BusinessSettingsRow {
  return { legalName: s.legalName, taxId: s.taxId, address: s.address, phone: s.phone, email: s.email, receiptFooter: s.receiptFooter, timezone: s.timezone, vatRate: Number(s.vatRate.toFixed(2)) };
}
function feeRow(r: Prisma.FeeRuleGetPayload<{ include: { channel: true; paymentMethod: true } }>): FeeRuleRow {
  const t = r.channel ?? r.paymentMethod!;
  return { id: r.id, target: r.channel ? 'CHANNEL' : 'PAYMENT_METHOD', targetId: t.id, targetName: t.name, targetCode: t.code, percentMilli: pctMilli(r.percent), fixedAmount: r.fixedAmount, isManualPerSale: r.isManualPerSale, isActive: r.isActive, vatTreatment: r.vatTreatment };
}
const supplierRow = (s: Prisma.SupplierGetPayload<object>): SupplierRow => ({ id: s.id, name: s.name, taxId: s.taxId, contactName: s.contactName, phone: s.phone, email: s.email, notes: s.notes, isActive: s.isActive });
const entryRow = (e: { id: string; code: string; name: string; isActive: boolean; sortOrder: number }): CatalogEntryRow => ({ id: e.id, code: e.code, name: e.name, isActive: e.isActive, sortOrder: e.sortOrder });
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

type Db = PrismaClient | Prisma.TransactionClient;
/** Cierres de caja: se leen de la bitácora (audit_logs, action = 'cash.close'); las ventas, de sales/sale_payments. */
function cashOps(db: Db): CashOps {
  const toRecord = (r: { id: string; at: Date; userId: string; userName: string | null; after: Record<string, unknown> }): CashCloseRecord =>
    ({ ...(r.after as unknown as Omit<CashCloseRecord, 'id' | 'at' | 'userId' | 'userName'>), id: r.id, at: r.at, userId: r.userId, userName: r.userName ?? '—' });
  const ops: CashOps = {
    async summary(branchId, date, since) {
      const [s] = await db.$queryRaw<{ n: bigint; total: bigint; voided: bigint }[]>`
        SELECT count(*) FILTER (WHERE status = 'COMPLETED') AS n, COALESCE(sum(total) FILTER (WHERE status = 'COMPLETED'), 0)::bigint AS total, count(*) FILTER (WHERE status = 'VOIDED') AS voided
        FROM sales WHERE "branchId" = ${branchId} AND "businessDate" = ${date}::date AND (${since}::timestamptz IS NULL OR "soldAt" > ${since}::timestamptz)`;
      const pm = await db.$queryRaw<{ code: string; name: string; n: bigint; amount: bigint }[]>`
        SELECT m.code, m.name, count(DISTINCT s.id) AS n, COALESCE(sum(p.amount), 0)::bigint AS amount
        FROM sales s JOIN sale_payments p ON p."saleId" = s.id JOIN payment_methods m ON m.id = p."paymentMethodId"
        WHERE s."branchId" = ${branchId} AND s."businessDate" = ${date}::date AND s.status = 'COMPLETED' AND (${since}::timestamptz IS NULL OR s."soldAt" > ${since}::timestamptz)
        GROUP BY m.code, m.name ORDER BY amount DESC`;
      const byMethod = pm.map((x) => ({ code: x.code, name: x.name, count: Number(x.n), amount: Number(x.amount) }));
      return { salesCount: Number(s.n), total: Number(s.total), voidedCount: Number(s.voided), cash: byMethod.filter((m) => m.code === 'CASH').reduce((a, m) => a + m.amount, 0), byMethod };
    },
    async lastClose(branchId, date) { return (await ops.closes(branchId, { from: date, to: date, limit: 1 }))[0] ?? null; },
    async closes(branchId, f) {
      const rows = await db.$queryRaw<{ id: string; at: Date; userId: string; userName: string | null; after: Record<string, unknown> }[]>`
        SELECT a.id, a."occurredAt" AS at, a."userId", u.name AS "userName", a.after
        FROM audit_logs a LEFT JOIN users u ON u.id = a."userId"
        WHERE a.action = 'cash.close' AND a.after->>'branchId' = ${branchId} AND a.after->>'date' BETWEEN ${f.from} AND ${f.to}
          AND (${f.userId ?? null}::text IS NULL OR a."userId" = ${f.userId ?? null}::text)
        ORDER BY a."occurredAt" DESC, a.id DESC LIMIT ${f.limit}`;
      return rows.map(toRecord);
    },
    async opens(branchId, f) {
      const rows = await db.$queryRaw<{ id: string; at: Date; userId: string; userName: string | null; after: Record<string, unknown> }[]>`
        SELECT a.id, a."occurredAt" AS at, a."userId", u.name AS "userName", a.after
        FROM audit_logs a LEFT JOIN users u ON u.id = a."userId"
        WHERE a.action = 'cash.open' AND a.after->>'branchId' = ${branchId} AND a.after->>'date' BETWEEN ${f.from} AND ${f.to}
        ORDER BY a."occurredAt" DESC, a.id DESC LIMIT ${f.limit}`;
      return rows.map((r): CashOpenRecord => ({ ...(r.after as unknown as Omit<CashOpenRecord, 'id' | 'at' | 'userId' | 'userName'>), id: r.id, at: r.at, userId: r.userId, userName: r.userName ?? '—' }));
    },
  };
  return ops;
}

/** "Dinero disponible": punto de partida y traspasos en la bitácora (audit_logs); ventas, compras y gastos desde sus tablas. */
function moneyOps(db: Db): MoneyOps {
  type Row = { id: string; at: Date; userName: string | null; after: Record<string, unknown> };
  const ops: MoneyOps = {
    async lastStart(branchId) {
      const [r] = await db.$queryRaw<Row[]>`
        SELECT a.id, a."occurredAt" AS at, u.name AS "userName", a.after FROM audit_logs a LEFT JOIN users u ON u.id = a."userId"
        WHERE a.action = 'money.start' AND a.after->>'branchId' = ${branchId} ORDER BY a."occurredAt" DESC, a.id DESC LIMIT 1`;
      if (!r) return null;
      const a = r.after as { balances: MoneyStartRecord['balances']; note?: string | null; at?: string };
      return { id: r.id, at: a.at ? new Date(a.at) : r.at, userName: r.userName ?? '—', balances: a.balances, note: a.note ?? null };
    },
    async moves(branchId, since) {
      const rows = await db.$queryRaw<(Row & { voidReason: string | null; voided: boolean })[]>`
        SELECT a.id, a."occurredAt" AS at, u.name AS "userName", a.after,
          EXISTS (SELECT 1 FROM audit_logs v WHERE v.action = 'money.move.void' AND v."entityId" = a.id) AS voided,
          (SELECT v.metadata->>'reason' FROM audit_logs v WHERE v.action = 'money.move.void' AND v."entityId" = a.id ORDER BY v."occurredAt" DESC LIMIT 1) AS "voidReason"
        FROM audit_logs a LEFT JOIN users u ON u.id = a."userId"
        WHERE a.action = 'money.move' AND a.after->>'branchId' = ${branchId} AND a."occurredAt" > ${since}
        ORDER BY a."occurredAt" DESC, a.id DESC`;
      return rows.map((r) => { const a = r.after as { date: string; from: MoneyMoveRecord['from']; to: MoneyMoveRecord['to']; amount: number; note?: string | null };
        return { id: r.id, at: r.at, date: a.date, from: a.from, to: a.to, amount: a.amount, note: a.note ?? null, userName: r.userName ?? '—', voided: r.voided, voidReason: r.voidReason }; });
    },
    async data(branchId, since, sinceDate) {
      const [payments, charges, refunds, outflows, count] = await Promise.all([
        db.$queryRaw<{ methodCode: string; amount: bigint }[]>`
          SELECT m.code AS "methodCode", sum(p.amount)::bigint AS amount FROM sales s JOIN sale_payments p ON p."saleId" = s.id JOIN payment_methods m ON m.id = p."paymentMethodId"
          WHERE s."branchId" = ${branchId} AND s.status = 'COMPLETED' AND s."createdAt" > ${since} GROUP BY m.code`,
        db.$queryRaw<{ paymentMethodCode: string | null; channelCode: string; mainPaymentCode: string | null; amount: bigint }[]>`
          SELECT pm.code AS "paymentMethodCode", ch.code AS "channelCode",
            (SELECT m2.code FROM sale_payments p2 JOIN payment_methods m2 ON m2.id = p2."paymentMethodId" WHERE p2."saleId" = s.id ORDER BY p2.amount DESC, p2.id LIMIT 1) AS "mainPaymentCode",
            sum(c.amount)::bigint AS amount
          FROM sale_charges c JOIN sales s ON s.id = c."saleId" JOIN sale_channels ch ON ch.id = s."channelId"
            LEFT JOIN sale_payments p ON p.id = c."paymentId" LEFT JOIN payment_methods pm ON pm.id = p."paymentMethodId"
          WHERE s."branchId" = ${branchId} AND s.status = 'COMPLETED' AND s."createdAt" > ${since} AND c."voidedAt" IS NULL
          GROUP BY 1, 2, 3`,
        db.$queryRaw<{ total: bigint | null }[]>`SELECT sum("refundTotal")::bigint AS total FROM sale_returns WHERE "branchId" = ${branchId} AND "createdAt" > ${since}`,
        db.$queryRaw<{ kind: 'PURCHASE' | 'EXPENSE'; id: string; date: string; label: string; amount: number; paidFrom: string | null }[]>`
          SELECT 'PURCHASE' AS kind, p.id, p."docDate"::text AS date, p."totalAmount" AS amount,
            trim(coalesce(sp.name, 'Sin proveedor') || ' · ' || initcap(p."docType"::text) || coalesce(' ' || p."docNumber", '')) AS label,
            coalesce((SELECT a.after->>'paidFrom' FROM audit_logs a WHERE a.action = 'money.source' AND a."entityId" = p.id ORDER BY a."occurredAt" DESC LIMIT 1),
                     (SELECT a.after->>'paidFrom' FROM audit_logs a WHERE a.action = 'purchase.create' AND a."entityId" = p.id LIMIT 1)) AS "paidFrom"
          FROM purchases p LEFT JOIN suppliers sp ON sp.id = p."supplierId"
          WHERE p."branchId" = ${branchId} AND p.status = 'CONFIRMED' AND p."createdAt" > ${since} AND p."docDate" >= ${sinceDate}::date
          UNION ALL
          SELECT 'EXPENSE', e.id, e."expenseDate"::text, e."totalAmount", trim(ec.name || ' · ' || e.description),
            coalesce((SELECT a.after->>'paidFrom' FROM audit_logs a WHERE a.action = 'money.source' AND a."entityId" = e.id ORDER BY a."occurredAt" DESC LIMIT 1),
                     (SELECT a.after->>'paidFrom' FROM audit_logs a WHERE a.action = 'expense.create' AND a."entityId" = e.id LIMIT 1))
          FROM expenses e JOIN expense_categories ec ON ec.id = e."categoryId"
          WHERE e."branchId" = ${branchId} AND e.status = 'CONFIRMED' AND e."createdAt" > ${since} AND e."expenseDate" >= ${sinceDate}::date
          ORDER BY 3 DESC, 2`,
        db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM sales WHERE "branchId" = ${branchId} AND status = 'COMPLETED' AND "createdAt" > ${since}`,
      ]);
      return {
        payments: payments.map((r) => ({ methodCode: r.methodCode, amount: Number(r.amount) })),
        charges: charges.map((r) => ({ paymentMethodCode: r.paymentMethodCode, channelCode: r.channelCode, mainPaymentCode: r.mainPaymentCode, amount: Number(r.amount) })),
        refunds: Number(refunds[0]?.total ?? 0),
        outflows: outflows.map((r) => ({ kind: r.kind, id: r.id, date: r.date, label: r.label, amount: Number(r.amount), paidFrom: isPaidFrom(r.paidFrom) ? r.paidFrom : null })),
        salesCount: Number(count[0]?.n ?? 0),
      };
    },
    async outflowExists(kind, id, branchId) {
      const n = kind === 'PURCHASE' ? await db.purchase.count({ where: { id, branchId } }) : await db.expense.count({ where: { id, branchId } });
      return n > 0;
    },
    async moveExists(id, branchId) {
      const [r] = await db.$queryRaw<{ voided: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM audit_logs v WHERE v.action = 'money.move.void' AND v."entityId" = a.id) AS voided
        FROM audit_logs a WHERE a.id = ${id} AND a.action = 'money.move' AND a.after->>'branchId' = ${branchId}`;
      return r ? { voided: r.voided } : null;
    },
  };
  return ops;
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
      return { legalName: s.legalName, taxId: s.taxId, address: s.address, timezone: s.timezone, vatRate: Number(s.vatRate.toFixed(2)), receiptFooter: s.receiptFooter };
    },
    async findSaleByIdempotencyKey(key) { const s = await client.sale.findUnique({ where: { idempotencyKey: key } }); return s ? saleRecord(s) : null; },
    async loadChannel(id) { return client.saleChannel.findUnique({ where: { id }, select: { id: true, isActive: true } }); },
    async loadPaymentMethods(ids) { return new Map((await client.paymentMethod.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } })).map((m) => [m.id, m])); },
    async listChannels() { return client.saleChannel.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true } }); },
    async listPaymentMethods() { return client.paymentMethod.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true } }); },
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
          const sale = await (async () => { try { return await db.sale.create({ data: { branchId: s.branchId, folio: s.folio, channelId: s.channelId, status: s.status, soldAt: s.soldAt, businessDate: dateOnly(s.businessDate),
            netTotal: s.netTotal, vatTotal: s.vatTotal, total: s.total, idempotencyKey: s.idempotencyKey, createdById: s.createdById, externalRef: s.externalRef ?? null, note: s.note ?? null,
            issuerSnapshot: s.issuerSnapshot } }); } catch (e) {
            // n° de pedido / comprobante repetido en el mismo canal (único por canal)
            if ((e as { code?: string }).code === 'P2002' && /externalRef/.test(JSON.stringify((e as { meta?: unknown }).meta ?? '') + String((e as Error).message))) throw businessRule('Ese N° de pedido o comprobante ya está registrado en otra venta de este canal.');
            throw e; } })();
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
        async updateHeader(id, d) { await db.purchase.update({ where: { id }, data: { supplierId: d.supplierId, docNumber: d.docNumber, docDate: dateOnly(d.docDate), documentKey: d.documentKey, note: d.note } }); },
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
      suppliers: {
        async save(i) {
          const before = i.id ? await db.supplier.findUnique({ where: { id: i.id } }) : null;
          if (i.id && !before) throw validation('Proveedor inexistente.');
          const data = { name: i.name, taxId: i.taxId, contactName: i.contactName, phone: i.phone, email: i.email, notes: i.notes, isActive: i.isActive };
          try { const r = i.id ? await db.supplier.update({ where: { id: i.id }, data }) : await db.supplier.create({ data }); return { id: r.id, before: before ? supplierRow(before) : null }; }
          catch (e) { if (isUnique(e, 'taxId')) throw validation(`Ya existe un proveedor con RUT ${i.taxId}.`); throw e; }
        },
      },
      expenses: {
        async insert(e) {
          const r = await db.expense.create({ data: { branchId: e.branchId, categoryId: e.categoryId, supplierId: e.supplierId, description: e.description, docType: e.docType, docNumber: e.docNumber,
            expenseDate: dateOnly(e.expenseDate), vatRecoverable: e.vatRecoverable, netAmount: e.netAmount, vatAmount: e.vatAmount, totalAmount: e.totalAmount, createdById: e.createdById } });
          return { id: r.id };
        },
        async findDuplicate(e) {
          const r = await db.expense.findFirst({ where: { status: 'CONFIRMED', supplierId: e.supplierId, docType: e.docType as 'FACTURA', docNumber: { equals: e.docNumber, mode: 'insensitive' } } });
          return r ? { id: r.id, expenseDate: ymd(r.expenseDate) } : null;
        },
        async getForUpdate(id) {
          const r = await db.$queryRaw<{ id: string; status: 'CONFIRMED' | 'VOIDED' }[]>`SELECT id, status::text AS status FROM expenses WHERE id = ${id} FOR UPDATE`;
          return r[0] ?? null;
        },
        async markVoided(id, reason, userId) { await db.expense.update({ where: { id }, data: { status: 'VOIDED', voidReason: reason, voidedAt: new Date(), voidedById: userId } }); },
        async ensureCategory(name) {
          const n = name.trim().replace(/\s+/g, ' ');
          const f = await db.expenseCategory.findFirst({ where: { name: { equals: n, mode: 'insensitive' } } });
          if (f) { if (!f.isActive) await db.expenseCategory.update({ where: { id: f.id }, data: { isActive: true } }); return { id: f.id, name: f.name }; }
          const c = await db.expenseCategory.create({ data: { name: n } }); return { id: c.id, name: c.name };
        },
        async updateCategory(id, d) {
          const prev = await db.expenseCategory.findUnique({ where: { id } }); if (!prev) return null;
          try { await db.expenseCategory.update({ where: { id }, data: d }); } catch (e) { if (isUnique(e)) throw validation(`Ya existe la categoría "${d.name}".`); throw e; }
          return { name: prev.name, isActive: prev.isActive };
        },
        async categoryActive(id) { return (await db.expenseCategory.findUnique({ where: { id } }))?.isActive ?? null; },
      },
      settings: {
        async updateBusiness(d) {
          const prev = await db.businessSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
          await db.businessSettings.update({ where: { id: 'singleton' }, data: d });
          return bizRow(prev);
        },
        async upsertFeeRule(target, targetId, d) {
          const where = target === 'CHANNEL' ? { channelId: targetId } : { paymentMethodId: targetId };
          const exists = target === 'CHANNEL' ? await db.saleChannel.findUnique({ where: { id: targetId } }) : await db.paymentMethod.findUnique({ where: { id: targetId } });
          if (!exists) throw validation(target === 'CHANNEL' ? 'Canal inexistente.' : 'Medio de pago inexistente.');
          const prev = await db.feeRule.findUnique({ where, include: { channel: true, paymentMethod: true } });
          const data = { percent: dec(BigInt(d.percentMilli)), fixedAmount: d.fixedAmount, isManualPerSale: d.isManualPerSale, isActive: d.isActive, vatTreatment: d.vatTreatment };
          await db.feeRule.upsert({ where, update: data, create: { ...where, ...data } });
          return prev ? feeRow(prev) : null;
        },
        async createEntry(kind, d) {
          const model = kind === 'channel' ? db.saleChannel : db.paymentMethod;
          const max = await (model as typeof db.saleChannel).aggregate({ _max: { sortOrder: true } });
          try { return entryRow(await (model as typeof db.saleChannel).create({ data: { code: d.code, name: d.name, sortOrder: (max._max.sortOrder ?? 0) + 1 } })); }
          catch (e) { if (isUnique(e)) throw validation(`Ya existe ${kind === 'channel' ? 'un canal' : 'un medio de pago'} con el código ${d.code}.`); throw e; }
        },
        async updateEntry(kind, id, d) {
          const prev = kind === 'channel' ? await db.saleChannel.findUnique({ where: { id } }) : await db.paymentMethod.findUnique({ where: { id } });
          if (!prev) return null;
          if (kind === 'channel') await db.saleChannel.update({ where: { id }, data: d }); else await db.paymentMethod.update({ where: { id }, data: d });
          return { id: prev.id, code: prev.code, name: prev.name, isActive: prev.isActive, sortOrder: prev.sortOrder };
        },
      },
      cash: { ...cashOps(db), async lock(branchId, date) { await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'cash-close:' + branchId + ':' + date}, 0))`; } },
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
        try { return await client.$transaction((db) => fn(tx(db)), { timeout: Number(process.env.DB_TX_TIMEOUT_MS) || 20_000, maxWait: 10_000 }); }
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
    async listAdmin(branchId, f) {
      const where: Prisma.SaleWhereInput = { branchId, businessDate: { gte: dateOnly(f.from), lte: dateOnly(f.to) }, ...(f.status ? { status: f.status } : {}), ...(f.sellerId ? { createdById: f.sellerId } : {}) };
      const [rows, agg] = await Promise.all([
        client.sale.findMany({ where, orderBy: { soldAt: 'desc' }, take: f.limit, include: { channel: { select: { name: true } }, createdBy: { select: { name: true } }, payments: { include: { paymentMethod: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } } }),
        client.sale.aggregate({ where: { ...where, status: 'COMPLETED' }, _count: { _all: true }, _sum: { total: true } }),
      ]);
      return { rows: rows.map((s) => ({ id: s.id, folio: s.folio, soldAt: s.soldAt, businessDate: ymd(s.businessDate), total: s.total, status: s.status, channel: s.channel.name, seller: s.createdBy.name,
        payments: s.payments.map((p) => ({ method: p.paymentMethod.name, amount: p.amount })), externalRef: s.externalRef })), totals: { count: agg._count._all, total: agg._sum.total ?? 0 } };
    },
    async meta(saleId) {
      const s = await client.sale.findUnique({ where: { id: saleId }, include: { channel: { select: { name: true } }, createdBy: { select: { name: true } }, voidedBy: { select: { name: true } }, payments: { include: { paymentMethod: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } } });
      return s ? { channel: s.channel.name, seller: s.createdBy.name, payments: s.payments.map((p) => ({ method: p.paymentMethod.name, amount: p.amount })), externalRef: s.externalRef, note: s.note, voidReason: s.voidReason, voidedAt: s.voidedAt, voidedBy: s.voidedBy?.name ?? null } : null;
    },
  };

  const reports = {
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
  } as ReportReader;

  type Agg = { count: bigint; total: bigint | null; net: bigint | null; cost: bigint | null; gross: bigint | null; charges: bigint | null; real: bigint | null };
  const money = (r: Agg) => ({ count: Number(r.count), total: Number(r.total ?? 0), net: Number(r.net ?? 0), cost: Number(r.cost ?? 0), gross: Number(r.gross ?? 0), charges: Number(r.charges ?? 0), real: Number(r.real ?? 0) });
  const AGG = Prisma.sql`count(*) AS count, sum(s.total) AS total, sum(f."netTotal") AS net, sum(f."costOfGoodsSold") AS cost, sum(f."grossProfit") AS gross, sum(f."totalCharges") AS charges, sum(f."realProfit") AS real`;
  Object.assign(reports, {
    async breakdown(range: { from: string; to: string }, branchId: string) {
      const W = Prisma.sql`s."branchId" = ${branchId} AND s.status = 'COMPLETED' AND s."businessDate" BETWEEN ${range.from}::date AND ${range.to}::date`;
      const [byDay, byProduct, bySeller, byChannel, byPayment, charges, voided] = await Promise.all([
        client.$queryRaw<(Agg & { d: Date })[]>`SELECT s."businessDate" AS d, ${AGG} FROM sales s JOIN sale_financials f ON f."saleId" = s.id WHERE ${W} GROUP BY 1 ORDER BY 1`,
        client.$queryRaw<{ id: string; name: string; sku: string; qty: string; total: bigint; net: bigint; cost: bigint }[]>`
          SELECT si."productId" AS id, max(si."nameSnapshot") AS name, max(coalesce(si."skuSnapshot", '')) AS sku, sum(si.quantity)::text AS qty, sum(si."lineTotal") AS total, sum(si."lineNet") AS net, coalesce(sum(c."lineCost"), 0) AS cost
          FROM sale_items si JOIN sales s ON s.id = si."saleId" LEFT JOIN sale_item_costs c ON c."saleItemId" = si.id WHERE ${W} GROUP BY 1 ORDER BY sum(si."lineNet") - coalesce(sum(c."lineCost"), 0) DESC LIMIT 200`,
        client.$queryRaw<(Agg & { id: string; name: string })[]>`SELECT s."createdById" AS id, max(u.name) AS name, ${AGG} FROM sales s JOIN sale_financials f ON f."saleId" = s.id JOIN users u ON u.id = s."createdById" WHERE ${W} GROUP BY 1 ORDER BY sum(s.total) DESC`,
        client.$queryRaw<(Agg & { name: string })[]>`SELECT max(ch.name) AS name, ${AGG} FROM sales s JOIN sale_financials f ON f."saleId" = s.id JOIN sale_channels ch ON ch.id = s."channelId" WHERE ${W} GROUP BY s."channelId" ORDER BY sum(s.total) DESC`,
        client.$queryRaw<{ name: string; count: bigint; amount: bigint }[]>`SELECT max(pm.name) AS name, count(*) AS count, sum(sp.amount) AS amount FROM sale_payments sp JOIN sales s ON s.id = sp."saleId" JOIN payment_methods pm ON pm.id = sp."paymentMethodId" WHERE ${W} GROUP BY sp."paymentMethodId" ORDER BY 3 DESC`,
        client.$queryRaw<{ type: string; amount: bigint; count: bigint }[]>`SELECT c.type::text AS type, sum(c.amount) AS amount, count(*) AS count FROM sale_charges c JOIN sales s ON s.id = c."saleId" WHERE ${W} AND c."voidedAt" IS NULL GROUP BY 1 ORDER BY 2 DESC`,
        client.$queryRaw<{ count: bigint; total: bigint | null }[]>`SELECT count(*) AS count, sum(s.total) AS total FROM sales s WHERE s."branchId" = ${branchId} AND s.status = 'VOIDED' AND s."businessDate" BETWEEN ${range.from}::date AND ${range.to}::date`,
      ]);
      return {
        byDay: byDay.map((r) => ({ date: ymd(r.d), ...money(r) })),
        byProduct: byProduct.map((r) => ({ productId: r.id, name: r.name, sku: r.sku, qty: formatQuantity(M(r.qty)), total: Number(r.total), net: Number(r.net), cost: Number(r.cost), gross: Number(r.net) - Number(r.cost) })),
        bySeller: bySeller.map((r) => ({ userId: r.id, name: r.name, ...money(r) })),
        byChannel: byChannel.map((r) => ({ name: r.name, ...money(r) })),
        byPayment: byPayment.map((r) => ({ name: r.name, count: Number(r.count), amount: Number(r.amount) })),
        charges: charges.map((r) => ({ type: r.type, amount: Number(r.amount), count: Number(r.count) })),
        voided: { count: Number(voided[0]?.count ?? 0), total: Number(voided[0]?.total ?? 0) },
      };
    },
    async inventorySnapshot(branchId: string) {
      const [agg, low] = await Promise.all([
        client.$queryRaw<{ with_stock: bigint; without_stock: bigint; value: bigint | null }[]>`
          SELECT count(*) FILTER (WHERE coalesce(sl.quantity, 0) > 0) AS with_stock, count(*) FILTER (WHERE coalesce(sl.quantity, 0) = 0) AS without_stock, coalesce(sum(pc."inventoryValue"), 0) AS value
          FROM products p LEFT JOIN stock_levels sl ON sl."productId" = p.id AND sl."branchId" = ${branchId} LEFT JOIN product_costs pc ON pc."productId" = p.id AND pc."branchId" = ${branchId}
          WHERE p."isActive" AND p.kind = 'GOODS'`,
        client.$queryRaw<{ id: string; name: string; sku: string; qty: string }[]>`
          SELECT p.id, p.name, p.sku, sl.quantity::text AS qty FROM products p JOIN stock_levels sl ON sl."productId" = p.id AND sl."branchId" = ${branchId}
          WHERE p."isActive" AND p.kind = 'GOODS' AND sl.quantity > 0 AND sl.quantity <= greatest(sl."minQuantity", 2) ORDER BY sl.quantity, p.name LIMIT 30`,
      ]);
      return { productsWithStock: Number(agg[0].with_stock), productsWithoutStock: Number(agg[0].without_stock), inventoryValue: Number(agg[0].value), lowStock: low.map((l) => ({ ...l, qty: formatQuantity(M(l.qty)) })) };
    },
  });

  const users: UserStore = {
    async getById(id) { return client.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, banned: true } }); },
    async countActiveAdmins() { return client.user.count({ where: { role: 'ADMINISTRADOR', banned: false } }); },
    async list() {
      return client.user.findMany({ orderBy: [{ banned: 'asc' }, { role: 'asc' }, { name: 'asc' }], select: { id: true, name: true, email: true, role: true, banned: true, banReason: true, mustChangePassword: true, lastLoginAt: true, createdAt: true } });
    },
  };

  const authAdmin: AuthAdmin = {
    async createUser() { throw new Error('authAdmin: se conecta en src/server/container.ts (requiere Next.js).'); },
    async setBanned() { throw new Error('authAdmin no conectado'); },
    async setRole() { throw new Error('authAdmin no conectado'); },
    async setPassword() { throw new Error('authAdmin no conectado'); },
  };

  const settings: SettingsStore = {
    async get() { return bizRow(await client.businessSettings.findUniqueOrThrow({ where: { id: 'singleton' } })); },
    async feeRules() {
      const [methods, channels, rules] = await Promise.all([client.paymentMethod.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }), client.saleChannel.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }), client.feeRule.findMany()]);
      const blank = (target: FeeRuleRow['target'], t: { id: string; name: string; code: string }): FeeRuleRow => ({ id: null, target, targetId: t.id, targetName: t.name, targetCode: t.code, percentMilli: 0, fixedAmount: 0, isManualPerSale: false, isActive: false, vatTreatment: 'UNDEFINED' });
      const pick = (r: (typeof rules)[number] | undefined, target: FeeRuleRow['target'], t: { id: string; name: string; code: string }): FeeRuleRow => (r ? { id: r.id, target, targetId: t.id, targetName: t.name, targetCode: t.code, percentMilli: pctMilli(r.percent), fixedAmount: r.fixedAmount, isManualPerSale: r.isManualPerSale, isActive: r.isActive, vatTreatment: r.vatTreatment } : blank(target, t));
      return [...methods.map((m) => pick(rules.find((r) => r.paymentMethodId === m.id), 'PAYMENT_METHOD', m)), ...channels.map((c) => pick(rules.find((r) => r.channelId === c.id), 'CHANNEL', c))];
    },
    async channels() { return (await client.saleChannel.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map(entryRow); },
    async paymentMethods() { return (await client.paymentMethod.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map(entryRow); },
  };

  const purchases: PurchaseReader = {
    async list(branchId, f) {
      const where: Prisma.PurchaseWhereInput = { branchId, docDate: { gte: dateOnly(f.from), lte: dateOnly(f.to) }, ...(f.supplierId ? { supplierId: f.supplierId } : {}), ...(f.status ? { status: f.status } : {}) };
      const [rows, agg] = await Promise.all([
        client.purchase.findMany({ where, orderBy: [{ docDate: 'desc' }, { createdAt: 'desc' }], take: f.limit, include: { supplier: { select: { name: true } }, _count: { select: { items: true } } } }),
        client.purchase.aggregate({ where: { ...where, status: 'CONFIRMED' }, _count: { _all: true }, _sum: { netAmount: true, vatAmount: true, totalAmount: true } }),
      ]);
      return { rows: rows.map((p) => ({ id: p.id, docType: p.docType, docNumber: p.docNumber, docDate: ymd(p.docDate), supplier: p.supplier?.name ?? null, status: p.status, netAmount: p.netAmount, vatAmount: p.vatAmount, totalAmount: p.totalAmount, items: p._count.items, createdAt: p.createdAt })),
        totals: { count: agg._count._all, net: agg._sum.netAmount ?? 0, vat: agg._sum.vatAmount ?? 0, total: agg._sum.totalAmount ?? 0 } };
    },
    async detail(id) {
      const p = await client.purchase.findUnique({ where: { id }, include: { supplier: true, createdBy: { select: { name: true } }, voidedBy: { select: { name: true } }, items: { include: { product: { include: { unit: true } } }, orderBy: { id: 'asc' } } } });
      if (!p) return null;
      return { purchase: purchaseRecord(p), supplier: p.supplier?.name ?? null, createdBy: p.createdBy.name, createdAt: p.createdAt, voidedBy: p.voidedBy?.name ?? null, voidedAt: p.voidedAt,
        items: p.items.map((i) => ({ ...purchaseItemRecord(i), sku: i.product.sku, unit: i.product.unit.code })) };
    },
    async suppliers(includeInactive) { return (await client.supplier.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: 'asc' } })).map(supplierRow); },
  };

  const expInclude = { category: { select: { name: true } }, supplier: { select: { name: true } }, createdBy: { select: { name: true } }, voidedBy: { select: { name: true } } } as const;
  const expRecord = (e: Prisma.ExpenseGetPayload<{ include: typeof expInclude }>): ExpenseRecord => ({
    id: e.id, branchId: e.branchId, categoryId: e.categoryId, category: e.category.name, supplierId: e.supplierId, supplier: e.supplier?.name ?? null, description: e.description,
    docType: e.docType, docNumber: e.docNumber, expenseDate: ymd(e.expenseDate), status: e.status, vatRecoverable: e.vatRecoverable, netAmount: e.netAmount, vatAmount: e.vatAmount,
    totalAmount: e.totalAmount, createdBy: e.createdBy.name, createdAt: e.createdAt, voidReason: e.voidReason, voidedBy: e.voidedBy?.name ?? null });
  const expenses: ExpenseReader = {
    async list(branchId, f) {
      return (await client.expense.findMany({ where: { branchId, expenseDate: { gte: dateOnly(f.from), lte: dateOnly(f.to) }, ...(f.categoryId ? { categoryId: f.categoryId } : {}), ...(f.status ? { status: f.status } : {}) },
        include: expInclude, orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }], take: f.limit })).map(expRecord);
    },
    async get(id) { const e = await client.expense.findUnique({ where: { id }, include: expInclude }); return e ? expRecord(e) : null; },
    async categories(all) { return client.expenseCategory.findMany({ where: all ? {} : { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, isActive: true } }); },
    async totalsByCategory(branchId, range) {
      const rows = await client.$queryRaw<{ category: string; count: bigint; total: bigint; cost: bigint }[]>`
        SELECT c.name AS category, count(*) AS count, sum(e."totalAmount") AS total, sum(CASE WHEN e."vatRecoverable" THEN e."netAmount" ELSE e."totalAmount" END) AS cost
        FROM expenses e JOIN expense_categories c ON c.id = e."categoryId"
        WHERE e."branchId" = ${branchId} AND e.status = 'CONFIRMED' AND e."expenseDate" BETWEEN ${range.from}::date AND ${range.to}::date
        GROUP BY c.name ORDER BY 4 DESC`;
      return rows.map((r) => ({ category: r.category, count: Number(r.count), total: Number(r.total), resultCost: Number(r.cost) }));
    },
  };

  return { uow, catalog, products, sales, reports, users, authAdmin, settings, purchases, expenses, cash: cashOps(client), money: moneyOps(client) };
}
