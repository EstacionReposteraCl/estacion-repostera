"use server";
// Acciones DELGADAS de ventas: autentican (getActor), llaman al servicio y traducen errores. Ninguna regla de negocio aquí.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";
import type { SaleInput } from "../domain/sales/sale-plan";
import type { ChargeType } from "../domain/charges/charges";

const ip = async () => (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
export type ActionResult = { ok: true; id?: string } | { ok: false; error: string; code?: string };

/** El cliente envía SOLO producto, cantidad y pagos (nunca precios). La clave de idempotencia la genera la caja por intento. */
export async function closeSaleAction(input: SaleInput): Promise<ActionResult> {
  const clean: SaleInput = {
    lines: input.lines.map((l) => ({ productId: String(l.productId), presentationId: l.presentationId ?? null, quantity: String(l.quantity), ...(l.unitCode ? { unitCode: String(l.unitCode) } : {}) })),
    channelId: String(input.channelId), payments: input.payments.map((p) => ({ methodId: String(p.methodId), amount: Number(p.amount) })),
    idempotencyKey: String(input.idempotencyKey), externalRef: input.externalRef ?? null, note: input.note ?? null,
  };
  try { const s = await services.sales.closeSale(await getActor(), clean); revalidatePath("/ventas"); return { ok: true, id: s.id }; }
  catch (e) { const c = toClientError(e); return { ok: false, error: c.message, code: c.code }; }
}

export async function voidSaleAction(saleId: string, reason: string): Promise<ActionResult> {
  try { await services.sales.voidSale(await getActor(), saleId, reason, { ip: await ip() }); revalidatePath("/ventas"); revalidatePath(`/ventas/${saleId}`); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}

export async function addLateChargeAction(saleId: string, c: { type: ChargeType; amount: number; description?: string; reason: string }): Promise<ActionResult> {
  try { await services.sales.addLateCharge(await getActor(), saleId, { type: c.type, amount: Number(c.amount), description: c.description?.trim() || undefined, reason: c.reason }, { ip: await ip() }); revalidatePath(`/ventas/${saleId}`); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}

export async function voidChargeAction(saleId: string, chargeId: string, reason: string): Promise<ActionResult> {
  try { await services.sales.voidCharge(await getActor(), chargeId, saleId, reason, { ip: await ip() }); revalidatePath(`/ventas/${saleId}`); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}

/** Reimpresión: queda en AuditLog (sale.reprint). */
export async function reprintAction(saleId: string): Promise<ActionResult> {
  try { await services.sales.reprintSale(await getActor(), saleId, { ip: await ip() }); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}

/** Búsqueda para la caja: DTO público (sin costos), solo productos activos. */
export async function posSearchAction(q: string) {
  try { return { ok: true as const, rows: await services.products.search(await getActor(), q, 25) }; }
  catch (e) { return { ok: false as const, error: toClientError(e).message, rows: [] }; }
}
