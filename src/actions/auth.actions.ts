"use server";
// Acciones de sesión. El rol y el estado se releen de la BD en getActor(); nada se confía al cliente.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../core/auth/auth";
import { prisma } from "../core/db/client";

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}

export type ChangePasswordState = { error?: string } | undefined;

export async function changePasswordAction(_prev: ChangePasswordState, form: FormData): Promise<ChangePasswordState> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect("/login");
  const currentPassword = String(form.get("currentPassword") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (newPassword.length < 10) return { error: "La nueva contraseña debe tener al menos 10 caracteres." };
  if (newPassword !== confirm) return { error: "La confirmación no coincide." };
  if (newPassword === currentPassword) return { error: "La nueva contraseña debe ser distinta de la actual." };
  try {
    await auth.api.changePassword({ body: { currentPassword, newPassword, revokeOtherSessions: true }, headers: h });
  } catch {
    return { error: "La contraseña actual no es correcta." };
  }
  await prisma.user.update({ where: { id: session.user.id }, data: { mustChangePassword: false } });
  redirect("/");
}
