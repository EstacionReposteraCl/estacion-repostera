"use server";
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";

export async function connectJumpsellerAction(login: string, token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try { await services.shipping.connect(await getActor(), { login: String(login ?? ""), token: String(token ?? "") }); revalidatePath("/despacho"); return { ok: true }; }
  catch (e) { return { ok: false, error: toClientError(e).message }; }
}
