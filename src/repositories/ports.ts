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
  };
  products: {
    findById(id: string): Promise<ProductWriteRow | null>;
    hasMovements(productId: string): Promise<boolean>;
    save(input: ProductSaveInput): Promise<{ id: string }>;
    archive(id: string, userId: string): Promise<void>;
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
}
export interface UnitOfWork { run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }

/** Lecturas fuera de transacción. */
export interface CatalogReader {
  loadProducts(ids: string[]): Promise<Map<string, CatalogProduct>>;
  loadUnits(): Promise<Map<string, UnitDef>>;
  loadFeeRules(): Promise<FeeRuleDef[]>;
  businessSettings(): Promise<{ legalName: string; taxId: string | null; address: string | null; timezone: string; vatRate: number }>;
  findSaleByIdempotencyKey(key: string): Promise<SaleRecord | null>;
  loadChannel(id: string): Promise<{ id: string; isActive: boolean } | null>;
  loadPaymentMethods(ids: string[]): Promise<Map<string, { id: string; isActive: boolean }>>;
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
export interface ProductSaveInput { id?: string; sku: string; name: string; unitCode: string; kind: 'GOODS' | 'SERVICE'; salePrice: Peso; categoryId?: string | null; vatTreatment: 'AFECTO' | 'EXENTO'; barcodes?: string[] }

/** Fila cruda de búsqueda. Puede traer datos sensibles SOLO en el campo `adminOnly`; los DTO públicos jamás lo leen. */
export interface ProductSearchRow {
  id: string; sku: string; name: string; unitCode: string; salePrice: Peso; kind: 'GOODS' | 'SERVICE'; stockQty: Milli | null;
  presentations: { id: string; name: string; salePrice: Peso | null; baseQuantity: Milli }[]; category: string | null; isActive: boolean;
  adminOnly?: { inventoryValue: Peso | null; stockQty: Milli | null };
}
export interface ProductReader {
  /** Busca por nombre/SKU O código de barras exacto. Solo productos activos para el vendedor (lo decide el servicio con includeInactive). */
  search(q: string, branchId: string, opts: { limit: number; includeInactive: boolean; withAdminData: boolean }): Promise<ProductSearchRow[]>;
  getById(id: string, branchId: string, withAdminData: boolean): Promise<ProductSearchRow | null>;
}
export interface SalesReader {
  /** TODA consulta de ventas aplica el alcance (saleScopeFor). */
  list(scope: SaleScope, branchId: string, limit: number): Promise<SaleRecord[]>;
  financialOf(saleId: string): Promise<{ financial: Financial; charges: ChargeRecord[] } | null>;
}
export interface ReportReader {
  sellerToday(userId: string, businessDate: string): Promise<{ count: number; total: Peso }>;
  financial(range: { from: string; to: string }, branchId: string): Promise<{ sales: number; netTotal: Peso; costOfGoodsSold: Peso; grossProfit: Peso; totalCharges: Peso; realProfit: Peso }>;
}
export interface UserStore {
  getById(id: string): Promise<{ id: string; email: string; role: 'ADMINISTRADOR' | 'VENDEDOR'; banned: boolean } | null>;
  countActiveAdmins(): Promise<number>;
}
/** Operaciones de cuentas que debe hacer Better Auth (hash de contraseña, sesiones). Adaptador real: src/core/auth/auth-admin.ts (sin verificar). */
export interface AuthAdmin {
  createUser(i: { name: string; email: string; role: 'ADMINISTRADOR' | 'VENDEDOR'; tempPassword: string }): Promise<{ id: string }>;
  setBanned(userId: string, banned: boolean, reason?: string): Promise<void>; // al desactivar, revoca sesiones
  setRole(userId: string, role: 'ADMINISTRADOR' | 'VENDEDOR'): Promise<void>;
}
/** Todo lo que necesita la composición. La implementación Prisma (src/repositories/prisma) aún NO existe. */
export interface Ports { uow: UnitOfWork; catalog: CatalogReader; products: ProductReader; sales: SalesReader; reports: ReportReader; users: UserStore; authAdmin: AuthAdmin; now?: () => Date }
