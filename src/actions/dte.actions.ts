"use server";
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";

export async function connectHaulmerAction(apiKey: string, env: string): Promise<{ ok: true; emisor: string } | { ok: false; error: string }> {
  try { const org = await services.dte.connect(await getActor(), { apiKey: String(apiKey ?? ""), env: String(env ?? "prod") }); revalidatePath("/boletas"); return { ok: true, emisor: `${org.razonSocial} (${org.rut})` }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function issueBoletaAction(saleId: string, allowCard: boolean): Promise<{ ok: true; folio: number } | { ok: false; error: string }> {
  try { const r = await services.dte.issueBoleta(await getActor(), String(saleId), { allowCard: allowCard === true }); revalidatePath(`/ventas/${saleId}`); return { ok: true, folio: r.folio }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function annulBoletaAction(saleId: string): Promise<{ ok: true; folio: number } | { ok: false; error: string }> {
  try { const r = await services.dte.annulBoleta(await getActor(), String(saleId), "Anula boleta (venta anulada)"); revalidatePath(`/ventas/${saleId}`); return { ok: true, folio: r.folio }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function markBoletaAnnulledAction(saleId: string, ncFolio: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try { const t = String(ncFolio ?? "").replace(/\D/g, ""); await services.dte.markAnnulledManually(await getActor(), String(saleId), t ? Number(t) : null); revalidatePath(`/ventas/${saleId}`); revalidatePath("/"); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
