"use server";
import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";

/** Contraseña temporal legible y fuerte (≈ 71 bits): Repo-XXXX-XXXX-XXXX sin caracteres ambiguos. */
function tempPassword() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const g = () => Array.from({ length: 4 }, () => a[randomInt(a.length)]).join("");
  return `Repo-${g()}-${g()}-${g()}`;
}
export type UserResult = { ok: true; temp?: string; msg?: string } | { ok: false; error: string };
const fail = (e: unknown): UserResult => ({ ok: false, error: toClientError(e).message });

export async function createUserAction(i: { name: string; email: string; role: "ADMINISTRADOR" | "VENDEDOR" }): Promise<UserResult> {
  const temp = tempPassword();
  try { await services.users.create(await getActor(), { name: i.name, email: i.email, role: i.role === "ADMINISTRADOR" ? "ADMINISTRADOR" : "VENDEDOR", tempPassword: temp }); revalidatePath("/usuarios"); return { ok: true, temp }; }
  catch (e) { return fail(e); }
}
export async function resetPasswordAction(userId: string): Promise<UserResult> {
  const temp = tempPassword();
  try { await services.users.resetPassword(await getActor(), userId, temp); revalidatePath("/usuarios"); return { ok: true, temp }; }
  catch (e) { return fail(e); }
}
export async function setRoleAction(userId: string, role: "ADMINISTRADOR" | "VENDEDOR"): Promise<UserResult> {
  try { await services.users.setRole(await getActor(), userId, role); revalidatePath("/usuarios"); return { ok: true, msg: "Rol actualizado." }; } catch (e) { return fail(e); }
}
export async function deactivateAction(userId: string, reason: string): Promise<UserResult> {
  try { await services.users.deactivate(await getActor(), userId, reason); revalidatePath("/usuarios"); return { ok: true, msg: "Usuario desactivado. Sus sesiones se cerraron." }; } catch (e) { return fail(e); }
}
export async function reactivateAction(userId: string): Promise<UserResult> {
  try { await services.users.reactivate(await getActor(), userId); revalidatePath("/usuarios"); return { ok: true, msg: "Usuario reactivado." }; } catch (e) { return fail(e); }
}
