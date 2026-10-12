"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { simulate, priceForMargin, roundPrice, type ChannelFee } from "@/domain/pricing/simulator";
import { priceSearchAction } from "@/actions/pricing.actions";

export interface SimChannel { key: string; name: string; fee: ChannelFee; note: string }
export interface SimProduct { id: string; name: string; sku: string; price: number; cost: number | null; costNote: string; exempt: boolean }
type Row = { price: string; disc: string; pct: string; fixed: string };

const peso = (n: number) => (n < 0 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("es-CL");
/** Montos en pesos: los puntos son de miles ("4.990"). */
const num = (s: string) => { const n = Number(String(s).replace(/[.\s$]/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
/** Porcentajes: acepta coma o punto decimal ("17,85" o "17.85"). */
const dec = (s: string) => { const n = Number(String(s).trim().replace(",", ".")); return Number.isFinite(n) ? n : 0; };

/** Buscador con sugerencias desde la 3.ª letra (sin apretar Enter). */
export function ProductPicker({ initial = "" }: { initial?: string }) {
  const router = useRouter(); const [q, setQ] = useState(initial); const [rows, setRows] = useState<{ id: string; name: string; sku: string; salePrice: number }[]>([]);
  const [open, setOpen] = useState(false); const [pending, start] = useTransition(); const [hi, setHi] = useState(0); const seq = useRef(0);
  useEffect(() => {
    const text = q.trim(); if (text.length < 3) return;
    const my = ++seq.current;
    const t = setTimeout(() => start(async () => { const r = await priceSearchAction(text); if (my === seq.current) { setRows(r); setOpen(true); setHi(0); } }), 250);
    return () => clearTimeout(t);
  }, [q]);
  const pick = (id: string) => { setOpen(false); router.push(`/precios?id=${id}`); };
  const shown = q.trim().length >= 3 && open;
  return (
    <div className="picker">
      <input type="search" value={q} autoFocus={!initial} placeholder="Escribe al menos 3 letras del producto, SKU o código" aria-label="Buscar producto"
        onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 3) setOpen(false); }}
        onFocus={() => rows.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!shown || !rows.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, rows.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(rows[hi].id); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {pending && <span className="picker-busy muted small">Buscando…</span>}
      {shown && (
        <ul className="picker-list" role="listbox">
          {rows.length === 0 ? <li className="muted small" style={{ padding: "10px 12px" }}>Sin resultados para “{q.trim()}”.</li>
            : rows.map((r, i) => (
              <li key={r.id} role="option" aria-selected={i === hi} className={i === hi ? "on" : undefined} onMouseDown={(e) => { e.preventDefault(); pick(r.id); }} onMouseEnter={() => setHi(i)}>
                <span><b>{r.name}</b><small className="muted"> · {r.sku}</small></span><span className="muted">{peso(r.salePrice)}</span>
              </li>))}
        </ul>
      )}
    </div>
  );
}

export function PriceSimulator({ product, channels }: { product: SimProduct; channels: SimChannel[] }) {
  const initial = (): Record<string, Row> => Object.fromEntries(channels.map((c) => [c.key, { price: String(product.price), disc: "0", pct: String(c.fee.percent).replace(".", ","), fixed: String(c.fee.fixed) }]));
  const [rows, setRows] = useState<Record<string, Row>>(initial);
  const [key, setKey] = useState("");
  const [cost, setCost] = useState(product.cost !== null ? String(product.cost) : "");
  const [target, setTarget] = useState("30");

  const ch = channels.find((x) => x.key === key) ?? null; const r = ch ? rows[ch.key] : null;
  const c = num(cost); const m = dec(target);
  const out = useMemo(() => {
    if (!r) return null;
    const fee = { percent: dec(r.pct), fixed: num(r.fixed) };
    const s = simulate({ price: num(r.price), discountPct: dec(r.disc), cost: c, exempt: product.exempt, fee });
    const p = priceForMargin(c, m, product.exempt, fee);
    return { s, suggested: p === null ? null : roundPrice(p) };
  }, [r, c, m, product.exempt]);
  const set = (f: keyof Row, v: string) => ch && setRows((all) => ({ ...all, [ch.key]: { ...all[ch.key], [f]: v } }));
  const tone = !out ? "" : out.s.profit <= 0 ? "sim-bad" : out.s.marginPct !== null && out.s.marginPct >= m ? "sim-good" : "sim-warn";

  return (
    <div className="sim">
      <div className="sim-top">
        <div><h2 className="sect" style={{ margin: 0 }}>{product.name}</h2><p className="muted small" style={{ margin: "2px 0 0" }}>SKU {product.sku} · precio tienda {peso(product.price)} · {product.exempt ? "exento de IVA" : "con IVA"}</p></div>
        <label className="sim-channel">Canal a simular
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">Elige un canal…</option>
            {channels.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
          </select>
        </label>
      </div>

      {!ch || !r || !out ? <p className="muted sim-empty">Elige el canal en la lista de arriba para ver cuánto te queda vendiendo este producto ahí.</p> : (
        <div className="sim-body">
          <div className="sim-form">
            <label>Precio en {ch.name}<input inputMode="numeric" value={r.price} onChange={(e) => set("price", e.target.value)} /></label>
            <label>Descuento<span className="sim-suffix"><input inputMode="decimal" value={r.disc} onChange={(e) => set("disc", e.target.value)} />%</span>
              <span className="sim-chips">{["0", "5", "10", "15", "20"].map((d) => <button key={d} type="button" className={`chip${(r.disc || "0") === d ? " on" : ""}`} onClick={() => set("disc", d)}>{d}%</button>)}</span></label>
            <label>Comisión del canal<span className="sim-suffix"><input inputMode="decimal" value={r.pct} onChange={(e) => set("pct", e.target.value)} />% +<input inputMode="numeric" value={r.fixed} onChange={(e) => set("fixed", e.target.value)} />fijo</span><small className="muted">{ch.note}</small></label>
            <label>Costo unitario (sin IVA)<input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" /><small className="muted">{product.costNote}</small></label>
            <label>Margen que quieres ganar<span className="sim-suffix"><input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />%</span></label>
          </div>

          <div className="sim-result">
            <div className="sim-line"><span>Precio final{dec(r.disc) > 0 ? ` (−${r.disc}%)` : ""}</span><b>{peso(out.s.finalPrice)}</b></div>
            {!product.exempt && <div className="sim-line muted"><span>IVA</span><span>−{peso(out.s.iva)}</span></div>}
            <div className="sim-line muted"><span>Comisión {ch.name}</span><span>−{peso(out.s.fee)}</span></div>
            <div className="sim-line muted"><span>Costo del producto</span><span>−{peso(c)}</span></div>
            <div className={`sim-total ${tone}`}><span>Te queda</span><strong>{peso(out.s.profit)}</strong><small>{out.s.marginPct === null ? "—" : `margen ${out.s.marginPct.toFixed(1)}%`}</small></div>
            {c <= 0 && <p className="error small">Este producto no tiene costo registrado: escríbelo para ver la ganancia real.</p>}
            <div className="sim-suggest">
              {out.suggested === null ? <span className="muted small">Con esa comisión no se puede llegar a {m}% de margen.</span> : <>
                <span>Para ganar <b>{m}%</b> en {ch.name} véndelo a</span>
                <button type="button" className="btn btn-primary" onClick={() => { set("price", String(out.suggested)); set("disc", "0"); }}>{peso(out.suggested)} · usar</button>
              </>}
            </div>
          </div>
        </div>
      )}
      {ch && <div className="actions"><button type="button" className="btn btn-small" onClick={() => { setRows(initial()); setCost(product.cost !== null ? String(product.cost) : ""); }}>Volver a los valores iniciales</button></div>}
    </div>
  );
}
