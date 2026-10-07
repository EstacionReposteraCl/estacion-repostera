// Verificado con Prisma 7.10.0 (validate, generate, migrate dev/deploy/diff).
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Conexión DIRECTA (propietario) solo para migrar: crea tablas, triggers, roles y GRANT/REVOKE.
  // Opcional para `prisma generate`: en el hosting (Vercel) NO se entrega DIRECT_URL; ahí solo existe DATABASE_URL (app_user).
  ...(process.env.DIRECT_URL ? { datasource: { url: process.env.DIRECT_URL } } : {}),
});
