"use server";
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";

export type SettingsState = { ok?: string; error?: string; at?: number; values?: Record<string, string> } | undefined;
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const done = (ok: string): SettingsState => { revalidatePath("/configuracion"); return { ok, at: Date.now() }; };
const fail = (e: unknown, f?: FormData): SettingsState => ({ error: toClientError(e).message, at: Date.now(), values: f ? Object.fromEntries([...f.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)])) : undefined });

export async function saveBusinessAction(_p: SettingsState, f: FormData): Promise<SettingsState> {
  try { await services.settings.updateBusiness(await getActor(), { legalName: s(f, "legalName"), taxId: s(f, "taxId"), address: s(f, "address"), phone: s(f, "phone"), email: s(f, "email"), receiptFooter: s(f, "receiptFooter") }); return done("Datos del negocio guardados. Se usarán en los comprobantes nuevos."); }
  catch (e) { return fail(e, f); }
}
export async function saveFeeRuleAction(_p: SettingsState, f: FormData): Promise<SettingsState> {
  const fixed = s(f, "fixedAmount").replace(/[.$\s]/g, "") || "0";
  try {
    if (!/^\d+$/.test(fixed)) throw Object.assign(new Error(), { code: "x" });
    await services.settings.saveFeeRule(await getActor(), { target: s(f, "target") === "CHANNEL" ? "CHANNEL" : "PAYMENT_METHOD", targetId: s(f, "targetId"), percent: s(f, "percent") || "0",
      fixedAmount: Number(fixed), isManualPerSale: s(f, "mode") === "manual", isActive: s(f, "mode") !== "off" });
    return done(`Comisión de ${s(f, "targetName")} guardada. Aplica a las ventas nuevas.`);
  } catch (e) { return (e as { code?: string }).code === "x" ? { ...fail(new Error(), f), error: "El cargo fijo debe ser un número entero en pesos." } : fail(e, f); }
}
export async function saveEntryAction(_p: SettingsState, f: FormData): Promise<SettingsState> {
  try { await services.settings.updateEntry(await getActor(), s(f, "kind") === "channel" ? "channel" : "paymentMethod", s(f, "id"), { name: s(f, "name"), isActive: f.get("isActive") === "on" }); return done(`“${s(f, "name")}” guardado.`); }
  catch (e) { return fail(e, f); }
}
export async function createEntryAction(_p: SettingsState, f: FormData): Promise<SettingsState> {
  try { const r = await services.settings.createEntry(await getActor(), s(f, "kind") === "channel" ? "channel" : "paymentMethod", s(f, "name")); return done(`“${r.name}” agregado. Ya aparece en la caja.`); }
  catch (e) { return fail(e, f); }
}
