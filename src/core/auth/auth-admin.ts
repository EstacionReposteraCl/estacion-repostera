// Adaptador del puerto `AuthAdmin` (src/repositories/ports.ts) sobre el plugin admin de better-auth 1.7.7.
// Las llamadas usan la sesión del ADMINISTRADOR (headers): Better Auth vuelve a verificar su permiso.
// Puntos a CONFIRMAR contra la documentación de la versión instalada antes de usar:
//  · firma y permisos de auth.api.createUser / banUser / unbanUser / setRole / revokeUserSessions del plugin admin;
//  · si requieren `headers` de una sesión de administrador (aquí se pasan) o hay API interna para scripts/seed;
//  · cómo se hashea la contraseña (lo hace Better Auth; nunca se hashea a mano aquí);
//  · que el valor de rol "VENDEDOR"/"ADMINISTRADOR" sea aceptado por la columna enum Role.
import { headers } from "next/headers";
import { auth } from "./auth";
import { prisma } from "../db/client";
import type { AuthAdmin } from "../../repositories/ports";
import { validation } from "../errors";

/** Errores de Better Auth -> mensaje claro (nunca detalles internos). */
async function ba<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    const m = String((e as { body?: { message?: string } }).body?.message ?? (e as Error).message ?? "");
    if (/already exists|exist/i.test(m)) throw validation("Ya existe un usuario con ese correo.");
    if (/password.*short|too short/i.test(m)) throw validation("La contraseña es demasiado corta.");
    if (/not allowed|forbidden|unauthorized/i.test(m)) throw validation("Tu sesión no tiene permiso para esta acción. Vuelve a iniciar sesión.");
    throw e;
  }
}

export const authAdmin: AuthAdmin = {
  async createUser({ name, email, role, tempPassword }) {
    const res = await ba(auth.api.createUser({ body: { name, email, password: tempPassword, role }, headers: await headers() }));
    await prisma.user.update({ where: { id: res.user.id }, data: { mustChangePassword: true } });
    return { id: res.user.id };
  },
  async setBanned(userId, banned, reason) {
    const h = await headers();
    if (banned) { await ba(auth.api.banUser({ body: { userId, banReason: reason }, headers: h })); await ba(auth.api.revokeUserSessions({ body: { userId }, headers: h })); }
    else await ba(auth.api.unbanUser({ body: { userId }, headers: h }));
  },
  async setRole(userId, role) { await ba(auth.api.setRole({ body: { userId, role }, headers: await headers() })); },
  async setPassword(userId, tempPassword) {
    const h = await headers();
    await ba(auth.api.setUserPassword({ body: { userId, newPassword: tempPassword }, headers: h }));
    await ba(auth.api.revokeUserSessions({ body: { userId }, headers: h }));
    await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
  },
};
