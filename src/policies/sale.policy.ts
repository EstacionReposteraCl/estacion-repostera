// POLÍTICAS de alcance de datos (qué filas puede ver cada rol). Puras y testeables.
import type { Actor } from '../core/permissions/permissions.ts';

export interface SaleScope { createdById?: string; businessDate?: string }
/** Filtro que TODA consulta de ventas debe aplicar en el repositorio. Administrador: sin filtro. Vendedor: sus ventas de hoy. */
export function saleScopeFor(actor: Actor, today: string): SaleScope {
  return actor.role === 'ADMINISTRADOR' ? {} : { createdById: actor.userId, businessDate: today };
}
export function canViewSale(actor: Actor, sale: { createdById: string; businessDate: string }, today: string): boolean {
  const s = saleScopeFor(actor, today);
  return (s.createdById === undefined || s.createdById === sale.createdById) && (s.businessDate === undefined || s.businessDate === sale.businessDate);
}
