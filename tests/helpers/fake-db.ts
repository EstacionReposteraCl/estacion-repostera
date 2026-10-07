// Repositorios EN MEMORIA para probar la orquestación de los servicios (sin Prisma, sin BD).
// NO prueba SQL, bloqueos ni triggers: eso es trabajo de la integración contra PostgreSQL real.
import type { Ports, Tx, UnitOfWork, CatalogReader, SaleRecord, SaleItemRecord, ChargeRecord, StockMovementRecord, AuditEntry, PurchaseRecord, PurchaseItemRecord,
  ProductWriteRow, ProductSaveInput, ProductSearchRow, ProductReader, SalesReader, ReportReader, UserStore, AuthAdmin } from '../../src/repositories/ports.ts';
import type { InventoryState } from '../../src/domain/inventory/inventory.ts';
import type { Financial, FeeRuleDef } from '../../src/domain/charges/charges.ts';
import type { CatalogProduct } from '../../src/domain/sales/sale-plan.ts';
import type { UnitDef } from '../../src/core/money/quantity.ts';
import { businessDateOf } from '../../src/core/time/business-date.ts';
import { saleScopeFor } from '../../src/policies/sale.policy.ts';

type FinRow = Financial & { recalculatedById?: string };
interface State {
  sales: Map<string, { sale: SaleRecord; items: SaleItemRecord[]; payments: { methodId: string; amount: number }[] }>;
  inv: Map<string, InventoryState>; movements: StockMovementRecord[]; itemCosts: Map<string, number>; fin: Map<string, FinRow>; charges: ChargeRecord[];
  audit: AuditEntry[]; folio: Map<string, number>; purchases: Map<string, { purchase: PurchaseRecord; items: PurchaseItemRecord[] }>; prodRows: Map<string, ProductWriteRow>;
}
const clone = (s: State): State => ({
  sales: new Map(s.sales), inv: new Map([...s.inv].map(([k, v]) => [k, { ...v }])), movements: [...s.movements], itemCosts: new Map(s.itemCosts),
  fin: new Map([...s.fin].map(([k, v]) => [k, { ...v }])), charges: s.charges.map((c) => ({ ...c })), audit: [...s.audit], folio: new Map(s.folio),
  purchases: new Map([...s.purchases].map(([k, v]) => [k, { purchase: { ...v.purchase }, items: v.items }])), prodRows: new Map([...s.prodRows].map(([k, v]) => [k, { ...v }])),
});

export class FakeDb implements State {
  sales: State['sales'] = new Map(); inv: State['inv'] = new Map(); movements: StockMovementRecord[] = []; itemCosts: State['itemCosts'] = new Map();
  fin: State['fin'] = new Map(); charges: ChargeRecord[] = []; audit: AuditEntry[] = []; folio: State['folio'] = new Map();
  purchases: State['purchases'] = new Map(); prodRows: State['prodRows'] = new Map();
  products = new Map<string, CatalogProduct>(); units = new Map<string, UnitDef>(); rules: FeeRuleDef[] = [];
  channels = new Map<string, { id: string; isActive: boolean }>([['LOCAL', { id: 'LOCAL', isActive: true }], ['ML', { id: 'ML', isActive: true }]]);
  methods = new Map<string, { id: string; isActive: boolean }>([['DEBIT', { id: 'DEBIT', isActive: true }], ['CASH', { id: 'CASH', isActive: true }], ['CREDIT', { id: 'CREDIT', isActive: true }]]);
  users = new Map<string, { id: string; email: string; role: 'ADMINISTRADOR' | 'VENDEDOR'; banned: boolean }>(); sessionsRevoked: string[] = [];
  settings = { legalName: 'OVELIX SPA', taxId: '78.485.985-1', address: 'Santiago', timezone: 'America/Santiago', vatRate: 19 };
  clock = new Date('2026-10-06T15:00:00Z'); now = () => this.clock;
  private n = 0; private chain: Promise<unknown> = Promise.resolve();
  id(p: string) { return `${p}${++this.n}`; }
  key(b: string, p: string) { return `${b}|${p}`; }
  setStock(b: string, p: string, qty: bigint, value: number, seq = 0) { this.inv.set(this.key(b, p), { qty, value, seq }); }

