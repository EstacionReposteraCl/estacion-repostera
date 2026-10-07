// CONTRATOS de repositorio. La implementación real (Prisma) vive en src/repositories/prisma/* y es el ÚNICO lugar
// que importa el cliente generado. Los servicios dependen solo de estas interfaces.
import type { Milli, Peso } from '../core/money/rounding.ts';
import type { UnitDef } from '../core/money/quantity.ts';
import type { CatalogProduct } from '../domain/sales/sale-plan.ts';
import type { FeeRuleDef, ChargePlan, Financial, ChargeType } from '../domain/charges/charges.ts';
import type { SaleLinePlan } from '../domain/sales/sale-plan.ts';
import type { InventoryState } from '../domain/inventory/inventory.ts';
import type { DocType } from '../domain/purchases/purchases.ts';
import type { SaleScope } from '../policies/sale.policy.ts';

export interface StockMovementRecord {
  branchId: string; productId: string; seq: number; type: 'SALE' | 'SALE_VOID' | 'PURCHASE' | 'PURCHASE_VOID' | 'CUSTOMER_RETURN' | 'ADJUSTMENT' | 'WASTE' | 'CORRECTION' | 'COST_CORRECTION' | 'OPENING_BALANCE';
  quantity: Milli; quantityBefore: Milli; quantityAfter: Milli; valueChange: Peso; valueAfter: Peso; saleItemId?: string | null; purchaseItemId?: string | null; note?: string | null; createdById: string;
}
export interface SaleRecord {
  id: string; branchId: string; folio: number; channelId: string; status: 'COMPLETED' | 'VOIDED'; soldAt: Date; businessDate: string; netTotal: Peso; vatTotal: Peso; total: Peso;
  idempotencyKey: string; createdById: string; externalRef?: string | null; note?: string | null; voidReason?: string | null; issuerSnapshot: { legalName: string; taxId: string | null; address: string | null };
}
export interface SaleItemRecord extends SaleLinePlan { id: string; saleId: string }
export interface ChargeRecord extends Omit<ChargePlan, 'ruleId' | 'paymentIndex'> { id: string; saleId: string; createdById: string; createdAt: Date; voidedAt: Date | null; description?: string | null; reason?: string | null; type: ChargeType }
export interface AuditEntry { action: string; entity: string; entityId: string; userId: string; before?: unknown; after?: unknown; metadata?: unknown; ipAddress?: string | null }

