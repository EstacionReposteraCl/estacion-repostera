// La batería de 63 reglas SQL ya NO es una lista de `todo` aquí: vive en tests/integration/sql/run.py (psql, filas completas).
//   npm run test:sql-rules   -> contra la base indicada en PSQL_CMD
// Estado: 63/63 contra un DDL DERIVADO de schema.prisma (no Prisma). Contra la MIGRACIÓN REAL de Prisma: PENDIENTE (0 ejecutadas).
import { test } from 'node:test';
test.todo('PENDIENTE (requiere Prisma): ejecutar tests/integration/sql/run.py contra la base creada por la migración real y obtener 63/63');
test.todo('PENDIENTE (requiere Prisma): migrate diff entre la migración real y schema.prisma sin diferencias');
test.todo('PENDIENTE (requiere Prisma + PostgreSQL): concurrencia real de dos conexiones (prueba E) y repositorios Prisma contra tests/unit/sales-service');
