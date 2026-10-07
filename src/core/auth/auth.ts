// Verificado con better-auth 1.7.7: login, sin registro público, desactivación (banned), límite de intentos, roles enum.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "../db/client";

// Roles del plugin admin = valores del enum Role. Sin "impersonate" (impersonación deshabilitada).
const ac = createAccessControl(defaultStatements);
const ADMINISTRADOR = ac.newRole({
  user: ["create", "list", "set-role", "ban", "delete", "set-password", "get", "update"],
  session: ["list", "revoke", "delete"],
});
const VENDEDOR = ac.newRole({ user: [], session: [] });

// URL pública: BETTER_AUTH_URL si existe; en Vercel, el dominio de producción que Vercel entrega solo.
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined;
const baseURL = process.env.BETTER_AUTH_URL || vercelUrl;

export const auth = betterAuth({
  baseURL,
  trustedOrigins: baseURL ? [baseURL] : [],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,        // NO hay registro público: el administrador crea los usuarios
    minPasswordLength: 10,
  },
  user: {
    additionalFields: {
      mustChangePassword: { type: "boolean", defaultValue: true, input: false },
      lastLoginAt: { type: "date", required: false, input: false },
    },
  },
  session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 }, // sesiones en BD; revocables al desactivar al usuario
  rateLimit: { enabled: true, storage: "database", customRules: { "/sign-in/email": { window: 60, max: 5 } } },
  databaseHooks: {
    // CONFIRMAR el nombre y la forma de los hooks en la versión instalada. Registra el último ingreso.
    session: { create: { after: async (session) => { await prisma.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } }); } } },
  },
  plugins: [
    // Los valores deben coincidir con el enum Role del schema. VERIFICAR contra la versión instalada.
    admin({ ac, roles: { ADMINISTRADOR, VENDEDOR }, defaultRole: "VENDEDOR", adminRoles: ["ADMINISTRADOR"] }),
    nextCookies(),
  ],
});