/** Todo lo que ocurre dentro de UNA transacción de base de datos. */
export interface Tx {
  sales: {
    findByIdempotencyKey(key: string): Promise<SaleRecord | null>;
    nextFolio(branchId: string): Promise<number>;                     // UPDATE document_sequences ... RETURNING, atómico
    insert(s: Omit<SaleRecord, 'id'>, items: SaleLinePlan[], payments: { methodId: string; amount: Peso }[]): Promise<{ sale: SaleRecord; items: SaleItemRecord[] }>;
    getWithItems(id: string): Promise<{ sale: SaleRecord; items: SaleItemRecord[]; payments: { methodId: string; amount: Peso }[] } | null>;
    markVoided(id: string, reason: string, userId: string): Promise<void>;
  };
  inventory: {
    /** SELECT ... FOR UPDATE de StockLevel+ProductCost. Si no existen (producto GOODS nuevo) los crea en 0/0. */
    lockState(branchId: string, productId: string): Promise<InventoryState>;
    saveState(branchId: string, productId: string, s: InventoryState): Promise<void>;       // ÚNICA vía que escribe StockLevel/ProductCost
    appendMovement(m: StockMovementRecord): Promise<void>;
    saveItemCost(saleItemId: string, lineCost: Peso): Promise<void>;
    getItemCost(saleItemId: string): Promise<Peso | null>;
    /** n° de movimiento (seq) que generó PURCHASE para esa línea; null si no existe. */
    purchaseMovementSeq(purchaseItemId: string): Promise<number | null>;
    listMovements(branchId: string, productId: string): Promise<StockMovementRecord[]>;
    hasAnyMovement(branchId: string, productId: string): Promise<boolean>;
  };
  purchases: {
    findByDocumentKey(key: string): Promise<{ id: string; docDate: string } | null>;
    insert(p: Omit<PurchaseRecord, 'id'>, items: Omit<PurchaseItemRecord, 'id' | 'purchaseId'>[]): Promise<{ purchase: PurchaseRecord; items: PurchaseItemRecord[] }>;
    getWithItems(id: string): Promise<{ purchase: PurchaseRecord; items: PurchaseItemRecord[] } | null>;
    /** Marca VOIDED y pone documentKey = NULL (libera el documento). */
    markVoided(id: string, v: { reason: string; userId: string; mode: 'EXACT' | 'ADJUSTED'; variance: Peso }): Promise<void>;
    /** Corrige datos del documento (no toca montos ni inventario). */
    updateHeader(id: string, d: { supplierId: string | null; docNumber: string | null; docDate: string; documentKey: string | null; note: string | null }): Promise<void>;
  };
  products: {
    findById(id: string): Promise<ProductWriteRow | null>;
    hasMovements(productId: string): Promise<boolean>;
    save(input: ProductSaveInput): Promise<{ id: string }>;
    archive(id: string, userId: string): Promise<void>;
    restore(id: string): Promise<void>;
    /** Crea (o devuelve) una categoría por nombre, sin distinguir mayúsculas. */
    ensureCategory(name: string): Promise<{ id: string; name: string }>;
  };
  financial: {
    insert(saleId: string, f: Financial): Promise<void>;
    lock(saleId: string): Promise<Financial | null>;
    update(saleId: string, f: Financial, by: string, at: Date): Promise<void>;
  };
  charges: {
    insertMany(saleId: string, plans: ChargePlan[], createdById: string): Promise<void>;
    insertLate(saleId: string, c: { type: ChargeType; amount: Peso; description?: string; reason: string }, createdById: string): Promise<ChargeRecord>;
    get(chargeId: string): Promise<ChargeRecord | null>;
    void(chargeId: string, reason: string, userId: string): Promise<void>;
    sumActive(saleId: string): Promise<Peso>;
  };
  audit: { write(e: AuditEntry): Promise<void> };
  settings: SettingsTx;
  suppliers: { save(i: SupplierSaveInput): Promise<{ id: string; before: SupplierRow | null }> };
  expenses: {
    insert(e: ExpenseInsert): Promise<{ id: string }>;
    /** Gasto CONFIRMED con el mismo proveedor (o sin proveedor), tipo y n° de documento: evita registrar dos veces la misma factura. */
    findDuplicate(e: { supplierId: string | null; docType: string; docNumber: string }): Promise<{ id: string; expenseDate: string } | null>;
    getForUpdate(id: string): Promise<{ id: string; status: 'CONFIRMED' | 'VOIDED' } | null>;
    markVoided(id: string, reason: string, userId: string): Promise<void>;
    ensureCategory(name: string): Promise<{ id: string; name: string }>;
    updateCategory(id: string, d: { name: string; isActive: boolean }): Promise<{ name: string; isActive: boolean } | null>;
    categoryActive(id: string): Promise<boolean | null>;
  };
}
export interface UnitOfWork { run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }

/** Lecturas fuera de transacción. */
export interface CatalogReader {
  loadProducts(ids: string[]): Promise<Map<string, CatalogProduct>>;
  loadUnits(): Promise<Map<string, UnitDef>>;
  loadFeeRules(): Promise<FeeRuleDef[]>;
  businessSettings(): Promise<{ legalName: string; taxId: string | null; address: string | null; timezone: string; vatRate: number; receiptFooter?: string | null }>;
  findSaleByIdempotencyKey(key: string): Promise<SaleRecord | null>;
  loadChannel(id: string): Promise<{ id: string; isActive: boolean } | null>;
  loadPaymentMethods(ids: string[]): Promise<Map<string, { id: string; isActive: boolean }>>;
  /** Activos, en el orden configurado (para la caja). */
  listChannels(): Promise<{ id: string; code: string; name: string }[]>;
  listPaymentMethods(): Promise<{ id: string; code: string; name: string }[]>;
}

