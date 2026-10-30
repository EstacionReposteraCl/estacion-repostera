"use client";
// Formulario de cotización: cliente, productos (buscar o escanear), líneas libres (p. ej. despacho), vigencia, medios de pago y notas.
// El navegador solo muestra una vista previa; el servidor recalcula precios y totales.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { posSearchAction } from "@/actions/sales.actions";
import { createQuoteAction, updateQuoteAction } from "@/actions/quotes.actions";
import type { ProductPublicDTO } from "@/dto/product.dto";
import { QUOTE_PAY, QUOTE_PAY_LABEL, QUOTE_VALIDITY, quoteTotals, lineTotalOf, type QuotePay } from "@/domain/quotes/quote";

interface Line { key: number; productId: string | null; name: string; sku: string | null; qty: string; price: string; base: number | null }
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const toInt = (s: string) => { const t = s.replace(/[.$\s]/g, ""); return /^\d+$/.test(t) ? Number(t) : NaN; };
const toQty = (s: string) => { const n = Number(s.replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : NaN; };

export interface QuoteFormInitial {
  id: string; customer: { name: string; rut: string; phone: string; email: string };
  lines: { productId: string | null; name: string; sku: string | null; qty: string; price: string; base: number | null }[];
  validDays: number; payMethods: QuotePay[]; docType: "" | "BOLETA" | "FACTURA"; discount: number; notes: string;
}

export function QuoteForm({ isAdmin, initial = null }: { isAdmin: boolean; initial?: QuoteFormInitial | null }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [cust, setCust] = useState(initial?.customer ?? { name: "", rut: "", phone: "", email: "" });
  const [lines, setLines] = useState<Line[]>(() => (initial?.lines ?? []).map((l, i) => ({ ...l, key: i + 1 }))); const keyRef = useRef((initial?.lines.length ?? 0) + 1);
  const [q, setQ] = useState(""); const [results, setResults] = useState<ProductPublicDTO[]>([]); const [searching, setSearching] = useState(false); const seq = useRef(0);
  const [validDays, setValidDays] = useState(initial?.validDays ?? 7);
  const [pays, setPays] = useState<QuotePay[]>(initial?.payMethods ?? [...QUOTE_PAY.filter((p) => p !== "OTHER")]);
  const [docType, setDocType] = useState<"" | "BOLETA" | "FACTURA">(initial?.docType ?? "");
  const [discount, setDiscount] = useState(initial && initial.discount > 0 ? String(initial.discount) : ""); const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const priceOf = (l: Line) => toInt(l.price);
  const totalOf = (l: Line) => { const u = priceOf(l), n = toQty(l.qty); return Number.isFinite(u) && Number.isFinite(n) ? lineTotalOf(n, u) : NaN; };
  const bad = lines.some((l) => !Number.isFinite(totalOf(l)) || (l.productId === null && !l.name.trim()));
  const disc = isAdmin && discount.trim() ? toInt(discount) : 0;
  const t = quoteTotals(lines.map((l) => ({ total: Number.isFinite(totalOf(l)) ? totalOf(l) : 0 })), Number.isFinite(disc) ? disc : 0);

  async function search(term: string) {
    const my = ++seq.current; setSearching(true);
    const r = await posSearchAction(term); if (my !== seq.current) return;
    setSearching(false); setResults(r.ok ? r.rows : []);
    return r.ok ? r.rows : [];
  }
  function add(p: ProductPublicDTO) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: String((toQty(l.qty) || 0) + 1) } : l));
      return [...ls, { key: keyRef.current++, productId: p.id, name: p.name, sku: p.sku, qty: "1", price: String(p.salePrice), base: p.salePrice }];
    });
    setQ(""); setResults([]);
  }
  const addFree = (name = "") => setLines((ls) => [...ls, { key: keyRef.current++, productId: null, name, sku: null, qty: "1", price: "", base: null }]);
  const upd = (key: number, d: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...d } : l)));

  function submit() {
    setError(null);
    if (!cust.name.trim()) return setError("Escribe el nombre del cliente o beneficiario.");
    if (lines.length === 0) return setError("Agrega al menos un producto.");
    if (bad) return setError("Revisa las cantidades, precios y descripciones de las líneas.");
    if (pays.length === 0) return setError("Marca al menos un medio de pago.");
    start(async () => {
      const data = {
        customer: cust, validDays, payMethods: pays, docType: docType || null, notes, discount: Number.isFinite(disc) ? disc : 0,
        lines: lines.map((l) => (l.productId
          ? { productId: l.productId, qty: l.qty, ...(isAdmin && priceOf(l) !== l.base ? { unitPrice: priceOf(l) } : {}) }
          : { name: l.name, qty: l.qty, unitPrice: priceOf(l) })),
      };
      const r = initial ? await updateQuoteAction(initial.id, data) : await createQuoteAction(data);
      if (!r.ok) return setError(r.error);
      router.push(`/cotizaciones/${initial ? initial.id : (r as { id: string }).id}`); router.refresh();
    });
  }

  return (
    <div className="quote-form">
      <section className="tile">
        <h2 className="qf-h">Cliente / beneficiario</h2>
        <div className="fields">
          <div className="field full"><label htmlFor="qn">Nombre completo o razón social *</label><input id="qn" value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} maxLength={120} /></div>
          <div className="field"><label htmlFor="qr">RUT</label><input id="qr" value={cust.rut} onChange={(e) => setCust({ ...cust, rut: e.target.value })} placeholder="12.345.678-9" maxLength={20} /></div>
          <div className="field"><label htmlFor="qp">Teléfono</label><input id="qp" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} inputMode="tel" maxLength={30} /></div>
          <div className="field full"><label htmlFor="qe">Correo</label><input id="qe" type="email" value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} maxLength={120} /></div>
        </div>
      </section>

      <section className="tile">
        <h2 className="qf-h">Productos</h2>
        <div className="qf-search">
          <input value={q} placeholder="Escanea el código o escribe el nombre…" aria-label="Buscar producto"
            onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length >= 2) search(e.target.value); else setResults([]); }}
            onKeyDown={async (e) => { if (e.key === "Enter") { e.preventDefault(); const r = await search(q); if (r && r.length > 0 && (r.length === 1 || r[0].barcodes?.includes(q.trim()) || r[0].sku.toLowerCase() === q.trim().toLowerCase())) add(r[0]); } }} />
          {(results.length > 0 || searching) && (
            <ul className="qf-results">
              {searching && results.length === 0 && <li className="muted small">Buscando…</li>}
              {results.map((r) => <li key={r.id}><button type="button" onClick={() => add(r)}><span>{r.name} <span className="muted small">{r.sku}</span></span><b>{clp(r.salePrice)}</b></button></li>)}
            </ul>
          )}
        </div>
        {lines.length > 0 && (
          <div className="tablewrap"><table className="list qf-table">
            <thead><tr><th>N°</th><th>Producto o servicio</th><th className="num">Cantidad</th><th className="num">Valor unitario</th><th className="num">Valor total</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td>{i + 1}</td>
                  <td>{l.productId ? <>{l.name}<div className="muted small">{l.sku}</div></> : <input value={l.name} onChange={(e) => upd(l.key, { name: e.target.value })} placeholder="Descripción (p. ej. Despacho a domicilio)" aria-label="Descripción" />}</td>
                  <td className="num"><input className="qf-qty" value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} inputMode="decimal" aria-label="Cantidad" /></td>
                  <td className="num">{l.productId && !isAdmin ? clp(l.base ?? 0) : <input className="money qf-price" value={l.price} onChange={(e) => upd(l.key, { price: e.target.value })} inputMode="numeric" placeholder="$" aria-label="Valor unitario" />}</td>
                  <td className="num">{Number.isFinite(totalOf(l)) ? clp(totalOf(l)) : "—"}</td>
                  <td><button type="button" className="link small" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <div className="actions" style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => addFree("Despacho a domicilio")}>＋ Despacho</button>
          <button type="button" className="btn" onClick={() => addFree()}>＋ Otra línea</button>
        </div>
      </section>

      <section className="tile">
        <h2 className="qf-h">Condiciones</h2>
        <div className="fields">
          <div className="field"><label htmlFor="qv">Vigencia</label>
            <select id="qv" value={validDays} onChange={(e) => setValidDays(Number(e.target.value))}>{QUOTE_VALIDITY.map((d) => <option key={d} value={d}>{d} días</option>)}</select></div>
          <div className="field"><label htmlFor="qd">Documento que se emitirá</label>
            <select id="qd" value={docType} onChange={(e) => setDocType(e.target.value as "" | "BOLETA" | "FACTURA")}><option value="">Boleta o factura (a elección)</option><option value="BOLETA">Boleta</option><option value="FACTURA">Factura</option></select></div>
          <div className="field full"><span className="lbl">Medios de pago</span>
            <div className="qf-pays">{QUOTE_PAY.map((p) => (
              <label key={p} className="inline"><input type="checkbox" checked={pays.includes(p)} onChange={(e) => setPays((ps) => (e.target.checked ? [...ps, p] : ps.filter((x) => x !== p)))} style={{ width: "auto" }} /> {QUOTE_PAY_LABEL[p]}</label>
            ))}</div></div>
          {isAdmin && <div className="field"><label htmlFor="qdesc">Descuento ($)</label><input id="qdesc" className="money" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" placeholder="0" /></div>}
          <div className="field full"><label htmlFor="qnotes">Notas (opcional)</label><textarea id="qnotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={600} placeholder="Ej.: Precios sujetos a stock. Retiro en tienda o despacho." /></div>
        </div>
      </section>

      <section className="tile qf-sum">
        <div><span>Neto</span><b>{clp(t.net)}</b></div>
        <div><span>IVA 19%</span><b>{clp(t.vat)}</b></div>
        {t.discount > 0 && <div><span>Descuento</span><b>−{clp(t.discount)}</b></div>}
        <div className="qf-total"><span>Total</span><b>{clp(t.total)}</b></div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>{pending ? "Guardando…" : initial ? "Guardar cambios" : "Guardar cotización"}</button></div>
    </div>
  );
}
