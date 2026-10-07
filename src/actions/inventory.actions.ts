"use server";
// Guardado por lotes de la pantalla de inventario. Cada fila llama al servicio por separado (su propia transacción):
// una fila con error no impide guardar las demás, y se informa cuál falló.
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";
import { parseQuantity } from "../core/money/quantity";
import { divRoundHalfUp } from "../core/money/rounding";

export type StockState = { saved?: number; errors?: string[]; at?: number; keep?: Record<string, string> } | undefined;

export async function saveStockAction(_prev: StockState, f: FormData): Promise<StockState> {
  const actor = await getActor();
  const ids = f.getAll("id").map(String); const note = String(f.get("note") ?? "").trim();
  let saved = 0; const errors: string[] = []; const keep: Record<string, string> = {};
  for (const id of ids) {
    const name = String(f.get(`name_${id}`) ?? id);
    const raw = String(f.get(`qty_${id}`) ?? "").trim(); const before = String(f.get(`was_${id}`) ?? "").trim();
    if (raw === "" || raw === before) continue;                              // sin cambios
    const mode = String(f.get(`mode_${id}`)); const costRaw = String(f.get(`cost_${id}`) ?? "").replace(/[.$\s]/g, "");
    try {
      let q: bigint; try { q = parseQuantity(raw); } catch { throw new Error("cantidad inválida (usa números, máx. 3 decimales)"); }
      const unitCost = costRaw === "" ? undefined : Number(costRaw);
      if (unitCost !== undefined && (!Number.isSafeInteger(unitCost) || unitCost <= 0)) throw new Error("costo unitario inválido");
      if (mode === "opening") {
        if (q === 0n) continue;
        if (unitCost === undefined) throw new Error("falta el costo unitario");
        const totalValue = Number(divRoundHalfUp(q * BigInt(unitCost), 1000n));
        await services.inventory.openingBalance(actor, { productId: id, qty: raw, totalValue, note: note || undefined });
      } else {
        await services.inventory.countAdjust(actor, { productId: id, countedQty: raw, note: note || "", unitCost: before === "0" || before === "0.000" ? unitCost : undefined });
      }
      saved++;
    } catch (e) { keep[`qty_${id}`] = raw; if (costRaw) keep[`cost_${id}`] = costRaw; errors.push(`${name}: ${e instanceof Error && !("code" in e) ? e.message : toClientError(e).message}`); }
  }
  revalidatePath("/inventario"); revalidatePath("/productos");
  if (errors.length && note) keep.note = note;
  return { saved, errors, at: Date.now(), keep };
}
