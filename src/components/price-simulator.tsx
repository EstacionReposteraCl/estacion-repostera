"use client";
import { useMemo, useState } from "react";
import { simulate, priceForMargin, roundPrice, type ChannelFee } from "@/domain/pricing/simulator";

export interface SimChannel { key: string; name: string; fee: ChannelFee; note: string }
export interface SimProduct { id: string; name: string; sku: string; price: number; cost: number | null; costNote: string; exempt: boolean }
type Row = { price: string; disc: string; pct: string; fixed: string };

const peso = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
/** Montos en pesos: los puntos son de miles ("4.990"). */
const num = (s: string) => { const n = Number(String(s).replace(/[.\s$]/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
/** Porcentajes: acepta coma o punto decimal ("17,85" o "17.85"). */
const dec = (s: string) => { const n = Number(String(s).trim().replace(",", ".")); return Number.isFinite(n) ? n : 0; };

export function PriceSimulator({ product, channels }: { product: SimProduct; channels: SimChannel[] }) {
  const initial = (): Record<string, Row> => Object.fromEntries(channels.map((c) => [c.key, { price: String(product.price), disc: "0", pct: String(c.fee.percent).replace(".", ","), fixed: String(c.fee.fixed) }]));
  const [rows, setRows] = useState<Record<string, Row>>(initial);
  const [cost, setCost] = useState(product.cost !== null ? String(product.cost) : "");
  const [target, setTarget] = useState("30");
  const [allDisc, setAllDisc] = useState("");
  const [saved, setSaved] = useState(false);

  const c = num(cost); const m = dec(target);
  const res = useMemo(() => channels.map((ch) => {
    const r = rows[ch.key]; const fee = { percent: dec(r.pct), fixed: num(r.fixed) };
    const s = simulate({ price: num(r.price), discountPct: dec(r.disc), cost: c, exempt: product.exempt, fee });
    const p = priceForMargin(c, m, product.exempt, fee);
    return { ch, r, s, suggested: p === null ? null : roundPrice(p) };
  }), [channels, rows, c, m, product.exempt]);

  const set = (k: string, f: keyof Row, v: string) => setRows((r) => ({ ...r, [k]: { ...r[k], [f]: v } }));
  const applyDisc = (d: string) => { setAllDisc(d); setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, disc: d || "0" }]))); };
  const tone = (mp: number | null, profit: number) => (profit <= 0 ? "sim-bad" : mp !== null && mp >= m ? "sim-good" : "sim-warn");

  return (
    <div className="sim">
      <div className="sim-head">
        <div><h2 className="sect" style={{ margin: 0 }}>{product.name}</h2><p className="muted small" style={{ margin: "2px 0 0" }}>SKU {product.sku} · precio tienda {peso(product.price)} · {product.exempt ? "exento de IVA" : "con IVA"}</p></div>
        <div className="sim-ctrls">
          <label>Costo unitario (sin IVA)<input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" /><small className="muted">{product.costNote}</small></label>
          <label>Margen que quieres ganar<span className="sim-suffix"><input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />%</span></label>
          <label>Descuento a todos los canales<span className="sim-suffix"><input inputMode="decimal" value={allDisc} onChange={(e) => applyDisc(e.target.value)} placeholder="0" />%</span>
            <span className="sim-chips">{["0", "5", "10", "15", "20"].map((d) => <button key={d} type="button" className={`chip${(allDisc || "0") === d ? " on" : ""}`} onClick={() => applyDisc(d)}>{d}%</button>)}</span></label>
        </div>
      </div>
      {c <= 0 && <p className="error small">Este producto no tiene costo registrado: escríbelo arriba para ver la ganancia real.</p>}

      <div className="tablewrap"><table className="list sim-table">
        <thead><tr><th>Canal</th><th className="num">Precio</th><th className="num">Desc.</th><th className="num">Precio final</th><th className="num">Comisión</th><th className="num">Sin IVA</th><th className="num">Te queda</th><th className="num">Margen</th><th className="num">Para {m || 0}%</th></tr></thead>
        <tbody>{res.map(({ ch, r, s, suggested }) => (
          <tr key={ch.key}>
            <td><b>{ch.name}</b><div className="muted small">{ch.note}</div></td>
            <td className="num"><input className="sim-in" inputMode="numeric" value={r.price} onChange={(e) => set(ch.key, "price", e.target.value)} aria-label={`Precio ${ch.name}`} /></td>
            <td className="num"><span className="sim-suffix"><input className="sim-in sim-sm" inputMode="decimal" value={r.disc} onChange={(e) => set(ch.key, "disc", e.target.value)} aria-label={`Descuento ${ch.name}`} />%</span></td>
            <td className="num"><b>{peso(s.finalPrice)}</b></td>
            <td className="num">{peso(s.fee)}<div className="sim-fee"><input className="sim-in sim-sm" inputMode="decimal" value={r.pct} onChange={(e) => set(ch.key, "pct", e.target.value)} aria-label={`Comisión % ${ch.name}`} />%+<input className="sim-in sim-sm" inputMode="numeric" value={r.fixed} onChange={(e) => set(ch.key, "fixed", e.target.value)} aria-label={`Comisión fija ${ch.name}`} /></div></td>
            <td className="num">{peso(s.net)}</td>
            <td className={`num ${tone(s.marginPct, s.profit)}`}><b>{peso(s.profit)}</b></td>
            <td className={`num ${tone(s.marginPct, s.profit)}`}>{s.marginPct === null ? "—" : `${s.marginPct.toFixed(1)}%`}</td>
            <td className="num">{suggested === null ? <span className="muted small">imposible con esa comisión</span> : <button type="button" className="btn btn-small" title="Usar este precio" onClick={() => { set(ch.key, "price", String(suggested)); set(ch.key, "disc", "0"); }}>{peso(suggested)}</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="muted small">Verde: llega al margen que quieres · Amarillo: ganas, pero menos · Rojo: pierdes plata. “Te queda” = precio sin IVA − comisión − costo unitario (igual que la ganancia real de los reportes). La última columna es el precio sugerido para el margen que quieres, redondeado hacia arriba a un precio terminado en 90; tócalo para usarlo.</p>
      <div className="actions">
        <button type="button" className="btn" onClick={() => { setRows(initial()); setAllDisc(""); setCost(product.cost !== null ? String(product.cost) : ""); setSaved(false); }}>Volver a los valores iniciales</button>
        <button type="button" className="btn" onClick={async () => {
          const lines = res.map(({ ch, s }) => `${ch.name}: ${peso(s.finalPrice)} → te queda ${peso(s.profit)} (${s.marginPct === null ? "—" : s.marginPct.toFixed(1) + "%"})`).join("\n");
          try { await navigator.clipboard.writeText(`${product.name}\n${lines}`); setSaved(true); } catch { setSaved(false); }
        }}>{saved ? "✓ Copiado" : "Copiar resumen"}</button>
      </div>
    </div>
  );
}
