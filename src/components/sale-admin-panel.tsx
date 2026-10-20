"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidSaleAction, addLateChargeAction, voidChargeAction } from "@/actions/sales.actions";

interface Fin { netTotal: number; costOfGoodsSold: number; grossProfit: number; totalCharges: number; realProfit: number }
interface Charge { id: string; type: string; amount: number; addedAfterClose: boolean; voided: boolean; reason: string | null }
const clp = (n: number) => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("es-CL");
const TYPES: Record<string, string> = { PAYMENT_FEE: "Comisión medio de pago", CHANNEL_COMMISSION: "Comisión del canal", CHANNEL_FIXED_FEE: "Cargo fijo del canal", SHIPPING_COST: "Envío asumido", OTHER: "Otro" };

export function SaleAdminPanel({ saleId, status, fin, charges, total = 0 }: { saleId: string; status: "COMPLETED" | "VOIDED"; fin: Fin; charges: Charge[]; total?: number }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const [type, setType] = useState("CHANNEL_COMMISSION"); const [amount, setAmount] = useState(""); const [pct, setPct] = useState(""); const [reason, setReason] = useState(""); const [voidReason, setVoidReason] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => start(async () => { setErr(null); const r = await fn(); if (!r.ok) setErr(r.error ?? "Error"); else { after?.(); router.refresh(); } });
  const margin = fin.netTotal ? Math.round((fin.realProfit / fin.netTotal) * 1000) / 10 : 0;
  return (
    <section className="formcard noprint" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Resultado de la venta <span className="muted small">(solo administrador)</span></h2>
      <table className="list fin"><tbody>
        <tr><td>Venta neta (sin IVA)</td><td className="num">{clp(fin.netTotal)}</td></tr>
        <tr><td>Costo de lo vendido</td><td className="num">{clp(-fin.costOfGoodsSold)}</td></tr>
        <tr><td><strong>Ganancia bruta</strong></td><td className="num"><strong>{clp(fin.grossProfit)}</strong></td></tr>
        <tr><td>Cargos (comisiones, envíos…)</td><td className="num">{clp(-fin.totalCharges)}</td></tr>
        <tr><td><strong>Ganancia real</strong></td><td className="num"><strong>{clp(fin.realProfit)}</strong> <span className="muted small">({margin.toLocaleString("es-CL")} %)</span></td></tr>
      </tbody></table>
      {charges.length > 0 && (<>
        <h3 style={{ fontSize: "0.95rem", margin: "16px 0 6px" }}>Cargos</h3>
        <ul className="charges">{charges.map((c) => (
          <li key={c.id} className={c.voided ? "voided" : ""}>
            <span>{TYPES[c.type] ?? c.type}{c.addedAfterClose && <span className="pill">posterior</span>}{c.voided && <span className="pill">anulado</span>}{c.reason && <span className="muted small"> · {c.reason}</span>}</span>
            <span className="num">{clp(c.amount)}{!c.voided && status === "COMPLETED" && <button className="link small" disabled={pending} onClick={() => { const r = prompt("Motivo para anular este cargo:"); if (r?.trim()) run(() => voidChargeAction(saleId, c.id, r)); }}> anular</button>}</span>
          </li>))}</ul>
      </>)}
      {status === "COMPLETED" && (<>
        <h3 style={{ fontSize: "0.95rem", margin: "16px 0 6px" }}>Agregar cargo posterior</h3>
        <p className="muted small" style={{ marginTop: 0 }}>Por ejemplo, la comisión que cobró Mercado Libre o un envío que asumió el negocio. Escribe un <b>%</b> (se calcula sobre el total de la venta) o directamente el <b>monto en pesos</b>. Recalcula la ganancia real y queda auditado.</p>
        <div className="inline">
          <select value={type} onChange={(e) => { setType(e.target.value); if (pct) { setPct(""); setAmount(""); if (/^Comisión \d/.test(reason)) setReason(""); } }} aria-label="Tipo de cargo">{Object.entries(TYPES).filter(([k]) => k !== "PAYMENT_FEE").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {total > 0 && type === "CHANNEL_COMMISSION" && <input className="money" style={{ width: 90 }} value={pct} inputMode="decimal" placeholder="%" aria-label="Porcentaje de la venta" title={`Porcentaje sobre el total de la venta (${total.toLocaleString("es-CL")} con IVA)`}
            onChange={(e) => { const raw = e.target.value; setPct(raw); const x = Number(raw.replace(",", ".").replace(/[%\s]/g, ""));
              if (raw.trim() && Number.isFinite(x) && x > 0 && x <= 100) { setAmount(Math.round((total * x) / 100).toLocaleString("es-CL")); if (!reason.trim() || /^Comisión \d/.test(reason)) setReason(`Comisión ${raw.trim().replace(/%$/, "")}%`); }
              else if (!raw.trim()) setAmount(""); }} />}
          <input className="money" value={amount} onChange={(e) => { setAmount(e.target.value); setPct(""); }} inputMode="numeric" placeholder="Monto $" aria-label="Monto del cargo" />
          <input className="note" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obligatorio)" aria-label="Motivo" />
          <button className="btn btn-small" disabled={pending} onClick={() => run(() => addLateChargeAction(saleId, { type: type as never, amount: Number(amount.replace(/[.$\s]/g, "")), reason }), () => { setAmount(""); setPct(""); setReason(""); })}>Agregar</button>
        </div>
        <div className="danger-zone">
          <h3 style={{ fontSize: "0.95rem", margin: "0 0 6px" }}>Anular venta</h3>
          <p className="muted small" style={{ marginTop: 0 }}>Devuelve los productos al stock con su costo original. La venta queda registrada como anulada (no se borra).</p>
          <div className="inline">
            <input className="note" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Motivo (obligatorio)" aria-label="Motivo de anulación" />
            <button className="btn btn-small" disabled={pending || !voidReason.trim()} onClick={() => { if (confirm("¿Anular esta venta? Esta acción no se puede deshacer. Si tiene boleta o factura electrónica emitida desde el sistema, también se anula con una nota de crédito.")) run(() => voidSaleAction(saleId, voidReason)); }}>Anular venta</button>
          </div>
        </div>
      </>)}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
