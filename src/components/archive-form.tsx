"use client";
import { useActionState } from "react";
import { archiveProductAction, restoreProductAction, type FormState } from "@/actions/products.actions";

export function ArchiveForm({ id, isActive }: { id: string; isActive: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(isActive ? archiveProductAction : restoreProductAction, undefined);
  return (
    <form action={action} className="danger-zone">
      <input type="hidden" name="id" value={id} />
      {isActive ? (
        <>
          <h3 style={{ margin: "0 0 4px" }}>Archivar producto</h3>
          <p className="muted small" style={{ marginTop: 0 }}>Deja de aparecer en la caja y en las búsquedas. No se borra: su historial se conserva y puedes reactivarlo.</p>
          <div className="inline"><input className="note" name="reason" placeholder="Motivo (obligatorio)" required /><button className="btn btn-small" type="submit" disabled={pending}>Archivar</button></div>
        </>
      ) : (
        <div className="inline"><span className="pill pill-warn">Archivado</span><button className="btn btn-small" type="submit" disabled={pending}>Reactivar producto</button></div>
      )}
      {state?.error && <p className="error" role="alert">{state.error}</p>}
    </form>
  );
}