export interface PurchaseRecord {
  id: string; branchId: string; supplierId: string | null; docType: DocType; docNumber: string | null; docDate: string; status: 'CONFIRMED' | 'VOIDED';
  pricesIncludeVat: boolean; vatRecoverable: boolean; netAmount: Peso; vatAmount: Peso; totalAmount: Peso; documentKey: string | null; createdById: string;
  note?: string | null; voidReason?: string | null; voidMode?: 'EXACT' | 'ADJUSTED' | null; voidVariance?: Peso | null;
}
export interface PurchaseItemRecord {
  id: string; purchaseId: string; productId: string; presentationId: string | null; nameSnapshot: string; enteredQuantity: Milli; enteredUnit: string;
  quantity: Milli; lineNet: Peso; lineVat: Peso; lineTotal: Peso; costBasis: Peso;
}
export interface ProductWriteRow { id: string; sku: string; name: string; kind: 'GOODS' | 'SERVICE'; unitCode: string; salePrice: Peso; isActive: boolean }
export interface ProductSaveInput { id?: string; sku: string; name: string; unitCode: string; kind: 'GOODS' | 'SERVICE'; salePrice: Peso; categoryId?: string | null; vatTreatment: 'AFECTO' | 'EXENTO'; barcodes?: string[]; brand?: string | null }
export interface ProductListFilter { q?: string; categoryId?: string | null; status: 'active' | 'archived' | 'all'; page: number; pageSize: number }
export interface ProductFormOptions { units: { code: string; name: string; symbol: string }[]; categories: { id: string; name: string }[] }

