// CAPA DE COMPOSICIÓN: solo cablea servicios con puertos. NO sabe qué base de datos hay detrás.
// Implementación real: src/repositories/prisma. Las pruebas unitarias usan FakeDb.ports.
import type { Ports } from '../repositories/ports.ts';
import { createSalesService } from './sales.service.ts';
import { createPurchasesService } from './purchases.service.ts';
import { createInventoryService } from './inventory.service.ts';
import { createProductsService } from './products.service.ts';
import { createReportsService } from './reports.service.ts';
import { createUsersService } from './users.service.ts';
import { createSettingsService } from './settings.service.ts';
import { createExpensesService } from './expenses.service.ts';
import { createCashService } from './cash.service.ts';
import { createMoneyService } from './money.service.ts';

export function createServices(p: Ports) {
  return {
    sales: createSalesService({ uow: p.uow, catalog: p.catalog, sales: p.sales, now: p.now }),
    purchases: createPurchasesService({ uow: p.uow, catalog: p.catalog, purchases: p.purchases }),
    inventory: createInventoryService({ uow: p.uow, catalog: p.catalog }),
    products: createProductsService({ uow: p.uow, products: p.products }),
    reports: createReportsService({ catalog: p.catalog, reports: p.reports, expenses: p.expenses, now: p.now }),
    users: createUsersService({ uow: p.uow, users: p.users, authAdmin: p.authAdmin }),
    settings: createSettingsService({ uow: p.uow, settings: p.settings }),
    expenses: createExpensesService({ uow: p.uow, expenses: p.expenses, catalog: p.catalog, now: p.now }),
    cash: createCashService({ uow: p.uow, cash: p.cash, catalog: p.catalog, now: p.now }),
    money: createMoneyService({ uow: p.uow, money: p.money, catalog: p.catalog, now: p.now }),
  };
}
export type Services = ReturnType<typeof createServices>;
