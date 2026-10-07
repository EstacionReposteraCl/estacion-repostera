"use server";
import { revalidatePath } from "next/cache";
import { getActor } from "../core/auth/get-actor";
import { toClientError } from "../core/errors";
import { services } from "../server/container";
import type { ExpenseInput } from "../services/expenses.service";

export type ExpResult = { ok: true; msg?: string } | { ok: false; error: string };
const done = (msg?: string): ExpResult => { revalidatePath("/gastos"); revalidatePath("/reportes"); return { ok: true, msg }; };
const fail = (e: unknown): ExpResult => ({ ok: false, error: toClientError(e).message });

export async function createExpenseAction(i: ExpenseInput): Promise<ExpResult> {
  try {
    await services.expenses.create(await getActor(), { categoryId: String(i.categoryId), description: String(i.description), expenseDate: String(i.expenseDate), totalAmount: Number(i.totalAmount),
      docType: i.docType ?? null, docNumber: i.docNumber ?? null, supplierId: i.supplierId || null });
    return done("Gasto registrado.");
  } catch (e) { return fail(e); }
}
export async function voidExpenseAction(id: string, reason: string): Promise<ExpResult> { try { await services.expenses.void(await getActor(), id, reason); return done("Gasto anulado."); } catch (e) { return fail(e); } }
export async function createExpenseCategoryAction(name: string): Promise<ExpResult> { try { const c = await services.expenses.createCategory(await getActor(), name); return done(`Categoría “${c.name}” lista.`); } catch (e) { return fail(e); } }
export async function updateExpenseCategoryAction(id: string, name: string, isActive: boolean): Promise<ExpResult> { try { await services.expenses.updateCategory(await getActor(), id, { name, isActive }); return done("Categoría guardada."); } catch (e) { return fail(e); } }
