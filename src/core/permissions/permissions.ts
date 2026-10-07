import { forbidden, unauthenticated } from '../errors/index.ts';

export type Role = 'ADMINISTRADOR' | 'VENDEDOR';
export interface Actor { userId: string; role: Role; email: string; branchId: string; banned: boolean }

export const PERMISSIONS = [
  // ventas
  'sale.create', 'sale.read.own_today', 'sale.read.any', 'sale.reprint.own_today', 'sale.reprint.any', 'sale.void',
  'sale.price_override', 'sale.discount', 'sale.charge.add', 'sale.charge.void', 'sale.return',
  // catálogo e inventario
  'product.read.public', 'product.read.admin', 'product.write', 'product.archive', 'category.write', 'unit.read',
  'inventory.read.stock', 'inventory.read.cost', 'inventory.adjust', 'inventory.waste', 'inventory.cost_correction',
  // compras, gastos, proveedores
  'purchase.read', 'purchase.create', 'purchase.void', 'supplier.read', 'supplier.write', 'expense.read', 'expense.write',
  // finanzas
  'report.sales_basic', 'report.financial', 'feerule.read', 'feerule.write', 'dashboard.seller', 'dashboard.admin',
  // administración
  'user.read', 'user.write', 'settings.write', 'channel.write', 'paymentmethod.write', 'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VENDEDOR: ReadonlySet<Permission> = new Set<Permission>([
  'sale.create', 'sale.read.own_today', 'sale.reprint.own_today', 'product.read.public', 'unit.read',
  'inventory.read.stock', 'dashboard.seller',
]);
const ADMIN: ReadonlySet<Permission> = new Set<Permission>(PERMISSIONS);

/** Lista blanca explícita: un permiso nuevo NO se concede al vendedor salvo que se agregue arriba. */
export function can(role: Role, perm: Permission): boolean {
  return role === 'ADMINISTRADOR' ? ADMIN.has(perm) : VENDEDOR.has(perm);
}

export function assertCan(actor: Actor | null | undefined, perm: Permission): asserts actor is Actor {
  if (!actor) throw unauthenticated();
  if (actor.banned) throw unauthenticated();
  if (!can(actor.role, perm)) throw forbidden();
}
export function permissionsOf(role: Role): Permission[] { return PERMISSIONS.filter((p) => can(role, p)); }
