"use server";
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";

export async function connectTuuAction(i: { apiKey: string; device: string; enabled: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  try { await services.tuu.connect(await getActor(), { apiKey: String(i.apiKey ?? ""), device: String(i.device ?? ""), enabled: i.enabled === true }); revalidatePath("/boletas"); revalidatePath("/ventas/nueva"); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function tuuStartAction(amount: number, method: "DEBIT" | "CREDIT" | null, key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try { await services.tuu.start(await getActor(), { amount: Number(amount), method: method === "CREDIT" || method === "DEBIT" ? method : null, key: String(key) }); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function tuuCheckAction(key: string): Promise<{ ok: true; status: string; detail: string | null } | { ok: false; error: string }> {
  try { const r = await services.tuu.check(await getActor(), String(key)); return { ok: true, status: r.status, detail: r.detail }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