/** Fila cruda de búsqueda. Puede traer datos sensibles SOLO en el campo `adminOnly`; los DTO públicos jamás lo leen. */
export interface ProductSearchRow {
  id: string; sku: string; name: string; unitCode: string; salePrice: Peso; kind: 'GOODS' | 'SERVICE'; stockQty: Milli | null;
  presentations: { id: string; name: string; salePrice: Peso | null; baseQuantity: Milli }[]; category: string | null; isActive: boolean;
  brand?: string | null; barcodes?: string[]; categoryId?: string | null; vatTreatment?: 'AFECTO' | 'EXENTO';
  adminOnly?: { inventoryValue: Peso | null; stockQty: Milli | null };
}
export interface ProductReader {
  /** Busca por nombre/SKU O código de barras exacto. Solo productos activos para el vendedor (lo decide el servicio con includeInactive). */
  search(q: string, branchId: string, opts: { limit: number; includeInactive: boolean; withAdminData: boolean }): Promise<ProductSearchRow[]>;
  getById(id: string, branchId: string, withAdminData: boolean): Promise<ProductSearchRow | null>;
  /** Listado del ADMINISTRADOR (paginado). Trae adminOnly. */
  listAdmin(branchId: string, f: ProductListFilter): Promise<{ total: number; rows: ProductSearchRow[] }>;
  options(): Promise<ProductFormOptions>;
  /** Costo de referencia (pesos por unidad base) registrado al importar el catálogo; solo para proponer el saldo inicial. SENSIBLE. */
  referenceCosts(productIds: string[]): Promise<Map<string, Peso>>;
  /** ¿Tiene movimientos de stock en la sucursal? (decide saldo inicial vs. ajuste por conteo) */
  withMovements(branchId: string, productIds: string[]): Promise<Set<string>>;
}
export interface SalesReader {
  /** TODA consulta de ventas aplica el alcance (saleScopeFor). */
  list(scope: SaleScope, branchId: string, limit: number): Promise<SaleRecord[]>;
  financialOf(saleId: string): Promise<{ financial: Financial; charges: ChargeRecord[] } | null>;
  /** Listado del ADMINISTRADOR por rango de días de negocio (incluye anuladas). */
  listAdmin(branchId: string, f: SaleListFilter): Promise<{ rows: SaleListRow[]; totals: { count: number; total: Peso } }>;
  /** Datos de presentación de una venta (canal, vendedor, pagos). No incluye costos. */
  meta(saleId: string): Promise<SaleMeta | null>;
}
export interface SaleListFilter { from: string; to: string; status?: 'COMPLETED' | 'VOIDED'; sellerId?: string; limit: number }
export interface SaleListRow { id: string; folio: number; soldAt: Date; businessDate: string; total: Peso; status: 'COMPLETED' | 'VOIDED'; channel: string; seller: string; payments: { method: string; amount: Peso }[]; externalRef: string | null }
export interface SaleMeta { channel: string; seller: string; payments: { method: string; amount: Peso }[]; externalRef: string | null; note: string | null; voidReason: string | null; voidedAt: Date | null; voidedBy: string | null }
export interface ReportReader {
  sellerToday(userId: string, businessDate: string): Promise<{ count: number; total: Peso }>;
  financial(range: { from: string; to: string }, branchId: string): Promise<{ sales: number; netTotal: Peso; costOfGoodsSold: Peso; grossProfit: Peso; totalCharges: Peso; realProfit: Peso }>;
  /** Desglose del período (solo ventas COMPLETED). SENSIBLE: incluye costos. */
  breakdown(range: { from: string; to: string }, branchId: string): Promise<ReportBreakdown>;
  /** Foto actual del inventario valorizado. SENSIBLE. */
  inventorySnapshot(branchId: string): Promise<{ productsWithStock: number; productsWithoutStock: number; inventoryValue: Peso; lowStock: { id: string; name: string; sku: string; qty: string }[] }>;
}
export interface ReportMoney { count: number; total: Peso; net: Peso; cost: Peso; gross: Peso; charges: Peso; real: Peso }
export interface ReportBreakdown {
  byDay: ({ date: string } & ReportMoney)[];
  byProduct: { productId: string; name: string; sku: string; qty: string; total: Peso; net: Peso; cost: Peso; gross: Peso }[];
  bySeller: ({ userId: string; name: string } & ReportMoney)[];
  byChannel: ({ name: string } & ReportMoney)[];
  byPayment: { name: string; count: number; amount: Peso }[];
  charges: { type: string; amount: Peso; count: number }[];
  voided: { count: number; total: Peso };
}
export interface UserStore {
  getById(id: string): Promise<{ id: string; email: string; role: 'ADMINISTRADOR' | 'VENDEDOR'; banned: boolean } | null>;
  countActiveAdmins(): Promise<number>;
  list(): Promise<UserListRow[]>;
}
export interface UserListRow { id: string; name: string; email: string; role: 'ADMINISTRADOR' | 'VENDEDOR'; banned: boolean; banReason: string | null; mustChangePassword: boolean; lastLoginAt: Date | null; createdAt: Date }
/** Operaciones de cuentas que debe hacer Better Auth (hash de contraseña, sesiones). Adaptador real: src/core/auth/auth-admin.ts (sin verificar). */
export interface AuthAdmin {
  createUser(i: { name: string; email: string; role: 'ADMINISTRADOR' | 'VENDEDOR'; tempPassword: string }): Promise<{ id: string }>;
  setBanned(userId: string, banned: boolean, reason?: string): Promise<void>; // al desactivar, revoca sesiones
  setRole(userId: string, role: 'ADMINISTRADOR' | 'VENDEDOR'): Promise<void>;
  /** Contraseña temporal: la fija Better Auth (hash), revoca sesiones y obliga a cambiarla al entrar. */
  setPassword(userId: string, tempPassword: string): Promise<void>;
}
/** Todo lo que necesita la composición. Implementación real: src/repositories/prisma (Prisma 7). Pruebas: tests/helpers/fake-db.ts. */
export interface Ports { uow: UnitOfWork; catalog: CatalogReader; products: ProductReader; sales: SalesReader; reports: ReportReader; users: UserStore; authAdmin: AuthAdmin; settings: SettingsStore; purchases: PurchaseReader; expenses: ExpenseReader; now?: () => Date }

