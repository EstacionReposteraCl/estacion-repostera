"use client";
import { useActionState } from "react";
import Link from "next/link";
import { saveStockAction, type StockState } from "@/actions/inventory.actions";

export interface StockRow { id: string; name: string; sku: string; unit: string; stock: string; avgCost: number | null; refCost: number | null; hasMovements: boolean }
const clp = (n: number | null) => (n == null ? "—" : "$" + n.toLocaleString("es-CL"));
const plain = (t: string) => { const [i, f = ""] = t.split("."); const fr = f.replace(/0+$/, ""); return fr ? `${i},${fr}` : i; };

export function StockTable({ rows }: { rows: StockRow[] }) {
  const [state, action, pending] = useActionState<StockState, FormData>(saveStockAction, undefined);
  const anyAdjust = rows.some((r) => r.hasMovements);
  const k = state?.keep ?? {};
  return (
    <form action={action} key={state?.at ?? 0}>
      {state?.at && (state.saved ?? 0) > 0 && <p className="ok" role="status">Se guardaron {state.saved} producto(s).</p>}
      {state?.errors && state.errors.length > 0 && <div className="error" role="alert"><strong>No se guardaron:</strong><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{state.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
      <div className="tablewrap"><table className="list">
        <thead><tr><th>Producto</th><th className="num">Stock actual</th><th>Nuevo stock</th><th>Costo unitario</th><th className="hide-sm">Tipo</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td><input type="hidden" name="id" value={r.id} /><input type="hidden" name={`name_${r.id}`} value={r.name} /><input type="hidden" name={`was_${r.id}`} value={plain(r.stock)} />
              <input type="hidden" name={`mode_${r.id}`} value={r.hasMovements ? "count" : "opening"} />
              <Link href={`/productos/${r.id}`}>{r.name}</Link><div className="muted small">{r.sku}</div></td>
            <td className="num">{plain(r.stock)} <span className="muted small">{r.unit.toLowerCase()}</span></td>
            <td><div className="inline"><input className="qty" name={`qty_${r.id}`} defaultValue={k[`qty_${r.id}`] ?? ""} inputMode="decimal" placeholder={r.hasMovements ? plain(r.stock) : "0"} aria-label={`Nuevo stock de ${r.name}`} /></div></td>
            <td>{r.hasMovements && r.stock !== "0.000"
              ? <span className="muted small">{clp(r.avgCost)} prom.</span>
              : <div className="inline"><input className="money" name={`cost_${r.id}`} inputMode="numeric" defaultValue={k[`cost_${r.id}`] ?? r.refCost ?? ""} placeholder="$ por unidad" aria-label={`Costo unitario de ${r.name}`} /></div>}</td>
            <td className="hide-sm">{r.hasMovements ? <span className="pill">Ajuste por conteo</span> : <span className="pill">Stock inicial</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="actions">
        {anyAdjust && <input className="note" name="note" defaultValue={k.note ?? ""} placeholder="Nota del conteo (obligatoria para ajustes)" style={{ maxWidth: 340 }} />}
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar cantidades de esta página"}</button>
        <span className="muted small">Solo se guardan las filas donde escribiste una cantidad.</span>
      </div>
    </form>
  );
}
