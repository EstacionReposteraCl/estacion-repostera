"use server";
// Acciones delgadas de cotizaciones: autentican, llaman al servicio y traducen errores.
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";
import type { QuoteInput } from "../services/quotes.service";
import type { QuoteProvider } from "../domain/quotes/quote";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function createQuoteAction(i: QuoteInput): Promise<R<{ id: string }>> {
  try { const r = await services.quotes.create(await getActor(), i); revalidatePath("/cotizaciones"); return { ok: true, id: r.id }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function setQuoteStatusAction(id: string, status: "PENDING" | "ACCEPTED" | "VOID", note?: string): Promise<R> {
  try { await services.quotes.setStatus(await getActor(), String(id), status, note ?? null); revalidatePath("/cotizaciones"); revalidatePath(`/cotizaciones/${id}`); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function setQuoteValidityAction(id: string, days: number): Promise<R> {
  try { await services.quotes.setValidity(await getActor(), String(id), Number(days)); revalidatePath("/cotizaciones"); revalidatePath(`/cotizaciones/${id}`); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function quoteShareAction(id: string): Promise<R<{ ref: string | null }>> {
  try { return { ok: true, ref: await services.quotes.shareRef(await getActor(), String(id)) }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function linkQuoteSaleAction(id: string, saleId: string): Promise<R> {
  try { await services.quotes.linkSale(await getActor(), String(id), String(saleId)); revalidatePath("/cotizaciones"); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
export async function saveQuoteSettingsAction(p: QuoteProvider): Promise<R> {
  try { await services.quotes.saveSettings(await getActor(), p); revalidatePath("/cotizaciones"); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
