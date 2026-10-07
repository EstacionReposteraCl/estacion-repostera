import "server-only";
// Capa de acceso para páginas: sesión válida + usuario activo, releído de la BD en cada petición.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { prisma } from "@/core/db/client";
import { getActor } from "@/core/auth/get-actor";

export async function requireActor(opts: { allowPendingPasswordChange?: boolean } = {}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true, mustChangePassword: true, lastLoginAt: true } });
  if (user.mustChangePassword && !opts.allowPendingPasswordChange) redirect("/cambiar-clave");
  return { actor, name: user.name, mustChangePassword: user.mustChangePassword, lastLoginAt: user.lastLoginAt };
}

export async function hasSession() {
  return Boolean(await auth.api.getSession({ headers: await headers() }));
}
