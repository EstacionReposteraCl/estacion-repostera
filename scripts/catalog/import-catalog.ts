// Importa el JSON de tuu-xlsx-to-json.py usando los MISMOS servicios de la app (validaciones, auditoría).
// Idempotente: un SKU que ya existe se omite. El "precio costo" se guarda solo como costo de REFERENCIA en AuditLog
// (product.import) para proponerlo al ingresar el stock inicial; no crea stock ni valor de inventario.
// Uso: IMPORT_ADMIN_EMAIL=... npx tsx scripts/catalog/import-catalog.ts catalogo.json
import { readFileSync } from 'node:fs';
import { prisma } from '../../src/core/db/client.ts';
import { createServices } from '../../src/services/composition.ts';
import { createPrismaPorts } from '../../src/repositories/prisma/index.ts';
import type { Actor } from '../../src/core/permissions/permissions.ts';

interface Row { row: number; name: string; sku: string; salePrice: number; referenceCost: number | null; vatTreatment: 'AFECTO' | 'EXENTO'; barcodes: string[]; brand: string | null; category: string | null; active: boolean }
const ports = createPrismaPorts(prisma);
const svc = createServices(ports);
async function main() {
  const { products } = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { products: Row[] };
  const email = process.env.IMPORT_ADMIN_EMAIL?.trim().toLowerCase(); if (!email) throw new Error('Falta IMPORT_ADMIN_EMAIL');
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  if (u.role !== 'ADMINISTRADOR') throw new Error('IMPORT_ADMIN_EMAIL no es ADMINISTRADOR');
  const branch = await prisma.branch.findFirstOrThrow({ where: { isMain: true, isActive: true } });
  const admin: Actor = { userId: u.id, role: 'ADMINISTRADOR', email: u.email, branchId: branch.id, banned: false };
  const cats = new Map<string, string>(); let created = 0, skipped = 0; const errors: string[] = [];
  for (const r of products) {
    try {
      if (await prisma.product.findUnique({ where: { sku: r.sku } })) { skipped++; continue; }
      let categoryId: string | null = null;
      if (r.category) { categoryId = cats.get(r.category) ?? (await svc.products.createCategory(admin, r.category)).id; cats.set(r.category, categoryId); }
      const { id } = await svc.products.save(admin, { sku: r.sku, name: r.name, unitCode: 'UN', kind: 'GOODS', salePrice: r.salePrice, vatTreatment: r.vatTreatment, categoryId, brand: r.brand, barcodes: r.barcodes });
      await ports.uow.run((tx) => tx.audit.write({ action: 'product.import', entity: 'Product', entityId: id, userId: admin.userId, metadata: { source: 'TUU', row: r.row, referenceCost: r.referenceCost } }));
      if (!r.active) await svc.products.archive(admin, id, 'Deshabilitado en el catálogo importado');
      created++;
    } catch (e) { errors.push(`fila ${r.row} "${r.name}": ${(e as Error).message}`); }
  }
  console.log(JSON.stringify({ creados: created, omitidosYaExistian: skipped, errores: errors }, null, 1));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
