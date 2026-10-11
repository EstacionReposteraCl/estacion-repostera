"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeCashAction, openCashAction } from "@/actions/cash.actions";
import { parseMoneyCents } from "@/core/money/parse-money";

const clp = (n: number) => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("es-CL");
/** Pesos enteros ("20.000" -> 20000); vacío -> 0; inválido o con centavos -> null. */
const pesos = (s: string) => { if (!s.trim()) return 0; const c = parseMoneyCents(s); return c === null || c % 100 !== 0 ? null : c / 100; };

type Method = { code: string; name: string; count?: number; amount?: number };
const Diff = ({ d }: { d: number }) => <span className={`pill ${d === 0 ? "pill-ok" : "pill-warn"}`}>{d === 0 ? "Cuadra" : d > 0 ? `Sobra ${clp(d)}` : `Falta ${clp(-d)}`}</span>;

/**
 * Arqueo de caja (como el "cierre Z" de un POS): efectivo contado vs. lo que debería haber, y los demás medios
 * (débito, crédito, transferencia, Mercado Pago, Rappi) declarados vs. lo registrado en el sistema.
 * review = administrador: ve lo del sistema y las diferencias. Vendedor: arqueo a ciegas (solo escribe lo que cuenta).
 */
export function CashCloseForm({ review, suggestedFloat, cashSales, openFloat, sales = null, methods = [] }: { review: boolean; suggestedFloat: number; cashSales: number | null; openFloat: number | null; sales?: { total: number; count: number; byMethod: Method[] } | null; methods?: Method[] }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState({ float: (openFloat ?? suggestedFloat) ? (openFloat ?? suggestedFloat).toLocaleString("es-CL") : "", withdrawals: "", counted: "", note: "" });
  const [dec, setDec] = useState<Record<string, string>>({});
  const f = openFloat ?? pesos(v.float), w = pesos(v.withdrawals), c = v.counted.trim() ? pesos(v.counted) : null;
  const others: Method[] = review && sales ? sales.byMethod.filter((m) => m.code !== "CASH") : methods;
  const decVals = Object.fromEntries(others.map((m) => [m.code, dec[m.code]?.trim() ? pesos(dec[m.code]) : undefined]));
  const decOk = Object.values(decVals).every((x) => x !== null);
  const ok = f !== null && w !== null && c !== null && decOk;
  const expected = review && cashSales !== null && f !== null && w !== null ? f + cashSales - w : null;
  const diff = expected !== null && c !== null ? c - expected : null;
  function submit() {
    if (!ok) return;
    if (!confirm(review ? "¿Cerrar la caja y generar el comprobante?" : "¿Cerrar la caja? Revisa que los montos estén correctos: no se pueden modificar después.")) return;
    setErr(null);
    const declared = Object.fromEntries(Object.entries(decVals).filter(([, x]) => typeof x === "number")) as Record<string, number>;
    start(async () => {
      const r = await closeCashAction({ float: f!, counted: c!, withdrawals: w!, note: v.note, declared });
      if (r.ok) router.push(`/caja/cierre?ver=${encodeURIComponent(r.id)}&fecha=${r.date}`); else setErr(r.error);
    });
  }
  const bad = (x: number | null | undefined, s: string) => (s.trim() && x === null ? <span className="out small">monto inválido</span> : null);
  return (
    <div className="formcard arqueo" style={{ maxWidth: 760 }}>
      <h2 className="sect" style={{ marginTop: 0 }}>Arqueo y cierre de caja</h2>
      <ol className="arqueo-pasos">
        <li>Cuenta los billetes y monedas de la caja.</li>
        {others.length > 0 && <li>Anota los totales de débito y crédito del <b>cierre de la máquina TUU</b>.</li>}
        <li>Presiona <b>Cerrar caja</b> e imprime el comprobante.</li>
      </ol>

      <h3 className="arqueo-h">1 · Efectivo</h3>
      <table className="list arqueo-t"><tbody>
        <tr><td>Fondo inicial (sencillo con que partió)</td><td className="num">{openFloat !== null ? <><b>{clp(openFloat)}</b><div className="muted small">fijado en la apertura</div></>
          : <><input id="cc-float" className="money" inputMode="numeric" value={v.float} onChange={(e) => setV({ ...v, float: e.target.value })} placeholder="$ 0" aria-label="Fondo inicial" />{bad(f, v.float)}</>}</td></tr>
        {review && cashSales !== null && <tr><td>+ Ventas en efectivo</td><td className="num">{clp(cashSales)}</td></tr>}
        <tr><td>− Retiros o pagos hechos con efectivo de la caja</td><td className="num"><input id="cc-w" className="money" inputMode="numeric" value={v.withdrawals} onChange={(e) => setV({ ...v, withdrawals: e.target.value })} placeholder="$ 0" aria-label="Retiros o pagos" />{bad(w, v.withdrawals)}</td></tr>
        {expected !== null && <tr className="arqueo-sub"><td>= Debería haber en la caja</td><td className="num"><b>{clp(expected)}</b></td></tr>}
        <tr className="arqueo-key"><td><b>Efectivo contado</b> (todo lo que hay ahora)</td><td className="num"><input id="cc-c" className="money money-big" inputMode="numeric" value={v.counted} onChange={(e) => setV({ ...v, counted: e.target.value })} placeholder="$" aria-label="Efectivo contado" />{bad(c, v.counted)}</td></tr>
        {diff !== null && <tr><td>Resultado</td><td className="num"><Diff d={diff} /></td></tr>}
      </tbody></table>

      {others.length > 0 && (<>
        <h3 className="arqueo-h">2 · Tarjetas (máquina TUU)</h3>
        <table className="list arqueo-t">
          <thead><tr><th>Medio</th>{review && <th className="num">Sistema</th>}<th className="num">{review ? "Declarado" : "Total según voucher / app"}</th>{review && <th className="num">Resultado</th>}</tr></thead>
          <tbody>{others.map((m) => { const d = decVals[m.code]; return (
            <tr key={m.code}><td>{m.name}{review && m.count !== undefined && <div className="muted small">{m.count} venta(s)</div>}</td>
              {review && <td className="num">{clp(m.amount ?? 0)}</td>}
              <td className="num"><input className="money" inputMode="numeric" value={dec[m.code] ?? ""} onChange={(e) => setDec({ ...dec, [m.code]: e.target.value })} placeholder={review ? "opcional" : "$"} aria-label={`Total ${m.name}`} />{bad(d, dec[m.code] ?? "")}</td>
              {review && <td className="num">{typeof d === "number" ? <Diff d={d - (m.amount ?? 0)} /> : <span className="muted small">—</span>}</td>}
            </tr>); })}</tbody>
        </table>
        <p className="hint">Opcional. Si lo dejas vacío, el comprobante muestra solo lo registrado en el sistema.</p>
      </>)}

      {review && sales && (
        <div className="arqueo-totales">
          <div><span>Total efectivo</span><b>{clp(sales.byMethod.filter((m) => m.code === "CASH").reduce((a, m) => a + (m.amount ?? 0), 0))}</b></div>
          <div><span>Total tarjetas (débito + crédito)</span><b>{clp(sales.byMethod.filter((m) => m.code !== "CASH").reduce((a, m) => a + (m.amount ?? 0), 0))}</b></div>
          <div className="arqueo-gran"><span>Total del cierre <span className="muted small">({sales.count} venta(s))</span></span><b>{clp(sales.total)}</b></div>
        </div>
      )}
      <p className="hint">Mercado Pago (Mercado Libre), Rappi y transferencias no entran al cierre: esa plata llega después. Sí se suman en Ventas, Reportes y Dinero.</p>
      <div className="field" style={{ marginTop: 12 }}><label htmlFor="cc-n">Nota (opcional)</label><input id="cc-n" value={v.note} maxLength={300} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Ej.: retiré $10.000 para el banco" /></div>
      <div className="actions"><button className="btn btn-primary" type="button" disabled={pending || !ok} onClick={submit}>{pending ? "Cerrando…" : "Cerrar caja e imprimir comprobante"}</button>
        {!ok && <span className="muted small">Escribe el efectivo contado para poder cerrar.</span>}</div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/** Apertura de caja: quien abre anota el sencillo con que parte el turno. */
export function CashOpenForm({ suggestedFloat }: { suggestedFloat: number }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const [float, setFloat] = useState(suggestedFloat ? suggestedFloat.toLocaleString("es-CL") : ""); const [note, setNote] = useState("");
  const f = pesos(float);
  return (
    <div className="formcard cash-open" style={{ maxWidth: 640 }}>
      <h2 className="sect" style={{ marginTop: 0 }}>Abrir caja</h2>
      <p className="muted small" style={{ marginTop: 0 }}>Cuenta el sencillo con que parte la caja y anótalo. Queda fijo para el cierre de este turno.</p>
      <div className="fields" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div className="field"><label htmlFor="co-float">Fondo inicial (sencillo)</label><input id="co-float" inputMode="numeric" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="$ 0" />{float.trim() && f === null && <span className="out small">monto inválido</span>}</div>
        <div className="field"><label htmlFor="co-note">Nota (opcional)</label><input id="co-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="actions"><button className="btn btn-primary" type="button" disabled={pending || f === null} onClick={() => start(async () => {
        setErr(null); const r = await openCashAction({ float: f!, note }); if (r.ok) router.refresh(); else setErr(r.error);
      })}>{pending ? "Abriendo…" : `Abrir caja con ${clp(f ?? 0)}`}</button></div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
