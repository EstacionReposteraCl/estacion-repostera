"use client";
// Caja. El navegador NUNCA decide precios: solo muestra un total calculado con las MISMAS funciones puras que usa el
// servidor (src/core/money). El servidor recalcula todo y rechaza si los pagos no cuadran.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeSaleAction, posSearchAction } from "@/actions/sales.actions";
import type { ProductPublicDTO } from "@/dto/product.dto";
import { parseQuantity } from "@/core/money/quantity";
import { lineTotalPerBase } from "@/core/money/iva";

interface Opt { id: string; code: string; name: string }
interface Line { p: ProductPublicDTO; qty: string; price?: string }   // price: solo ADMINISTRADOR (precio manual)
interface Pay { methodId: string; amount: string }
const clp = (n: number) => "$" + n.toLocaleString("es-CL");
const toInt = (s: string) => { const t = s.replace(/[.$\s]/g, ""); return /^\d+$/.test(t) ? Number(t) : NaN; };
/** Precio efectivo: el manual (si el administrador lo escribió y es válido) o el del catálogo. NaN si el manual es inválido. */
const unitPrice = (l: Line) => (l.price === undefined || l.price.trim() === "" ? l.p.salePrice : toInt(l.price) > 0 ? toInt(l.price) : NaN);
const isManual = (l: Line) => { const u = unitPrice(l); return Number.isFinite(u) && u !== l.p.salePrice; };
const lineTotal = (l: Line) => { try { const u = unitPrice(l); return Number.isFinite(u) ? lineTotalPerBase(parseQuantity(l.qty.replace(",", ".")), u) : NaN; } catch { return NaN; } };
const plainQty = (t: string | null) => { if (t == null) return null; const [i, f = ""] = t.split("."); const fr = f.replace(/0+$/, ""); return fr ? `${i},${fr}` : i; };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function Pos({ channels, methods, isAdmin, today }: { channels: Opt[]; methods: Opt[]; isAdmin: boolean; today: string }) {
  const router = useRouter();
  const local = channels.find((c) => c.code === "LOCAL") ?? channels[0];
  const cash = methods.find((m) => m.code === "CASH") ?? methods[0];
  const [q, setQ] = useState(""); const [results, setResults] = useState<ProductPublicDTO[]>([]); const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [channelId, setChannelId] = useState(local?.id ?? ""); const [externalRef, setExternalRef] = useState("");
  const [pays, setPays] = useState<Pay[]>([{ methodId: cash?.id ?? "", amount: "" }]);
  const [received, setReceived] = useState("");
  // Solo administrador: fecha de la venta (para pasar comprobantes atrasados de TUU). Se mantiene entre ventas.
  const [saleDate, setSaleDate] = useState(today); const [tuuRef, setTuuRef] = useState("");
  const backdated = isAdmin && saleDate && saleDate !== today;
  const [error, setError] = useState<string | null>(null); const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null); const seq = useRef(0);
  const attempt = useRef<{ payload: string; key: string } | null>(null);

  const total = useMemo(() => lines.reduce((s, l) => s + (Number.isFinite(lineTotal(l)) ? lineTotal(l) : 0), 0), [lines]);
  const invalidLine = lines.some((l) => !Number.isFinite(lineTotal(l)) || lineTotal(l) <= 0);
  // el último pago toma automáticamente lo que falta
  const payAmounts = pays.map((p, i) => (i === pays.length - 1 ? total - pays.slice(0, -1).reduce((s, x) => s + (toInt(x.amount) || 0), 0) : toInt(p.amount)));
  const paysOk = payAmounts.every((a) => Number.isSafeInteger(a) && a > 0) && payAmounts.reduce((s, a) => s + a, 0) === total;
  const isCashOnly = pays.length === 1 && pays[0].methodId === cash?.id;
  const change = isCashOnly && received ? toInt(received) - total : NaN;
  const channel = channels.find((c) => c.id === channelId);

  async function runSearch(term: string) {
    const my = ++seq.current; setSearching(true);
    const r = await posSearchAction(term);
    if (my !== seq.current) return null;
    setSearching(false); setResults(r.rows); if (!r.ok) setError(r.error);
    return r.rows;
  }
  useEffect(() => {
    const t = q.trim(); if (t.length < 2) return;
    const h = setTimeout(() => { void runSearch(t); }, 250); return () => clearTimeout(h);
  }, [q]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  function add(p: ProductPublicDTO) {
    setError(null);
    setLines((ls) => {
      const i = ls.findIndex((l) => l.p.id === p.id);
      if (i >= 0) { const c = [...ls]; const n = Number(c[i].qty.replace(",", ".")); c[i] = { ...c[i], qty: Number.isInteger(n) ? String(n + 1) : c[i].qty }; return c; }
      return [...ls, { p, qty: "1" }];
    });
    setQ(""); setResults([]); searchRef.current?.focus();
  }
  async function onEnter() {
    const t = q.trim(); if (!t) return;
    const rows = (await runSearch(t)) ?? results;
    const exact = rows.find((r) => r.sku.toLowerCase() === t.toLowerCase());
    if (exact) add(exact); else if (rows.length === 1 || (/^\d{6,}$/.test(t) && rows.length >= 1)) add(rows[0]);
    else if (rows.length === 0) setError(`No se encontró “${t}”.`);
  }
  const setQty = (i: number, qty: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, qty } : l)));
  const bump = (i: number, d: number) => setLines((ls) => ls.flatMap((l, j) => { if (j !== i) return [l]; const n = Number(l.qty.replace(",", ".")); const v = (Number.isFinite(n) ? Math.floor(n) : 0) + d; return v <= 0 ? [] : [{ ...l, qty: String(v) }]; }));

  /** Al elegir un canal, si existe un medio de pago con el mismo código (p. ej. RAPPI), se propone como pago. */
  function pickChannel(id: string) {
    setChannelId(id); const c = channels.find((x) => x.id === id); const m = methods.find((x) => x.code === c?.code);
    if (pays.length === 1) setPays([{ methodId: m?.id ?? (c?.code === "LOCAL" ? cash?.id ?? pays[0].methodId : pays[0].methodId), amount: "" }]);
  }
  /** Si el medio de pago es una plataforma que también es canal (p. ej. Rappi) y el canal está en "Local", se cambia el canal:
   *  la comisión de Rappi está configurada en el CANAL, no en el medio de pago. */
  function pickMethod(i: number, methodId: string) {
    setPays((ps) => ps.map((x, j) => (j === i ? { ...x, methodId } : x)));
    const m = methods.find((x) => x.id === methodId); const ch = channels.find((c) => c.code === m?.code);
    if (ch && channel?.code === "LOCAL") setChannelId(ch.id);
  }
  function reset() { setLines([]); setPays([{ methodId: cash?.id ?? "", amount: "" }]); setReceived(""); setExternalRef(""); setChannelId(local?.id ?? ""); attempt.current = null; searchRef.current?.focus(); }

  function charge() {
    setError(null);
    const input = { lines: lines.map((l) => ({ productId: l.p.id, quantity: l.qty.replace(",", "."), ...(isAdmin && isManual(l) ? { manualUnitPrice: unitPrice(l) } : {}) })), channelId, payments: pays.map((p, i) => ({ methodId: p.methodId, amount: payAmounts[i] })),
      externalRef: channel?.code !== "LOCAL" && externalRef.trim() ? externalRef.trim() : backdated && tuuRef.trim() ? `TUU ${tuuRef.trim()}` : null,
      note: backdated ? "Venta atrasada (comprobante TUU)" : null, ...(backdated ? { saleDate } : {}) };
    const payload = JSON.stringify(input);
    // misma venta reintentada (p. ej. se cortó la red) => MISMA clave: el servidor devuelve la venta ya creada, nunca duplica
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, key: newKey() };
    const idempotencyKey = attempt.current.key;
    start(async () => {
      try {
        const r = await closeSaleAction({ ...input, idempotencyKey });
        if (r.ok) { reset(); setTuuRef(""); router.push(`/ventas/${r.id}?nueva=1`); return; }
        if (r.code === "CONFLICT") attempt.current = null;
        setError(r.error);
      } catch { setError("No hubo respuesta del servidor. Revisa la conexión y presiona Cobrar de nuevo: la venta no se duplicará."); }
    });
  }

  return (
    <div className="pos">
      <section className="pos-left">
        <div className="pos-search">
          <input ref={searchRef} type="search" value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) { seq.current++; setResults([]); setSearching(false); } }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onEnter(); } }}
            placeholder="Escanea el código o escribe el nombre…" aria-label="Buscar producto" autoComplete="off" />
          {searching && <span className="muted small">Buscando…</span>}
        </div>
        {results.length > 0 && (
          <ul className="pos-results" role="listbox">
            {results.map((r) => (
              <li key={r.id}><button type="button" onClick={() => add(r)} disabled={r.stock !== null && Number(r.stock) <= 0}>
                <span className="pr-name">{r.name}<span className="muted small"> · {r.sku}</span></span>
                <span className="pr-meta">{clp(r.salePrice)}<span className={`small ${r.stock !== null && Number(r.stock) <= 0 ? "out" : "muted"}`}>{r.stock === null ? "servicio" : `stock ${plainQty(r.stock)}`}</span></span>
              </button></li>
            ))}
          </ul>
        )}
        <div className="tablewrap pos-cart">
          {lines.length === 0 ? <p className="muted" style={{ padding: 16, margin: 0 }}>Agrega productos escaneando o buscando por nombre.</p> : (
            <table className="list">
              <thead><tr><th>Producto</th><th>Cant.</th><th className="num">Total</th><th></th></tr></thead>
              <tbody>{lines.map((l, i) => {
                const lt = lineTotal(l); const over = l.p.stock !== null && Number(l.qty.replace(",", ".")) > Number(l.p.stock);
                return (
                  <tr key={l.p.id}>
                    <td>{l.p.name}{isAdmin ? (<div className="inline small" style={{ marginTop: 4 }}>
                      <input className="money" value={l.price ?? String(l.p.salePrice)} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} inputMode="numeric" aria-label={`Precio de ${l.p.name}`} style={{ width: 100, padding: "4px 6px" }} />
                      <span className="muted">c/u</span>{isManual(l) && <span className="pill pill-warn" title={`Precio de catálogo: ${clp(l.p.salePrice)}`}>precio manual</span>}
                      {isManual(l) && <button type="button" className="link small" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, price: undefined } : x)))}>volver a {clp(l.p.salePrice)}</button>}
                    </div>) : <div className="muted small">{clp(l.p.salePrice)} c/u</div>}{over && <div className="out small">supera el stock ({plainQty(l.p.stock)})</div>}</td>
                    <td><div className="qtybox"><button type="button" onClick={() => bump(i, -1)} aria-label="Quitar uno">−</button>
                      <input value={l.qty} onChange={(e) => setQty(i, e.target.value)} inputMode="decimal" aria-label={`Cantidad de ${l.p.name}`} />
                      <button type="button" onClick={() => bump(i, 1)} aria-label="Agregar uno">+</button></div></td>
                    <td className="num">{Number.isFinite(lt) ? clp(lt) : <span className="out">cantidad inválida</span>}</td>
                    <td><button type="button" className="link" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Quitar</button></td>
                  </tr>);
              })}</tbody>
            </table>
          )}
        </div>
      </section>

      <aside className="pos-right">
        {isAdmin && (
          <div className={`pos-date ${backdated ? "is-past" : ""}`}>
            <label htmlFor="saledate">Fecha de la venta</label>
            <input id="saledate" type="date" value={saleDate} max={today} onChange={(e) => setSaleDate(e.target.value || today)} />
            {backdated && (<>
              <p className="small" style={{ margin: "6px 0" }}>⚠ Venta <b>atrasada</b>: queda con fecha {saleDate.split("-").reverse().join("-")} en reportes. El stock se descuenta hoy. <button type="button" className="link small" onClick={() => setSaleDate(today)}>Volver a hoy</button></p>
              {channel?.code === "LOCAL" && (<><label htmlFor="tuuref">N° comprobante TUU (opcional, evita duplicarlo)</label><input id="tuuref" value={tuuRef} onChange={(e) => setTuuRef(e.target.value)} placeholder="Ej.: 10234" /></>)}
            </>)}
          </div>
        )}
        <div className="pos-total"><span>Total</span><strong>{clp(total)}</strong></div>
        <label htmlFor="channel">Canal</label>
        <select id="channel" value={channelId} onChange={(e) => pickChannel(e.target.value)}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {channel && channel.code !== "LOCAL" && (<><label htmlFor="extref">N° de pedido ({channel.name})</label><input id="extref" value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="Opcional" /></>)}

        <label>Pago</label>
        {pays.map((p, i) => (
          <div key={i} className="payrow">
            <select value={p.methodId} onChange={(e) => pickMethod(i, e.target.value)} aria-label="Medio de pago">
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {i === pays.length - 1 ? <span className="payauto">{clp(Math.max(payAmounts[i] || 0, 0))}</span>
              : <input value={p.amount} onChange={(e) => setPays((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} inputMode="numeric" placeholder="Monto" aria-label="Monto" />}
            {pays.length > 1 && <button type="button" className="link" onClick={() => setPays((ps) => ps.filter((_, j) => j !== i))}>×</button>}
          </div>
        ))}
        {pays.length < 3 && <button type="button" className="link small" onClick={() => setPays((ps) => [{ methodId: methods.find((m) => m.code === "DEBIT")?.id ?? ps[0].methodId, amount: "" }, ...ps])}>+ Dividir pago entre dos medios</button>}
        {isCashOnly && (
          <div className="cashbox">
            <label htmlFor="received">Recibido en efectivo</label>
            <input id="received" value={received} onChange={(e) => setReceived(e.target.value)} inputMode="numeric" placeholder="Opcional, para calcular el vuelto" />
            {Number.isFinite(change) && <p className={change < 0 ? "out" : ""} style={{ margin: "6px 0 0" }}>{change < 0 ? `Faltan ${clp(-change)}` : <>Vuelto: <strong>{clp(change)}</strong></>}</p>}
          </div>
        )}
        <button className="btn btn-primary pos-charge" type="button" onClick={charge} disabled={pending || lines.length === 0 || invalidLine || !paysOk}>
          {pending ? "Cobrando…" : backdated ? `Registrar venta del ${saleDate.split("-").reverse().slice(0, 2).join("-")} · ${clp(total)}` : `Cobrar ${clp(total)}`}
        </button>
        {!paysOk && lines.length > 0 && !invalidLine && <p className="muted small">Los montos de pago deben sumar el total.</p>}
        {lines.length > 0 && <button type="button" className="link small" onClick={reset} disabled={pending}>Vaciar venta</button>}
        {error && <p className="error" role="alert">{error}</p>}
        {!isAdmin && <p className="muted small">Los precios los fija el administrador.</p>}
      </aside>
    </div>
  );
}