  uow: UnitOfWork = {
    run: <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
      const exec = async () => { const snap = clone(this); try { return await fn(this.tx()); } catch (e) { Object.assign(this, snap); throw e; } };
      const p = this.chain.then(exec, exec); this.chain = p.catch(() => undefined); return p;
    },
  };
  catalog: CatalogReader = {
    loadProducts: async (ids) => new Map(ids.filter((i) => this.products.has(i)).map((i) => [i, this.products.get(i)!])),
    loadUnits: async () => this.units, loadFeeRules: async () => this.rules, businessSettings: async () => this.settings,
    findSaleByIdempotencyKey: async (k) => [...this.sales.values()].map((s) => s.sale).find((s) => s.idempotencyKey === k) ?? null,
    loadChannel: async (id) => this.channels.get(id) ?? null,
    loadPaymentMethods: async (ids) => new Map(ids.filter((i) => this.methods.has(i)).map((i) => [i, this.methods.get(i)!])),
  };
  /** Fila "cruda" con TODO lo sensible poblado a propósito: los DTO del vendedor no deben filtrarlo. */
  productReader: ProductReader = {
    search: async (q, branchId, o) => [...this.products.values()].filter((p) => (o.includeInactive || p.isActive) && (p.name.toLowerCase().includes(q.toLowerCase()) || p.sku === q)).slice(0, o.limit).map((p) => this.row(p, branchId, o.withAdminData)),
    getById: async (id, branchId, w) => { const p = this.products.get(id); return p ? this.row(p, branchId, w) : null; },
    listAdmin: async (branchId, f) => { const all = [...this.products.values()].filter((p) => (f.status === 'all' || (f.status === 'active') === p.isActive) && (!f.q || p.name.toLowerCase().includes(f.q.toLowerCase()) || p.sku === f.q));
      return { total: all.length, rows: all.slice((f.page - 1) * f.pageSize, f.page * f.pageSize).map((p) => this.row(p, branchId, true)) }; },
    referenceCosts: async () => new Map(),
    withMovements: async (b, ids) => new Set(ids.filter((id) => this.movements.some((m) => m.branchId === b && m.productId === id))),
    options: async () => ({ units: [...this.units.keys()].map((c) => ({ code: c, name: c, symbol: c })), categories: [] }),
  };
  private row(p: CatalogProduct, branchId: string, admin: boolean): ProductSearchRow {
    const st = this.inv.get(this.key(branchId, p.id));
    return { id: p.id, sku: p.sku, name: p.name, unitCode: p.unit.code, salePrice: p.salePrice, kind: p.kind, stockQty: p.kind === 'GOODS' ? (st?.qty ?? 0n) : null, category: null, isActive: p.isActive,
      presentations: p.presentations.map((x) => ({ id: x.id, name: x.name, salePrice: x.salePrice, baseQuantity: x.baseQuantity })),
      ...(admin ? { adminOnly: { inventoryValue: st?.value ?? null, stockQty: st?.qty ?? null } } : {}) };
  }
  salesReader: SalesReader = {
    list: async (scope, _b, limit) => [...this.sales.values()].map((s) => s.sale).filter((s) => (!scope.createdById || s.createdById === scope.createdById) && (!scope.businessDate || s.businessDate === scope.businessDate)).slice(0, limit),
    financialOf: async (id) => { const f = this.fin.get(id); return f ? { financial: { ...f }, charges: this.charges.filter((c) => c.saleId === id) } : null; },
  };
  reportReader: ReportReader = {
    sellerToday: async (uid, date) => { const l = [...this.sales.values()].map((s) => s.sale).filter((s) => s.createdById === uid && s.businessDate === date && s.status === 'COMPLETED'); return { count: l.length, total: l.reduce((a, s) => a + s.total, 0) }; },
    financial: async () => { const z = { sales: 0, netTotal: 0, costOfGoodsSold: 0, grossProfit: 0, totalCharges: 0, realProfit: 0 };
      for (const { sale } of this.sales.values()) { if (sale.status !== 'COMPLETED') continue; const f = this.fin.get(sale.id)!; z.sales++; z.netTotal += f.netTotal; z.costOfGoodsSold += f.costOfGoodsSold; z.grossProfit += f.grossProfit; z.totalCharges += f.totalCharges; z.realProfit += f.realProfit; } return z; },
  };
  userStore: UserStore = { getById: async (id) => this.users.get(id) ?? null, countActiveAdmins: async () => [...this.users.values()].filter((u) => u.role === 'ADMINISTRADOR' && !u.banned).length };
  authAdmin: AuthAdmin = {
    createUser: async (i) => { const id = this.id('user'); this.users.set(id, { id, email: i.email, role: i.role, banned: false }); return { id }; },
    setBanned: async (id, b) => { this.users.get(id)!.banned = b; if (b) this.sessionsRevoked.push(id); }, setRole: async (id, r) => { this.users.get(id)!.role = r; },
  };
  get ports(): Ports { return { uow: this.uow, catalog: this.catalog, products: this.productReader, sales: this.salesReader, reports: this.reportReader, users: this.userStore, authAdmin: this.authAdmin, now: this.now }; }

  private tx(): Tx {
    const self = this;
    return {
      sales: {
        async findByIdempotencyKey(k) { return [...self.sales.values()].map((s) => s.sale).find((s) => s.idempotencyKey === k) ?? null; },
        async nextFolio(b) { const n = (self.folio.get(b) ?? 0) + 1; self.folio.set(b, n); return n; },
        async insert(s, items, payments) {
          const sale: SaleRecord = { ...s, id: self.id('sale') }; const recs = items.map((i) => ({ ...i, id: self.id('item'), saleId: sale.id }));
          self.sales.set(sale.id, { sale, items: recs, payments }); return { sale, items: recs };
        },
        async getWithItems(id) { const s = self.sales.get(id); return s ? { sale: { ...s.sale }, items: s.items, payments: s.payments } : null; },
        async markVoided(id, reason) { const s = self.sales.get(id)!; s.sale = { ...s.sale, status: 'VOIDED', voidReason: reason }; },
      },
      inventory: {
        async lockState(b, p) { const k = self.key(b, p); if (!self.inv.has(k)) self.inv.set(k, { qty: 0n, value: 0, seq: 0 }); return { ...self.inv.get(k)! }; },
        async saveState(b, p, s) { self.inv.set(self.key(b, p), { ...s }); },
        async appendMovement(m) {
          if (self.movements.some((x) => x.branchId === m.branchId && x.productId === m.productId && x.seq === m.seq)) throw new Error('seq duplicado (unique branch,product,seq)');
          self.movements.push(m);
        },
        async saveItemCost(id, c) { self.itemCosts.set(id, c); },
        async getItemCost(id) { return self.itemCosts.get(id) ?? null; },
        async purchaseMovementSeq(itemId) { return self.movements.find((m) => m.purchaseItemId === itemId && m.type === 'PURCHASE')?.seq ?? null; },
        async listMovements(b, p) { return self.movements.filter((m) => m.branchId === b && m.productId === p); },
        async hasAnyMovement(b, p) { return self.movements.some((m) => m.branchId === b && m.productId === p); },
      },
      purchases: {
        async findByDocumentKey(k) { const r = [...self.purchases.values()].find((x) => x.purchase.documentKey === k); return r ? { id: r.purchase.id, docDate: r.purchase.docDate } : null; },
        async insert(p, items) {
          if (p.documentKey && [...self.purchases.values()].some((x) => x.purchase.documentKey === p.documentKey)) throw new Error('duplicate key documentKey');
          const purchase = { ...p, id: self.id('pur') }; const recs = items.map((i) => ({ ...i, id: self.id('pit'), purchaseId: purchase.id })); self.purchases.set(purchase.id, { purchase, items: recs }); return { purchase, items: recs };
        },
        async getWithItems(id) { const r = self.purchases.get(id); return r ? { purchase: { ...r.purchase }, items: r.items } : null; },
        async markVoided(id, v) { const r = self.purchases.get(id)!; r.purchase = { ...r.purchase, status: 'VOIDED', documentKey: null, voidReason: v.reason, voidMode: v.mode, voidVariance: v.variance }; },
      },
      products: {
        async findById(id) { return self.prodRows.get(id) ?? null; },
        async hasMovements(id) { return self.movements.some((m) => m.productId === id); },
        async save(i: ProductSaveInput) { const id = i.id ?? self.id('prod'); self.prodRows.set(id, { id, sku: i.sku, name: i.name, kind: i.kind, unitCode: i.unitCode, salePrice: i.salePrice, isActive: true }); return { id }; },
        async archive(id) { const r = self.prodRows.get(id)!; r.isActive = false; },
        async restore(id) { const r = self.prodRows.get(id)!; r.isActive = true; },
        async ensureCategory(name) { return { id: 'cat-' + name.toLowerCase(), name }; },
      },
      financial: {
        async insert(id, f) { self.fin.set(id, { ...f }); },
        async lock(id) { const f = self.fin.get(id); return f ? { ...f } : null; },
        async update(id, f, by) { self.fin.set(id, { ...f, recalculatedById: by }); },
      },
      charges: {
        async insertMany(saleId, plans, by) { for (const p of plans) self.charges.push({ id: self.id('chg'), saleId, createdById: by, createdAt: new Date(), voidedAt: null, type: p.type, amount: p.amount, baseAmount: p.baseAmount, percentMilli: p.percentMilli, fixedApplied: p.fixedApplied, source: 'RULE', addedAfterClose: false }); },
        async insertLate(saleId, c, by) { const r = { id: self.id('chg'), saleId, createdById: by, createdAt: new Date(), voidedAt: null, type: c.type, amount: c.amount, baseAmount: null, percentMilli: null, fixedApplied: null, source: 'MANUAL', addedAfterClose: true, description: c.description, reason: c.reason } as unknown as ChargeRecord; self.charges.push(r); return r; },
        async get(id) { return self.charges.find((c) => c.id === id) ?? null; },
        async void(id, reason) { const c = self.charges.find((x) => x.id === id)!; c.voidedAt = new Date(); c.reason = reason; },
        async sumActive(saleId) { return self.charges.filter((c) => c.saleId === saleId && !c.voidedAt).reduce((s, c) => s + c.amount, 0); },
      },
      audit: { async write(e) { self.audit.push(e); } },
    };
  }
}
export { businessDateOf, saleScopeFor };
