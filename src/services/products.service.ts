import { assertCan, type Actor } from '../core/permissions/permissions.ts';
import { notFound, validation, businessRule } from '../core/errors/index.ts';
import type { UnitOfWork, ProductReader, ProductSaveInput, ProductListFilter, ProductFormOptions } from '../repositories/ports.ts';
import { toProductPublicDTO, toProductAdminDTO, type ProductPublicDTO, type ProductAdminDTO } from '../dto/product.dto.ts';

export interface Deps { uow: UnitOfWork; products: ProductReader }

export function createProductsService({ uow, products }: Deps) {
  return {
    /** Búsqueda por nombre O código de barras. Vendedor: solo activos y DTO público (nunca `adminOnly`). */
    async search(actor: Actor | null, q: string, limit = 20): Promise<ProductPublicDTO[]> {
      assertCan(actor, 'product.read.public');
      const text = q.trim(); if (!text) return [];
      const rows = await products.search(text, actor.branchId, { limit: Math.min(Math.max(limit, 1), 50), includeInactive: false, withAdminData: false });
      return rows.map(toProductPublicDTO);
    },
    /** Listado completo del ADMINISTRADOR (con costo promedio y valor). Paginado. */
    async listAdmin(actor: Actor | null, f: Partial<ProductListFilter>): Promise<{ total: number; page: number; pageSize: number; rows: ProductAdminDTO[] }> {
      assertCan(actor, 'product.read.admin');
      const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200); const page = Math.max(Math.trunc(f.page ?? 1), 1);
      const r = await products.listAdmin(actor.branchId, { q: f.q?.trim() || undefined, categoryId: f.categoryId || null, status: f.status ?? 'active', page, pageSize });
      return { total: r.total, page, pageSize, rows: r.rows.map(toProductAdminDTO) };
    },
    async formOptions(actor: Actor | null): Promise<ProductFormOptions> { assertCan(actor, 'product.write'); return products.options(); },
    /** Reactivar un producto archivado (auditado). */
    async restore(actor: Actor | null, id: string): Promise<void> {
      assertCan(actor, 'product.archive');
      await uow.run(async (tx) => { if (!(await tx.products.findById(id))) throw notFound('Producto'); await tx.products.restore(id); await tx.audit.write({ action: 'product.restore', entity: 'Product', entityId: id, userId: actor.userId }); });
    },
    async createCategory(actor: Actor | null, name: string): Promise<{ id: string; name: string }> {
      assertCan(actor, 'category.write'); const n = name.trim();
      if (n.length < 2 || n.length > 60) throw validation('El nombre de la categoría debe tener entre 2 y 60 caracteres.');
      return uow.run(async (tx) => { const c = await tx.products.ensureCategory(n); await tx.audit.write({ action: 'category.ensure', entity: 'Category', entityId: c.id, userId: actor.userId, metadata: { name: c.name } }); return c; });
    },
    /** Datos para la pantalla de stock: si cada producto ya tiene movimientos y su costo de referencia importado. SOLO ADMINISTRADOR. */
    async stockSetupInfo(actor: Actor | null, productIds: string[]): Promise<{ withMovements: Set<string>; referenceCosts: Map<string, number> }> {
      assertCan(actor, 'inventory.read.cost');
      const [withMovements, referenceCosts] = await Promise.all([products.withMovements(actor.branchId, productIds), products.referenceCosts(productIds)]);
      return { withMovements, referenceCosts };
    },
    async getAdmin(actor: Actor | null, id: string): Promise<ProductAdminDTO> {
      assertCan(actor, 'product.read.admin');
      const r = await products.getById(id, actor.branchId, true); if (!r) throw notFound('Producto'); return toProductAdminDTO(r);
    },
    /** La unidad base y el tipo son inmutables si ya hay movimientos. Todo cambio de precio queda en AuditLog. */
    async save(actor: Actor | null, input: ProductSaveInput): Promise<{ id: string }> {
      assertCan(actor, 'product.write');
      if (!input.sku.trim() || !input.name.trim()) throw validation('SKU y nombre son obligatorios.');
      if (!Number.isSafeInteger(input.salePrice) || input.salePrice < 0) throw validation('El precio debe ser un entero en pesos (con IVA).');
      return uow.run(async (tx) => {
        const prev = input.id ? await tx.products.findById(input.id) : null;
        if (input.id && !prev) throw notFound('Producto');
        if (prev && (await tx.products.hasMovements(prev.id))) {
          if (prev.unitCode !== input.unitCode) throw businessRule('La unidad base no se puede cambiar: el producto ya tiene movimientos.');
          if (prev.kind !== input.kind) throw businessRule('El tipo del producto no se puede cambiar: ya tiene movimientos.');
        }
        const saved = await tx.products.save(input);
        if (prev && prev.salePrice !== input.salePrice) await tx.audit.write({ action: 'product.price_change', entity: 'Product', entityId: saved.id, userId: actor.userId, before: { salePrice: prev.salePrice }, after: { salePrice: input.salePrice } });
        return saved;
      });
    },
    /** Archivar, nunca borrar. Motivo obligatorio. */
    async archive(actor: Actor | null, id: string, reason: string): Promise<void> {
      assertCan(actor, 'product.archive'); if (!reason.trim()) throw validation('Archivar exige un motivo.');
      await uow.run(async (tx) => { if (!(await tx.products.findById(id))) throw notFound('Producto'); await tx.products.archive(id, actor.userId); await tx.audit.write({ action: 'product.archive', entity: 'Product', entityId: id, userId: actor.userId, metadata: { reason } }); });
    },
  };
}
export type ProductsService = ReturnType<typeof createProductsService>;
