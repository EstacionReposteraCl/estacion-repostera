"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { registerPurchaseAction, purchaseSearchAction } from "@/actions/purchases.actions";
import type { ProductPublicDTO } from "@/dto/product.dto";
import { planPurchaseDocument, type EnteredCost } from "@/domain/purchases/purchases";
import { parseMoneyCents } from "@/core/money/parse-money";
import { parseQuantity } from "@/core/money/quantity";

interface Sup { id: string; name: string; taxId: string | null }
type Mode = "unit" | "line";
interface Line { p: ProductPublicDTO; qty: string; amount: string; mode: Mode }
const clp = (n: number) => "$" + n.toLocaleString("es-CL");

export function PurchaseForm({ suppliers, today }: { suppliers: Sup[]; today: string }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState(""); const [newSup, setNewSup] = useState({ name: "", taxId: "" });
  const [docType, setDocType] = useState<"FACTURA" | "BOLETA" | "OTRO">("FACTURA"); const [docNumber, setDocNumber] = useState(""); const [docDate, setDocDate] = useState(today);
  const [withVat, setWithVat] = useState(false); const [note, setNote] = useState(""); const [paperTotal, setPaperTotal] = useState("");
  const [q, setQ] = useState(""); const [results, setResults] = useState<ProductPublicDTO[]>([]); const [lines, setLines] = useState<Line[]>([]);
  const seq = useRef(0); const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = q.trim(); if (t.length < 2) return; const my = ++seq.current;
    const h = setTimeout(async () => { const r = await purchaseSearchAction(t); if (my === seq.current) setResults(r); }, 250); return () => clearTimeout(h); }, [q]);

  // costo por línea: "por unidad" admite centavos (1.508,50); "total línea" en pesos enteros
  const costs = lines.map((l): EnteredCost | null => {
    const c = parseMoneyCents(l.amount); if (c === null) return null;
    if (l.mode === "unit") return { kind: "unitCostCents", cents: c };
    return c % 100 === 0 ? { kind: "lineAmount", amount: c / 100 } : null;
  });
  const plans = (() => {
    const idx: number[] = []; const ins: { quantityBase: bigint; entered: EnteredCost }[] = [];
    lines.forEach((l, i) => { try { const qty = parseQuantity(l.qty.replace(",", ".")); const c = costs[i]; if (c && qty > 0n) { idx.push(i); ins.push({ quantityBase: qty, entered: c }); } } catch { /* línea incompleta */ } });
    const out: (ReturnType<typeof planPurchaseDocument>[number] | null)[] = lines.map(() => null);
    try { planPurchaseDocument(ins, { pricesIncludeVat: withVat, vatRecoverable: docType === "FACTURA" }).forEach((p, k) => { out[idx[k]] = p; }); } catch { /* inválido */ }
    return out;
  })();
  const totals = plans.reduce((a, p) => (p ? { net: a.net + p.lineNet, vat: a.vat + p.lineVat, total: a.total + p.lineTotal } : a), { net: 0, vat: 0, total: 0 });
  const allOk = lines.length > 0 && plans.every(Boolean);
  const paperC = parseMoneyCents(paperTotal); const paper = paperC === null ? NaN : Math.round(paperC / 100); const diff = Number.isFinite(paper) ? paper - totals.total : null;

  function add(p: ProductPublicDTO) { if (!lines.some((l) => l.p.id === p.id)) setLines((ls) => [...ls, { p, qty: "1", amount: "", mode: "unit" }]); setQ(""); setResults([]); searchRef.current?.focus(); }
  const upd = (i: number, d: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...d } : l)));
  function changeType(t: typeof docType) { setDocType(t); setWithVat(t !== "FACTURA"); }

  function submit() {
    setError(null);
    start(async () => {
      const r = await registerPurchaseAction({
        supplierId: supplierId && supplierId !== "__new" ? supplierId : null, newSupplier: supplierId === "__new" ? newSup : null,
        docType, docNumber: docNumber || null, docDate, pricesIncludeVat: withVat, note,
        lines: lines.map((l) => ({ productId: l.p.id, quantity: l.qty.replace(",", "."), ...(l.mode === "unit" ? { unitCost: (parseMoneyCents(l.amount) ?? NaN) / 100 } : { lineAmount: (parseMoneyCents(l.amount) ?? NaN) / 100 }) })),
      });
      if (r.ok) router.push(`/compras/${r.id}?nueva=1`); else setError(r.error);
    });
  }
  const costLabel = docType === "FACTURA" && !withVat ? "neto" : "con IVA";
  return (
    <div className="formcard" style={{ maxWidth: 1000 }}>
      <div className="fields" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div className="field"><label htmlFor="sup">Proveedor</label>
          <select id="sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Sin proveedor</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.taxId ? ` (${s.taxId})` : ""}</option>)}<option value="__new">+ Nuevo proveedor…</option></select></div>
        {supplierId === "__new" && (<>
          <div className="field"><label htmlFor="ns">Nombre del proveedor</label><input id="ns" value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="nr">RUT (opcional)</label><input id="nr" value={newSup.taxId} onChange={(e) => setNewSup({ ...newSup, taxId: e.target.value })} placeholder="76.123.456-7" /></div>
        </>)}
        <div className="field"><label htmlFor="dt">Documento</label>
          <select id="dt" value={docType} onChange={(e) => changeType(e.target.value as typeof docType)}><option value="FACTURA">Factura (IVA recuperable)</option><option value="BOLETA">Boleta</option><option value="OTRO">Otro / sin documento</option></select></div>
        <div className="field"><label htmlFor="dn">N° documento{docType !== "OTRO" ? "" : " (opcional)"}</label><input id="dn" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} /></div>
        <div className="field"><label htmlFor="dd">Fecha del documento</label><input id="dd" type="date" value={docDate} max={today} onChange={(e) => setDocDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="vat">Los costos que ingreso son</label>
          <select id="vat" value={withVat ? "con" : "neto"} onChange={(e) => setWithVat(e.target.value === "con")}><option value="neto">Netos (sin IVA)</option><option value="con">Con IVA incluido</option></select></div>
      </div>
      <p className="hint">{docType === "FACTURA" ? "Factura: el IVA es crédito fiscal, el costo del inventario es el NETO." : "Boleta / otro: el IVA no se recupera, el costo del inventario es el TOTAL pagado."}</p>

      <h3 style={{ margin: "18px 0 6px", fontSize: "1rem" }}>Productos</h3>
      <div className="pos-search"><input ref={searchRef} type="search" value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) { seq.current++; setResults([]); } }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (results[0]) add(results[0]); } }} placeholder="Escanea o busca el producto comprado…" aria-label="Buscar producto comprado" /></div>
      {results.length > 0 && <ul className="pos-results">{results.map((r) => <li key={r.id}><button type="button" onClick={() => add(r)}><span className="pr-name">{r.name}<span className="muted small"> · {r.sku}</span></span><span className="muted small">stock {r.stock}</span></button></li>)}</ul>}
      {lines.length > 0 && (
        <div className="tablewrap" style={{ marginTop: 10 }}><table className="list">
          <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo ({costLabel})</th><th className="num">Neto</th><th className="num hide-sm">IVA</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{lines.map((l, i) => { const pl = plans[i]; return (
            <tr key={l.p.id}>
              <td>{l.p.name}<div className="muted small">{l.p.sku}</div></td>
              <td><input className="qty" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} inputMode="decimal" aria-label={`Cantidad de ${l.p.name}`} style={{ width: 80 }} /></td>
              <td><div className="inline"><input className="money" value={l.amount} onChange={(e) => upd(i, { amount: e.target.value })} inputMode="decimal" placeholder={l.mode === "unit" ? "$ ej. 1.508,50" : "$"} aria-label={`Costo de ${l.p.name}`} title={l.mode === "unit" ? "Admite centavos: 1.508,50" : "Total de la línea en pesos"} />
                <select value={l.mode} onChange={(e) => upd(i, { mode: e.target.value as Mode })} aria-label="Tipo de costo"><option value="unit">por unidad</option><option value="line">total línea</option></select></div></td>
              <td className="num">{pl ? clp(pl.lineNet) : "—"}</td><td className="num hide-sm">{pl ? clp(pl.lineVat) : "—"}</td><td className="num">{pl ? clp(pl.lineTotal) : "—"}</td>
              <td><button type="button" className="link" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Quitar</button></td>
            </tr>); })}</tbody>
          <tfoot><tr><th colSpan={3} style={{ textAlign: "right" }}>Totales</th><th className="num">{clp(totals.net)}</th><th className="num hide-sm">{clp(totals.vat)}</th><th className="num">{clp(totals.total)}</th><th></th></tr></tfoot>
        </table></div>
      )}
      <div className="fields" style={{ marginTop: 12 }}>
        <div className="field"><label htmlFor="pt">Total del documento en papel (para comparar)</label><input id="pt" value={paperTotal} onChange={(e) => setPaperTotal(e.target.value)} inputMode="numeric" placeholder="Opcional" />
          {diff !== null && lines.length > 0 && <p className={diff === 0 ? "hint" : "out small"} style={{ marginTop: 4 }}>{diff === 0 ? "✓ Coincide con el documento." : `Diferencia de ${clp(Math.abs(diff))} (${diff > 0 ? "el papel es mayor" : "el papel es menor"}). Revisa costos o si eran con/sin IVA.`}</p>}</div>
        <div className="field"><label htmlFor="nt">Nota (opcional)</label><input id="nt" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
      </div>
      <div className="actions">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={pending || !allOk || (supplierId === "__new" && newSup.name.trim().length < 2)}>{pending ? "Registrando…" : `Registrar compra ${clp(totals.total)}`}</button>
        <Link className="btn" href="/compras">Cancelar</Link>
        <span className="muted small">Al registrar, el stock y el costo promedio se actualizan.</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
