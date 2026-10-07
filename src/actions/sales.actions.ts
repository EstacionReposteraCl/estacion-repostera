"use server";
// ⚠ NO VERIFICADO (requiere Next.js). `services` viene de src/server/container.ts, que aún lanza error (repositorios Prisma PENDIENTES). Server action DELGADA: autentica, valida forma, llama al servicio, traduce errores.
// Ninguna regla de negocio aquí. Es la plantilla de todas las acciones.
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container"; // PENDIENTE: lanza hasta que existan los repositorios Prisma
import type { SaleInput } from "../domain/sales/sale-plan";

export async function closeSaleAction(input: SaleInput) {
  try { return { ok: true as const, data: await services.sales.closeSale(await getActor(), input) }; }
  catch (e) { return { ok: false as const, error: toClientError(e) }; }
}
