"use server";
// Acciones DELGADAS de "Dinero disponible": autentican, llaman al servicio y traducen errores.
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";

type R = { ok: true } | { ok: false; error: string };
const run = async (f: () => Promise<unknown>): Promise<R> => {
  try { await f(); revalidatePath("/dinero"); return { ok: true }; } catch (e) { return { ok: false, error: toClientError(e).message }; }
};

export async function setMoneyStartAction(i: { balances: Record<string, number>; note: string }): Promise<R> {
  return run(async () => services.money.setStart(await getActor(), { balances: Object.fromEntries(Object.entries(i.balances ?? {}).map(([k, v]) => [k, Number(v)])), note: String(i.note ?? "") }));
}
export async function addMoneyMoveAction(i: { date: string; from: string; to: string; amount: number; note: string }): Promise<R> {
  return run(async () => services.money.addMove(await getActor(), { date: String(i.date), from: String(i.from), to: String(i.to), amount: Number(i.amount), note: String(i.note ?? "") }));
}
export async function voidMoneyMoveAction(id: string, reason: string): Promise<R> {
  return run(async () => services.money.voidMove(await getActor(), String(id), String(reason ?? "")));
}
export async function setPaidFromAction(kind: "PURCHASE" | "EXPENSE", id: string, paidFrom: string): Promise<R> {
  return run(async () => services.money.setSource(await getActor(), kind, String(id), String(paidFrom)));
}
