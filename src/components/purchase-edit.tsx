"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editPurchaseHeaderAction } from "@/actions/purchases.actions";

interface Sup { id: string; name: string; taxId: string | null; isActive?: boolean }
/** Corrige los datos del documento. Montos, IVA e inventario no cambian: para eso se anula y se vuelve a registrar. */
export function PurchaseEdit({ id, docType, initial, suppliers, today }: { id: string; docType: string; initial: { docDate: string; docNumber: string | null; supplierId: string | null; note: string | null }; suppliers: Sup[]; today: string }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState({ docDate: initial.docDate, docNumber: initial.docNumber ?? "", supplierId: initial.supplierId ?? "", note: initial.note ?? "" });
  if (!open) return <div className="actions" style={{ marginTop: 12 }}><button className="btn btn-small" type="button" onClick={() => setOpen(true)}>✎ Editar fecha / N° / proveedor</button></div>;
  return (
    <div className="formcard" style={{ maxWidth: 760, marginTop: 14 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>Editar datos del documento</h3>
      <div className="fields" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <div className="field"><label htmlFor="ed-date">Fecha del documento</label><input id="ed-date" type="date" value={v.docDate} max={today} onChange={(e) => setV({ ...v, docDate: e.target.value })} /></div>
        <div className="field"><label htmlFor="ed-num">N° documento{docType === "OTRO" ? " (opcional)" : ""}</label><input id="ed-num" value={v.docNumber} onChange={(e) => setV({ ...v, docNumber: e.target.value })} /></div>
        <div className="field"><label htmlFor="ed-sup">Proveedor</label>
          <select id="ed-sup" value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}><option value="">Sin proveedor</option>
            {suppliers.filter((s) => s.isActive !== false || s.id === initial.supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}{s.taxId ? ` (${s.taxId})` : ""}</option>)}</select></div>
        <div className="field"><label htmlFor="ed-note">Nota</label><input id="ed-note" value={v.note} maxLength={300} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      </div>
      <p className="hint">Los montos, el IVA y el inventario no cambian. Si el error está en productos, cantidades o costos, anula la compra y regístrala de nuevo.</p>
      <div className="actions">
        <button className="btn btn-primary btn-small" type="button" disabled={pending} onClick={() => start(async () => {
          setErr(null); const r = await editPurchaseHeaderAction(id, { docDate: v.docDate, docNumber: v.docNumber.trim() || null, supplierId: v.supplierId || null, note: v.note.trim() || null });
          if (r.ok) { setOpen(false); router.refresh(); } else setErr(r.error ?? "Error");
        })}>{pending ? "Guardando…" : "Guardar cambios"}</button>
        <button className="btn btn-small" type="button" onClick={() => { setOpen(false); setErr(null); }}>Cancelar</button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
