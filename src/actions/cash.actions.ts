"use server";
// Acción DELGADA: autentica, llama al servicio y traduce errores. El servicio decide qué ve cada rol.
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";

export async function closeCashAction(i: { float: number; counted: number; withdrawals: number; note: string }): Promise<{ ok: true; id: string; date: string } | { ok: false; error: string }> {
  try {
    const r = await services.cash.close(await getActor(), { float: Number(i.float), counted: Number(i.counted), withdrawals: Number(i.withdrawals), note: String(i.note ?? "") });
    revalidatePath("/caja/cierre"); return { ok: true, id: r.id, date: r.date };
  } catch (e) { return { ok: false, error: toClientError(e).message }; }
}

export async function openCashAction(i: { float: number; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try { await services.cash.open(await getActor(), { float: Number(i.float), note: String(i.note ?? "") }); revalidatePath("/caja/cierre"); revalidatePath("/ventas/nueva"); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
