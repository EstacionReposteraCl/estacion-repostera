// CAPA DE COMPOSICIÓN: solo cablea servicios con puertos. NO sabe qué base de datos hay detrás.
// La implementación Prisma de `Ports` aún NO existe (PENDIENTE: src/repositories/prisma). Las pruebas usan FakeDb.ports.
import type { Ports } from '../repositories/ports.ts';
import { createSalesService } from './sales.service.ts';
import { createPurchasesService } from './purchases.service.ts';
import { createInventoryService } from './inventory.service.ts';
import { createProductsService } from './products.service.ts';
import { createReportsService } from './reports.service.ts';
import { createUsersService } from './users.service.ts';

export function createServices(p: Ports) {
  return {
    sales: createSalesService({ uow: p.uow, catalog: p.catalog, sales: p.sales, now: p.now }),
    purchases: createPurchasesService({ uow: p.uow, catalog: p.catalog }),
    inventory: createInventoryService({ uow: p.uow, catalog: p.catalog }),
    products: createProductsService({ uow: p.uow, products: p.products }),
    reports: createReportsService({ catalog: p.catalog, reports: p.reports, now: p.now }),
    users: createUsersService({ uow: p.uow, users: p.users, authAdmin: p.authAdmin }),
  };
}
export type Services = ReturnType<typeof createServices>;
