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
  try { const r = await services.dte.annulBoleta(await getActor(), String(saleId), "Venta anulada"); revalidatePath(`/ventas/${saleId}`); return { ok: true, folio: r.folio }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function markBoletaAnnulledAction(saleId: string, ncFolio: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try { const t = String(ncFolio ?? "").replace(/\D/g, ""); await services.dte.markAnnulledManually(await getActor(), String(saleId), t ? Number(t) : null); revalidatePath(`/ventas/${saleId}`); revalidatePath("/"); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function lookupCustomerAction(rut: string): Promise<{ ok: true; found: boolean; source?: string; receptor?: { rut: string; razonSocial: string; giro: string; direccion: string; comuna: string; email?: string | null } } | { ok: false; error: string }> {
  try { const r = await services.dte.customer(await getActor(), String(rut ?? "")); return r ? { ok: true, found: true, source: r.source, receptor: r.receptor } : { ok: true, found: false }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function issueFacturaAction(saleId: string, receptor: { rut: string; razonSocial: string; giro: string; direccion: string; comuna: string; email?: string }, fmaPago: number, allowCard: boolean): Promise<{ ok: true; folio: number } | { ok: false; error: string }> {
  try { const r = await services.dte.issueFactura(await getActor(), String(saleId), { receptor, fmaPago: Number(fmaPago), allowCard: allowCard === true }); revalidatePath(`/ventas/${saleId}`); return { ok: true, folio: r.folio }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
