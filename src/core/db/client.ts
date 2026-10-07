// ⚠ NO VERIFICADO (requiere paquetes que no se pudieron instalar): cliente Prisma 7 con adaptador de controlador.
// Runtime = rol `app_user` (sin UPDATE/DELETE en tablas de solo agregar), URL con pooler. Migraciones = propietario (DIRECT_URL).
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg"; // con Neon: evaluar @prisma/adapter-neon

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
