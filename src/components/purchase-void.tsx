"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidPurchaseAction } from "@/actions/purchases.actions";

/** `mode` lo calcula el servidor con la vista previa: exact | adjusted (con varianza) | blocked (motivo). */
export function PurchaseVoid({ id, mode, variance, blockedText }: { id: string; mode: "exact" | "adjusted" | "blocked"; variance: number; blockedText?: string }) {
  const router = useRouter(); const [reason, setReason] = useState(""); const [err, setErr] = useState<string | null>(null); const [pending, start] = useTransition();
  if (mode === "blocked") return <div className="danger-zone"><h3 style={{ margin: "0 0 4px", fontSize: "0.95rem" }}>Anular compra</h3><p className="muted small" style={{ margin: 0 }}>{blockedText}</p></div>;
  return (
    <div className="danger-zone">
      <h3 style={{ margin: "0 0 4px", fontSize: "0.95rem" }}>Anular compra</h3>
      <p className="muted small" style={{ marginTop: 0 }}>{mode === "exact"
        ? "Se retira exactamente lo que entró con esta compra (stock y costo vuelven a como estaban). El documento queda libre para registrarlo corregido."
        : `Después de esta compra hubo otros movimientos. Se retira al costo promedio actual; la diferencia de valor (${variance >= 0 ? "" : "−"}$${Math.abs(variance).toLocaleString("es-CL")}) queda registrada como varianza.`}</p>
      <div className="inline">
        <input className="note" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obligatorio)" aria-label="Motivo de anulación" />
        <button className="btn btn-small" disabled={pending || !reason.trim()} onClick={() => { if (confirm("¿Anular esta compra?")) start(async () => { setErr(null); const r = await voidPurchaseAction(id, reason, mode === "adjusted"); if (!r.ok) setErr(r.error ?? "Error"); else router.refresh(); }); }}>Anular compra</button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
