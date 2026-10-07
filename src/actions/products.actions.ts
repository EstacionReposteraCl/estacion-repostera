"use server";
// Acciones DELGADAS: autentican, leen el formulario, llaman al servicio y traducen errores. Sin reglas de negocio.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";

export type FormState = { error?: string; ok?: string; values?: Record<string, string>; at?: number } | undefined;
/** Devuelve lo escrito para no perderlo al mostrar el error. */
const keep = (f: FormData, error: string): FormState => ({ error, at: Date.now(), values: Object.fromEntries([...f.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)])) });
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveProductAction(_prev: FormState, f: FormData): Promise<FormState> {
  const actor = await getActor();
  const id = str(f, "id") || undefined;
  const price = str(f, "salePrice").replace(/[.$\s]/g, "");
  if (!/^\d+$/.test(price)) return keep(f, "El precio debe ser un número entero en pesos (sin decimales).");
  let saved: { id: string };
  try {
    let categoryId = str(f, "categoryId") || null;
    const newCategory = str(f, "newCategory");
    if (newCategory) categoryId = (await services.products.createCategory(actor, newCategory)).id;
    saved = await services.products.save(actor, {
      id, sku: str(f, "sku"), name: str(f, "name"), brand: str(f, "brand") || null, unitCode: str(f, "unitCode") || "UN",
      kind: str(f, "kind") === "SERVICE" ? "SERVICE" : "GOODS", salePrice: Number(price), vatTreatment: str(f, "vatTreatment") === "EXENTO" ? "EXENTO" : "AFECTO",
      categoryId, barcodes: str(f, "barcodes").split(/[\s,;]+/).filter(Boolean),
    });
  } catch (e) { return keep(f, toClientError(e).message); }
  revalidatePath("/productos");
  redirect(`/productos/${saved.id}?ok=${id ? "guardado" : "creado"}`);
}

export async function archiveProductAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = str(f, "id");
  try { await services.products.archive(await getActor(), id, str(f, "reason")); } catch (e) { return { error: toClientError(e).message }; }
  revalidatePath("/productos"); redirect(`/productos/${id}?ok=archivado`);
}

export async function restoreProductAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = str(f, "id");
  try { await services.products.restore(await getActor(), id); } catch (e) { return { error: toClientError(e).message }; }
  revalidatePath("/productos"); redirect(`/productos/${id}?ok=reactivado`);
}
