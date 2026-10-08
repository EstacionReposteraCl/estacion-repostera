"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeCashAction } from "@/actions/cash.actions";
import { parseMoneyCents } from "@/core/money/parse-money";

const clp = (n: number) => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("es-CL");
/** Pesos enteros ("20.000" -> 20000); vacío -> 0; inválido o con centavos -> null. */
const pesos = (s: string) => { if (!s.trim()) return 0; const c = parseMoneyCents(s); return c === null || c % 100 !== 0 ? null : c / 100; };

/** review = administrador: ve el esperado y la diferencia mientras escribe. Vendedor: conteo a ciegas. */
export function CashCloseForm({ review, suggestedFloat, cashSales }: { review: boolean; suggestedFloat: number; cashSales: number | null }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState({ float: suggestedFloat ? suggestedFloat.toLocaleString("es-CL") : "", withdrawals: "", counted: "", note: "" });
  const f = pesos(v.float), w = pesos(v.withdrawals), c = v.counted.trim() ? pesos(v.counted) : null;
  const ok = f !== null && w !== null && c !== null;
  const expected = review && cashSales !== null && f !== null && w !== null ? f + cashSales - w : null;
  const diff = expected !== null && c !== null ? c - expected : null;
  function submit() {
    if (!ok) return;
    if (!confirm(review ? "¿Registrar el cierre de caja?" : "¿Registrar el cierre? Revisa que el conteo esté correcto: no se puede modificar después.")) return;
    setErr(null);
    start(async () => {
      const r = await closeCashAction({ float: f!, counted: c!, withdrawals: w!, note: v.note });
      if (r.ok) router.push(`/caja/cierre?ver=${encodeURIComponent(r.id)}&fecha=${r.date}`); else setErr(r.error);
    });
  }
  const bad = (x: number | null, s: string) => (s.trim() && x === null ? <span className="out small">monto inválido</span> : null);
  return (
    <div className="formcard" style={{ maxWidth: 640 }}>
      <h2 className="sect" style={{ marginTop: 0 }}>Contar la caja</h2>
      <div className="fields" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div className="field"><label htmlFor="cc-float">Fondo inicial (sencillo con que partió la caja)</label><input id="cc-float" inputMode="numeric" value={v.float} onChange={(e) => setV({ ...v, float: e.target.value })} placeholder="$ 0" />{bad(f, v.float)}</div>
        <div className="field"><label htmlFor="cc-w">Retiros o pagos hechos con efectivo de la caja</label><input id="cc-w" inputMode="numeric" value={v.withdrawals} onChange={(e) => setV({ ...v, withdrawals: e.target.value })} placeholder="$ 0" />{bad(w, v.withdrawals)}</div>
        <div className="field"><label htmlFor="cc-c"><b>Efectivo contado</b> (todo lo que hay en la caja ahora)</label><input id="cc-c" inputMode="numeric" value={v.counted} onChange={(e) => setV({ ...v, counted: e.target.value })} placeholder="$" className="money-big" />{bad(c, v.counted)}</div>
        <div className="field"><label htmlFor="cc-n">Nota (opcional)</label><input id="cc-n" value={v.note} maxLength={300} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Ej.: retiré $10.000 para el banco" /></div>
      </div>
      {review && expected !== null && (
        <div className="cash-calc">
          <div><span>Fondo inicial</span><b>{clp(f!)}</b></div>
          <div><span>+ Ventas en efectivo</span><b>{clp(cashSales!)}</b></div>
          <div><span>− Retiros / pagos</span><b>{clp(w!)}</b></div>
          <div className="cash-exp"><span>= Efectivo esperado</span><b>{clp(expected)}</b></div>
          {diff !== null && <div className={`cash-diff ${diff === 0 ? "is-ok" : diff > 0 ? "is-over" : "is-short"}`}><span>{diff === 0 ? "Cuadra exacto" : diff > 0 ? "Sobrante" : "Faltante"}</span><b>{clp(diff)}</b></div>}
        </div>
      )}
      {!review && <p className="hint">Cuenta los billetes y monedas y escribe el total. El sistema compara con las ventas y el administrador revisa el resultado.</p>}
      <div className="actions"><button className="btn btn-primary" type="button" disabled={pending || !ok} onClick={submit}>{pending ? "Registrando…" : "Cerrar caja"}</button></div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
