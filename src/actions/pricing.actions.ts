"use server";
import { getActor } from "../core/auth/get-actor";
import { can } from "../core/permissions";
import { services } from "../server/container";

/** Sugerencias del simulador de precios (solo administrador). */
export async function priceSearchAction(q: string): Promise<{ id: string; name: string; sku: string; salePrice: number }[]> {
  try {
    const actor = await getActor(); const text = String(q ?? "").trim();
    if (!actor || !can(actor.role, "report.financial") || text.length < 3) return [];
    return (await services.products.search(actor, text, 12)).map((r) => ({ id: r.id, name: r.name, sku: r.sku, salePrice: r.salePrice }));
  } catch { return []; }
}