// ---------------------------------------------------------------- configuración (solo ADMINISTRADOR)
export interface BusinessSettingsRow { legalName: string; taxId: string | null; address: string | null; phone: string | null; email: string | null; receiptFooter: string | null; timezone: string; vatRate: number }
export interface FeeRuleRow { id: string | null; target: 'PAYMENT_METHOD' | 'CHANNEL'; targetId: string; targetName: string; targetCode: string; percentMilli: number; fixedAmount: Peso; isManualPerSale: boolean; isActive: boolean; vatTreatment: 'UNDEFINED' | 'RECOVERABLE' | 'NOT_RECOVERABLE' }
export interface CatalogEntryRow { id: string; code: string; name: string; isActive: boolean; sortOrder: number }
export interface SettingsStore {
  get(): Promise<BusinessSettingsRow>;
  feeRules(): Promise<FeeRuleRow[]>;                         // una fila por medio de pago y por canal (id null = sin regla aún)
  channels(): Promise<CatalogEntryRow[]>;
  paymentMethods(): Promise<CatalogEntryRow[]>;
}
/** Escrituras de configuración (dentro de una transacción). Devuelven el estado anterior para la auditoría. */
export interface SettingsTx {
  updateBusiness(d: Omit<BusinessSettingsRow, 'timezone' | 'vatRate'>): Promise<BusinessSettingsRow>;
  upsertFeeRule(target: 'PAYMENT_METHOD' | 'CHANNEL', targetId: string, d: { percentMilli: number; fixedAmount: Peso; isManualPerSale: boolean; isActive: boolean; vatTreatment: FeeRuleRow['vatTreatment'] }): Promise<FeeRuleRow | null>;
  updateEntry(kind: 'channel' | 'paymentMethod', id: string, d: { name: string; isActive: boolean }): Promise<CatalogEntryRow | null>;
  /** Alta de canal o medio de pago (al final del orden). Código único. */
  createEntry(kind: 'channel' | 'paymentMethod', d: { code: string; name: string }): Promise<CatalogEntryRow>;
}

// ---------------------------------------------------------------- compras y proveedores (lectura; SOLO ADMINISTRADOR)
export interface SupplierRow { id: string; name: string; taxId: string | null; contactName: string | null; phone: string | null; email: string | null; notes: string | null; isActive: boolean }
export interface SupplierSaveInput { id?: string; name: string; taxId: string | null; contactName: string | null; phone: string | null; email: string | null; notes: string | null; isActive: boolean }
export interface PurchaseListRow { id: string; docType: 'FACTURA' | 'BOLETA' | 'OTRO'; docNumber: string | null; docDate: string; supplier: string | null; status: 'CONFIRMED' | 'VOIDED'; netAmount: Peso; vatAmount: Peso; totalAmount: Peso; items: number; createdAt: Date }
export interface PurchaseDetail { purchase: PurchaseRecord; supplier: string | null; createdBy: string; createdAt: Date; voidedBy: string | null; voidedAt: Date | null; items: (PurchaseItemRecord & { sku: string; unit: string })[] }
export interface PurchaseReader {
  list(branchId: string, f: { from: string; to: string; supplierId?: string; status?: 'CONFIRMED' | 'VOIDED'; limit: number }): Promise<{ rows: PurchaseListRow[]; totals: { count: number; net: Peso; vat: Peso; total: Peso } }>;
  detail(id: string): Promise<PurchaseDetail | null>;
  suppliers(includeInactive: boolean): Promise<SupplierRow[]>;
}

// ---------------------------------------------------------------- gastos (SOLO ADMINISTRADOR)
export interface ExpenseRecord {
  id: string; branchId: string; categoryId: string; category: string; supplierId: string | null; supplier: string | null; description: string;
  docType: 'FACTURA' | 'BOLETA' | 'OTRO' | null; docNumber: string | null; expenseDate: string; status: 'CONFIRMED' | 'VOIDED'; vatRecoverable: boolean;
  netAmount: Peso; vatAmount: Peso; totalAmount: Peso; createdBy: string; createdAt: Date; voidReason: string | null; voidedBy: string | null;
}
export interface ExpenseCategoryRow { id: string; name: string; isActive: boolean }
export interface ExpenseReader {
  list(branchId: string, f: { from: string; to: string; categoryId?: string; status?: 'CONFIRMED' | 'VOIDED'; limit: number }): Promise<ExpenseRecord[]>;
  get(id: string): Promise<ExpenseRecord | null>;
  categories(includeInactive: boolean): Promise<ExpenseCategoryRow[]>;
  /** Totales del período por categoría (solo CONFIRMED). resultCost = neto si el IVA es recuperable, si no el total. */
  totalsByCategory(branchId: string, range: { from: string; to: string }): Promise<{ category: string; count: number; total: Peso; resultCost: Peso }[]>;
}
export interface ExpenseInsert { branchId: string; categoryId: string; supplierId: string | null; description: string; docType: 'FACTURA' | 'BOLETA' | 'OTRO' | null; docNumber: string | null;
  expenseDate: string; vatRecoverable: boolean; netAmount: Peso; vatAmount: Peso; totalAmount: Peso; createdById: string }
