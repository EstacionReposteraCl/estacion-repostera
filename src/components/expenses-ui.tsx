"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExpenseAction, voidExpenseAction, createExpenseCategoryAction, updateExpenseCategoryAction } from "@/actions/expenses.actions";
import { planExpense, type ExpenseDocType } from "@/domain/expenses/expenses";

const clp = (n: number) => "$" + n.toLocaleString("es-CL");
const int = (s: string) => { const t = s.replace(/[.$\s]/g, ""); return /^\d+$/.test(t) ? Number(t) : NaN; };

export function ExpenseForm({ categories, suppliers, today }: { categories: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; today: string }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [f, setF] = useState({ categoryId: categories[0]?.id ?? "", description: "", expenseDate: today, total: "", docType: "", docNumber: "", supplierId: "" });
  const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  let preview: ReturnType<typeof planExpense> | null = null; try { if (Number.isFinite(int(f.total))) preview = planExpense({ docType: (f.docType || null) as ExpenseDocType | null, totalAmount: int(f.total) }); } catch { preview = null; }
  function submit() {
    setErr(null); setOk(null);
    start(async () => {
      const r = await createExpenseAction({ categoryId: f.categoryId, description: f.description, expenseDate: f.expenseDate, totalAmount: int(f.total), docType: (f.docType || null) as ExpenseDocType | null, docNumber: f.docNumber || null, supplierId: f.supplierId || null });
      if (r.ok) { setOk(r.msg ?? "Listo."); setF({ ...f, description: "", total: "", docNumber: "" }); router.refresh(); } else setErr(r.error);
    });
  }
  return (
    <div className="formcard" style={{ maxWidth: 1000 }}>
      <div className="fields" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <div className="field"><label htmlFor="ec">Categoría</label><select id="ec" value={f.categoryId} onChange={set("categoryId")}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="ed">Descripción</label><input id="ed" value={f.description} onChange={set("description")} placeholder="Ej.: Arriendo local octubre" maxLength={200} /></div>
        <div className="field"><label htmlFor="ef">Fecha</label><input id="ef" type="date" value={f.expenseDate} max={today} onChange={set("expenseDate")} /></div>
        <div className="field"><label htmlFor="et">Monto total pagado</label><input id="et" value={f.total} onChange={set("total")} inputMode="numeric" placeholder="$" /></div>
        <div className="field"><label htmlFor="edt">Documento</label><select id="edt" value={f.docType} onChange={set("docType")}><option value="">Sin documento</option><option value="BOLETA">Boleta</option><option value="FACTURA">Factura</option><option value="OTRO">Otro</option></select></div>
        {f.docType && <div className="field"><label htmlFor="edn">N° documento{f.docType === "FACTURA" ? "" : " (opcional)"}</label><input id="edn" value={f.docNumber} onChange={set("docNumber")} /></div>}
        <div className="field"><label htmlFor="es">Proveedor (opcional)</label><select id="es" value={f.supplierId} onChange={set("supplierId")}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      </div>
      {preview && <p className="hint">{preview.vatRecoverable ? `Factura: neto ${clp(preview.netAmount)} + IVA ${clp(preview.vatAmount)} (crédito fiscal). Al resultado va el neto: ${clp(preview.resultCost)}.` : `Sin IVA recuperable: al resultado va el total, ${clp(preview.resultCost)}.`}</p>}
      <div className="actions"><button className="btn btn-primary" onClick={submit} disabled={pending || !f.categoryId || f.description.trim().length < 2 || !preview}>{pending ? "Guardando…" : `Registrar gasto${preview ? " " + clp(preview.totalAmount) : ""}`}</button></div>
      {err && <p className="error" role="alert">{err}</p>}{ok && <p className="ok" role="status" style={{ marginTop: 10 }}>{ok}</p>}
    </div>
  );
}

export function VoidExpense({ id, label }: { id: string; label: string }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  return (<>
    <button className="link small" disabled={pending} onClick={() => { const r = prompt(`Motivo para anular “${label}”:`); if (r?.trim()) start(async () => { const x = await voidExpenseAction(id, r); if (!x.ok) setErr(x.error); else router.refresh(); }); }}>Anular</button>
    {err && <div className="out small">{err}</div>}
  </>);
}

export function ExpenseCategories({ items }: { items: { id: string; name: string; isActive: boolean }[] }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [msg, setMsg] = useState<string | null>(null); const [name, setName] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string; msg?: string }>) => start(async () => { const r = await fn(); setMsg(r.ok ? r.msg ?? "Listo." : r.error ?? "Error"); if (r.ok) router.refresh(); });
  return (
    <div className="tile">
      <ul className="entries">{items.map((c) => <CatRow key={c.id + c.name + c.isActive} c={c} run={run} pending={pending} />)}</ul>
      <div className="inline" style={{ marginTop: 10 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nueva categoría (ej.: Transporte)" aria-label="Nueva categoría" style={{ width: 240 }} />
        <button className="btn btn-small" disabled={pending || name.trim().length < 2} onClick={() => run(async () => { const r = await createExpenseCategoryAction(name); if (r.ok) setName(""); return r; })}>Agregar</button>
      </div>
      {msg && <p className="small" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}
function CatRow({ c, run, pending }: { c: { id: string; name: string; isActive: boolean }; run: (fn: () => Promise<{ ok: boolean; error?: string; msg?: string }>) => void; pending: boolean }) {
  const [name, setName] = useState(c.name); const [active, setActive] = useState(c.isActive);
  return (
    <li><div className="inline">
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label={`Nombre de ${c.name}`} style={{ width: 200 }} />
      <label className="inline small" style={{ margin: 0, fontWeight: 400 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: "auto" }} /> Activa</label>
      <button className="btn btn-small" disabled={pending || (name === c.name && active === c.isActive)} onClick={() => run(() => updateExpenseCategoryAction(c.id, name, active))}>Guardar</button>
    </div></li>
  );
}
