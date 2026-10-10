"use server";
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";
import type { RegisterPurchaseInput } from "../services/purchases.service";

export type Result = { ok: true; id: string } | { ok: false; error: string };

/** Si viene `newSupplier`, se crea primero (queda aunque la compra falle: es un dato válido por sí mismo). */
export async function registerPurchaseAction(input: RegisterPurchaseInput & { newSupplier?: { name: string; taxId?: string } | null }): Promise<Result> {
  try {
    const actor = await getActor();
    let supplierId = input.supplierId ?? null;
    if (input.newSupplier?.name?.trim()) supplierId = (await services.purchases.saveSupplier(actor, { name: input.newSupplier.name, taxId: input.newSupplier.taxId ?? null })).id;
    const r = await services.purchases.register(actor, {
      supplierId, docType: input.docType, docNumber: input.docNumber ?? null, docDate: String(input.docDate), pricesIncludeVat: Boolean(input.pricesIncludeVat), note: input.note?.trim() || undefined, paidFrom: input.paidFrom ? String(input.paidFrom) : null,
      lines: input.lines.map((l) => ({ productId: String(l.productId), quantity: String(l.quantity), ...(l.unitCost !== undefined ? { unitCost: Number(l.unitCost) } : { lineAmount: Number(l.lineAmount) }), ...(l.discount ? { discount: String(l.discount) } : {}) })),
    });
    revalidatePath("/compras"); revalidatePath("/productos"); revalidatePath("/inventario");
    return { ok: true, id: r.id };
  } catch (e) { return { ok: false, error: toClientError(e).message }; }
}

export async function voidPurchaseAction(id: string, reason: string, adjusted: boolean): Promise<{ ok: boolean; error?: string }> {
  try { await services.purchases.void(await getActor(), id, { reason, adjusted }); revalidatePath("/compras"); revalidatePath(`/compras/${id}`); revalidatePath("/inventario"); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}

/** Corrige fecha, N°, proveedor o nota de una compra (sin tocar montos ni inventario). */
export async function editPurchaseHeaderAction(id: string, d: { docDate: string; docNumber: string | null; supplierId: string | null; note: string | null }): Promise<{ ok: boolean; error?: string }> {
  try {
    await services.purchases.editHeader(await getActor(), String(id), { docDate: String(d.docDate), docNumber: d.docNumber ? String(d.docNumber) : null, supplierId: d.supplierId ? String(d.supplierId) : null, note: d.note ? String(d.note) : null });
    revalidatePath("/compras"); revalidatePath(`/compras/${id}`); return { ok: true };
  } catch (e) { return { ok: false, error: toClientError(e).message }; }
}

export type SupplierState = { ok?: string; error?: string; at?: number; values?: Record<string, string> } | undefined;
export async function saveSupplierAction(_p: SupplierState, f: FormData): Promise<SupplierState> {
  const s = (k: string) => String(f.get(k) ?? "").trim();
  try {
    await services.purchases.saveSupplier(await getActor(), { id: s("id") || undefined, name: s("name"), taxId: s("taxId"), contactName: s("contactName"), phone: s("phone"), email: s("email"), notes: s("notes"), isActive: s("id") ? f.get("isActive") === "on" : true });
    revalidatePath("/compras/proveedores"); return { ok: `Proveedor “${s("name")}” guardado.`, at: Date.now() };
  } catch (e) { return { error: toClientError(e).message, at: Date.now(), values: Object.fromEntries([...f.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)])) }; }
}

/** Búsqueda de productos con stock (GOODS) para la compra. Incluye archivados no: solo activos. */
export async function purchaseSearchAction(q: string) {
  try { return (await services.products.search(await getActor(), q, 25)).filter((r) => r.stock !== null); } catch { return []; }
}
