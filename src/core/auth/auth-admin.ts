// ⚠ NO VERIFICADO (requiere better-auth instalado). Adaptador del puerto `AuthAdmin` (src/repositories/ports.ts).
// Puntos a CONFIRMAR contra la documentación de la versión instalada antes de usar:
//  · firma y permisos de auth.api.createUser / banUser / unbanUser / setRole / revokeUserSessions del plugin admin;
//  · si requieren `headers` de una sesión de administrador (aquí se pasan) o hay API interna para scripts/seed;
//  · cómo se hashea la contraseña (lo hace Better Auth; nunca se hashea a mano aquí);
//  · que el valor de rol "VENDEDOR"/"ADMINISTRADOR" sea aceptado por la columna enum Role.
import { headers } from "next/headers";
import { auth } from "./auth";
import { prisma } from "../db/client";
import type { AuthAdmin } from "../../repositories/ports";

export const authAdmin: AuthAdmin = {
  async createUser({ name, email, role, tempPassword }) {
    const res = await auth.api.createUser({ body: { name, email, password: tempPassword, role }, headers: await headers() });
    await prisma.user.update({ where: { id: res.user.id }, data: { mustChangePassword: true } });
    return { id: res.user.id };
  },
  async setBanned(userId, banned, reason) {
    const h = await headers();
    if (banned) { await auth.api.banUser({ body: { userId, banReason: reason }, headers: h }); await auth.api.revokeUserSessions({ body: { userId }, headers: h }); }
    else await auth.api.unbanUser({ body: { userId }, headers: h });
  },
  async setRole(userId, role) { await auth.api.setRole({ body: { userId, role }, headers: await headers() }); },
};
