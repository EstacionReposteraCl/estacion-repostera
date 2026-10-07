"use client";
import { useActionState } from "react";
import { saveSupplierAction, type SupplierState } from "@/actions/purchases.actions";
import type { SupplierRow } from "@/repositories/ports";

export function SupplierForm({ s: saved }: { s?: SupplierRow }) {
  const [st, action, pending] = useActionState<SupplierState, FormData>(saveSupplierAction, undefined);
  const k = st?.error ? st.values ?? {} : {};
  const s = saved ? ({ ...saved, ...k } as SupplierRow) : undefined;
  return (
    <form action={action} className={s ? "inline" : "formcard"} key={st?.at ?? 0}>
      {s && <input type="hidden" name="id" value={s.id} />}
      {s ? (<>
        <input name="name" defaultValue={s.name} aria-label="Nombre" style={{ width: 200 }} />
        <input name="taxId" defaultValue={s.taxId ?? ""} aria-label="RUT" placeholder="RUT" style={{ width: 130 }} />
        <input name="contactName" defaultValue={s.contactName ?? ""} aria-label="Contacto" placeholder="Contacto" style={{ width: 140 }} />
        <input name="phone" defaultValue={s.phone ?? ""} aria-label="Teléfono" placeholder="Teléfono" style={{ width: 120 }} />
        <input name="email" defaultValue={s.email ?? ""} aria-label="Correo" placeholder="Correo" style={{ width: 170 }} />
        <label className="inline small" style={{ margin: 0, fontWeight: 400 }}><input type="checkbox" name="isActive" defaultChecked={s.isActive} style={{ width: "auto" }} /> Activo</label>
        <button className="btn btn-small" disabled={pending}>Guardar</button>
        {st?.error && <span className="out small">{st.error}</span>}{st?.ok && <span className="small" style={{ color: "var(--accent)" }}>✓</span>}
      </>) : (<>
        <div className="fields">
          <div className="field"><label htmlFor="sn">Nombre</label><input id="sn" name="name" defaultValue={k.name ?? ""} required /></div>
          <div className="field"><label htmlFor="sr">RUT</label><input id="sr" name="taxId" defaultValue={k.taxId ?? ""} placeholder="76.123.456-7" /></div>
          <div className="field"><label htmlFor="sc">Contacto</label><input id="sc" name="contactName" defaultValue={k.contactName ?? ""} /></div>
          <div className="field"><label htmlFor="sp">Teléfono</label><input id="sp" name="phone" defaultValue={k.phone ?? ""} /></div>
          <div className="field"><label htmlFor="se">Correo</label><input id="se" name="email" defaultValue={k.email ?? ""} type="email" /></div>
          <div className="field"><label htmlFor="so">Notas</label><input id="so" name="notes" defaultValue={k.notes ?? ""} /></div>
        </div>
        <div className="actions"><button className="btn btn-primary" disabled={pending}>Agregar proveedor</button></div>
        {st?.error && <p className="error">{st.error}</p>}{st?.ok && <p className="ok" style={{ marginTop: 10 }}>{st.ok}</p>}
      </>)}
    </form>
  );
}
