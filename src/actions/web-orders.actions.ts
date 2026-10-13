"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown) => ({ ok: false as const, error: toClientError(e).message });

export async function enableWebSalesAction(since: string): Promise<R<{ hookOk: boolean; hookError: string | null }>> {
  try {
    const h = await headers(); const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
    const r = await services.webOrders.enable(await getActor(), { since: String(since ?? ""), baseUrl: `https://${host}` });
    await services.webOrders.sync(true).catch(() => null);
    revalidatePath("/ventas-web"); return { ok: true, hookOk: r.hookOk, hookError: r.hookError };
  } catch (e) { return fail(e); }
}
export async function disableWebSalesAction(): Promise<R> {
  try { await services.webOrders.disable(await getActor()); revalidatePath("/ventas-web"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function syncWebSalesAction(): Promise<R<{ done: number; pending: number }>> {
  try {
    const a = await getActor(); await services.webOrders.status(a);                 // permiso
    const r = await services.webOrders.sync(true); revalidatePath("/ventas-web"); revalidatePath("/");
    return { ok: true, done: r?.done ?? 0, pending: r?.pending ?? 0 };
  } catch (e) { return fail(e); }
}
export async function resolveWebOrderAction(orderId: number, productIds: (string | null)[], payment: string | null, allowDuplicate: boolean): Promise<R<{ state: string; folio: number | null; reason: string | null }>> {
  try {
    const e = await services.webOrders.resolve(await getActor(), Number(orderId), { productIds: (productIds ?? []).map((x) => (x ? String(x) : null)), payment: payment ? String(payment) : null, allowDuplicate: allowDuplicate === true });
    revalidatePath("/ventas-web"); revalidatePath("/"); return { ok: true, state: e.state, folio: e.folio ?? null, reason: e.reason };
  } catch (e) { return fail(e); }
}
export async function ignoreWebOrderAction(orderId: number, reason: string): Promise<R> {
  try { await services.webOrders.ignore(await getActor(), Number(orderId), String(reason ?? "")); revalidatePath("/ventas-web"); revalidatePath("/"); return { ok: true }; } catch (e) { return fail(e); }
}
