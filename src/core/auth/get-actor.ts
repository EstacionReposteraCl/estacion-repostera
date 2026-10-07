// ⚠ NO VERIFICADO. Convierte la sesión en `Actor` (src/core/permissions). El rol SIEMPRE sale de la BD/sesión del servidor,
// nunca de lo que envía el cliente. v1: una sola sucursal => branchId = sucursal con isMain (el schema v0.5 no asigna usuarios a sucursales).
import { headers } from "next/headers";
import { auth } from "./auth";
import { prisma } from "../db/client";
import type { Actor } from "../permissions/permissions";

export async function getActor(): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });           // re-lee rol y estado: no confiar en cookies
  if (!user || user.banned) return null;
  const branch = await prisma.branch.findFirstOrThrow({ where: { isMain: true, isActive: true } });
  return { userId: user.id, role: user.role, email: user.email, branchId: branch.id, banned: user.banned };
}
