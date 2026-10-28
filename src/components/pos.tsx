"use client";
import { parseDiscount, spreadDiscount } from "@/domain/pricing/discount";
// Caja. El navegador NUNCA decide precios: solo muestra un total calculado con las MISMAS funciones puras que usa el
// servidor (src/core/money). El servidor recalcula todo y rechaza si los pagos no cuadran.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeSaleAction, posSearchAction } from "@/actions/sales.actions";
import { issueBoletaAction } from "@/actions/dte.actions";
import { tuuStartAction, tuuCheckAction } from "@/actions/tuu.actions";
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
const MAIN_PAY = ["CASH", "DEBIT", "CREDIT", "TRANSFER"];
const PAY_ICON: Record<string, string> = { CASH: "💵", DEBIT: "💳", CREDIT: "💳", TRANSFER: "🏦" };
const CH_ICON: Record<string, string> = { LOCAL: "🏪", UBER: "🛵", UBER_EATS: "🛵", RAPPI: "🛵", MERCADO_LIBRE: "🛒", WHATSAPP: "💬", INSTAGRAM: "📷" };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function Pos({ channels, methods, isAdmin, today, autoBoleta = false, tuu = false }: { channels: Opt[]; methods: Opt[]; isAdmin: boolean; today: string; autoBoleta?: boolean; tuu?: boolean }) {
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
  const [doc, setDoc] = useState<"boleta" | "factura" | "sin">("boleta");          // factura: al cobrar se abre el formulario de factura de la venta
  const backdated = isAdmin && saleDate && saleDate !== today;
  const [error, setError] = useState<string | null>(null); const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null); const seq = useRef(0);
  const attempt = useRef<{ payload: string; key: string } | null>(null);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + (Number.isFinite(lineTotal(l)) ? lineTotal(l) : 0), 0), [lines]);
  const invalidLine = lines.some((l) => !Number.isFinite(lineTotal(l)) || lineTotal(l) <= 0);
  // Descuento a toda la venta (solo administrador): se reparte bajando el precio de cada línea; la boleta suma exacto.
  const [discount, setDiscount] = useState(""); const [showDisc, setShowDisc] = useState(false); const [showDate, setShowDate] = useState(false);
  const disc = useMemo(() => {
    if (!isAdmin || !discount.trim() || invalidLine || lines.length === 0) return null;
    const amount = parseDiscount(discount, subtotal);
    if (amount === null) return { error: "Descuento inválido (escribe un % o un monto menor al total)." } as const;
    if (amount === 0) return null;
    const qtys = lines.map((l) => Number(l.qty.replace(",", ".")));
    const r = spreadDiscount(lines.map((l, i) => ({ qty: qtys[i], unitPrice: unitPrice(l) })), amount);
    if (!r) return { error: "El descuento solo se puede aplicar con cantidades enteras." } as const;
    return { prices: r.prices, applied: r.applied, asked: amount } as const;
  }, [isAdmin, discount, invalidLine, lines, subtotal]);
  const discOk = !disc || !("error" in disc);
  const total = disc && !("error" in disc) ? subtotal - disc.applied : subtotal;
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
  // Lector de código de barras: si lo escrito es un código (8 a 14 dígitos) y calza exacto con UN producto, se agrega solo (aunque el lector no mande Enter).
  const isCode = (t: string) => /^\d{8,14}$/.test(t);
  const exactByCode = (rows: ProductPublicDTO[], t: string) => { const m = rows.filter((r) => (r.barcodes ?? []).includes(t) || r.sku.toLowerCase() === t.toLowerCase()); return m.length === 1 ? m[0] : null; };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const t = q.trim(); if (t.length < 2) return;
    timer.current = setTimeout(async () => {
      const rows = await runSearch(t);
      if (rows && isCode(t)) { const hit = exactByCode(rows, t); if (hit) add(hit); }
    }, isCode(q.trim()) ? 120 : 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
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
    if (timer.current) clearTimeout(timer.current);                 // el Enter del lector manda: no esperar la búsqueda automática
    const my = ++seq.current; setSearching(true);
    const r = await posSearchAction(t);
    if (my !== seq.current) return;                                 // ya se agregó (la búsqueda automática ganó) o se escribió otra cosa
    setSearching(false); const rows = r.rows; setResults(rows); if (!r.ok) { setError(r.error); return; }
    const exact = exactByCode(rows, t);
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
  function reset() { setDiscount(""); setShowDisc(false); setLines([]); setPays([{ methodId: cash?.id ?? "", amount: "" }]); setReceived(""); setExternalRef(""); setChannelId(local?.id ?? ""); attempt.current = null; searchRef.current?.focus(); }

  // Cobro con la máquina TUU desde el sistema: se envía el monto de tarjeta, se espera el pago y recién ahí se registra la venta.
  const [tuuWait, setTuuWait] = useState<{ amount: number; msg: string } | null>(null);
  const tuuPaid = useRef<{ amount: number; key: string } | null>(null); const tuuStop = useRef(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);   // la tarjeta ya se pasó en la máquina (sin enviar el monto desde aquí)
  const tuuPending = useRef<{ amount: number; key: string } | null>(null);   // cobro enviado cuyo resultado no alcanzamos a ver: al reintentar se revisa ese mismo, no se cobra de nuevo
  const cardIdx = pays.map((p, i) => ({ i, code: methods.find((m) => m.id === p.methodId)?.code })).filter((x) => x.code === "DEBIT" || x.code === "CREDIT");
  async function payWithTuu(amount: number, method: "DEBIT" | "CREDIT"): Promise<boolean> {
    if (tuuPaid.current) { if (tuuPaid.current.amount === amount) return true; setError(`Ya se cobró ${clp(tuuPaid.current.amount)} con tarjeta en la máquina. Deja el monto de tarjeta en ${clp(tuuPaid.current.amount)} o anula ese pago en la máquina.`); return false; }
    tuuStop.current = false; let key: string;
    const prev = tuuPending.current && tuuPending.current.amount === amount ? tuuPending.current : null;
    const prevSt = prev ? await tuuCheckAction(prev.key).catch(() => null) : null;
    if (prev && prevSt?.ok && ["pending", "sent", "processing", "completed"].includes(prevSt.status)) key = prev.key;
    else {
      key = `er-${newKey().replace(/[^a-z0-9]/gi, "").slice(0, 30)}`; tuuPending.current = { amount, key };
      setTuuWait({ amount, msg: "Enviando el cobro a la máquina…" });
      const s = await tuuStartAction(amount, method, key).catch(() => ({ ok: false as const, error: "No hubo respuesta del servidor." }));
      if (!s.ok) { tuuPending.current = null; setTuuWait(null); setError(`No se pudo enviar el cobro a la máquina TUU: ${s.error}`); return false; }
    }
    setTuuWait({ amount, msg: "Pasa la tarjeta en la máquina TUU…" });
    const until = Date.now() + 4 * 60_000;
    while (Date.now() < until && !tuuStop.current) {
      await new Promise((r) => setTimeout(r, 2500));
      const c = await tuuCheckAction(key).catch(() => null); if (!c || !c.ok) continue;
      if (c.status === "completed") { tuuPaid.current = { amount, key }; tuuPending.current = null; setTuuWait(null); return true; }
      if (c.status === "failed" || c.status === "canceled") { tuuPending.current = null; setTuuWait(null); setError(`El pago con tarjeta no se completó (${c.status === "failed" ? "rechazado o con error" : "cancelado"}). No se registró la venta.`); return false; }
      if (c.status === "processing") setTuuWait({ amount, msg: "Procesando el pago…" });
    }
    setTuuWait(null);
    setError(tuuStop.current ? "Dejaste de esperar el pago. Si en la máquina sale APROBADO, presiona Cobrar de nuevo con el mismo monto." : "La máquina no respondió a tiempo. Revisa la máquina: si el pago salió aprobado, presiona Cobrar de nuevo.");
    return false;
  }

  function charge() {
    setError(null);
    if (tuu && !backdated && cardIdx.length > 1) { setError("Con la máquina TUU solo se puede cobrar una parte con tarjeta."); return; }
    const card = tuu && !backdated && !alreadyPaid && cardIdx.length === 1 ? { amount: payAmounts[cardIdx[0].i], method: cardIdx[0].code as "DEBIT" | "CREDIT" } : null;
    const d = disc && !("error" in disc) ? disc : null;
    const input = { lines: lines.map((l, i) => ({ productId: l.p.id, quantity: l.qty.replace(",", "."), ...(d ? { manualUnitPrice: d.prices[i] } : isAdmin && isManual(l) ? { manualUnitPrice: unitPrice(l) } : {}) })), channelId, payments: pays.map((p, i) => ({ methodId: p.methodId, amount: payAmounts[i] })),
      externalRef: channel?.code !== "LOCAL" && externalRef.trim() ? externalRef.trim() : backdated && tuuRef.trim() ? `TUU ${tuuRef.trim()}` : null,
      note: [backdated ? "Venta atrasada (comprobante TUU)" : "", d ? `Descuento ${discount.trim().endsWith("%") ? discount.trim() + " " : ""}${clp(d.applied)} sobre ${clp(subtotal)}` : ""].filter(Boolean).join(" · ") || null, ...(backdated ? { saleDate } : {}) };
    const payload = JSON.stringify(input);
    // misma venta reintentada (p. ej. se cortó la red) => MISMA clave: el servidor devuelve la venta ya creada, nunca duplica
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, key: newKey() };
    const idempotencyKey = attempt.current.key;
    start(async () => {
      try {
        if (card && !(await payWithTuu(card.amount, card.method))) return;
        const r = await closeSaleAction({ ...input, idempotencyKey, ...(card ? { note: [input.note, "Tarjeta cobrada desde el sistema (TUU)"].filter(Boolean).join(" · ") } : {}) });
        if (r.ok) {
          const f = doc === "factura"; const emit = autoBoleta && doc === "boleta" && !backdated;
          reset(); setTuuRef(""); setDoc("boleta"); setAlreadyPaid(false); tuuPaid.current = null; tuuPending.current = null;
          if (emit) {   // boleta desde el sistema: se emite al tiro y se abre para imprimir (la máquina TUU solo cobra)
            const b = await issueBoletaAction(String(r.id), true).catch(() => ({ ok: false as const, error: "No hubo respuesta de Haulmer." }));
            if (b.ok) { router.push(`/ventas/${r.id}/boleta?print=1`); return; }
            router.push(`/ventas/${r.id}?nueva=1&dteError=${encodeURIComponent(b.error ?? "error desconocido")}`); return;
          }
          router.push(`/ventas/${r.id}?nueva=1${f ? "&factura=1" : ""}`); return;
        }
        if (r.code === "CONFLICT") attempt.current = null;
        setError(card ? `${r.error} (El pago con tarjeta ya está cobrado: corrige y presiona Cobrar de nuevo, no se vuelve a cobrar.)` : r.error);
      } catch { setError("No hubo respuesta del servidor. Revisa la conexión y presiona Cobrar de nuevo: la venta no se duplicará."); }
    });
  }

  return (
    <div className="pos">
      {tuuWait && (
        <div className="tuu-wait" role="dialog" aria-live="polite">
          <div className="tuu-box">
            <div className="tuu-amount">{clp(tuuWait.amount)}</div>
            <p><span className="spinner" aria-hidden="true" /> {tuuWait.msg}</p>
            <button type="button" className="btn btn-small" onClick={() => { tuuStop.current = true; }}>Dejar de esperar</button>
            <p className="muted small" style={{ marginBottom: 0 }}>Para anular el cobro, cancélalo en la máquina.</p>
          </div>
        </div>
      )}
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
        <div className="pos-total"><span>Total</span><strong>{clp(total)}</strong></div>

        <div className="pos-sec">Canal</div>
        <div className="chips chips-ch" role="radiogroup" aria-label="Canal">
          {channels.filter((c) => c.code !== "PAGINA_WEB").map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={channelId === c.id} className={`chip${channelId === c.id ? " on" : ""}`} onClick={() => pickChannel(c.id)}>
              <span className="chip-ic" aria-hidden="true">{CH_ICON[c.code] ?? "🛍️"}</span>{c.name}
            </button>
          ))}
        </div>
        {channel && channel.code !== "LOCAL" && (<><label htmlFor="extref">N° de pedido ({channel.name})</label><input id="extref" value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="Opcional" /></>)}

        <div className="pos-sec">Pago</div>
        {pays.length === 1 ? (() => {
          const main = MAIN_PAY.map((code) => methods.find((m) => m.code === code)).filter((m): m is Opt => !!m);
          const rest = methods.filter((m) => !MAIN_PAY.includes(m.code)); const restOn = rest.some((m) => m.id === pays[0].methodId);
          return (<>
            <div className="chips chips-pay" role="radiogroup" aria-label="Medio de pago">
              {main.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={pays[0].methodId === m.id} className={`chip chip-big${pays[0].methodId === m.id ? " on" : ""}`} onClick={() => pickMethod(0, m.id)}>
                  <span className="chip-ic" aria-hidden="true">{PAY_ICON[m.code] ?? "💳"}</span>{m.name}
                </button>
              ))}
            </div>
            {rest.length > 0 && (
              <select className={`more-pay${restOn ? " on" : ""}`} value={restOn ? pays[0].methodId : ""} onChange={(e) => e.target.value && pickMethod(0, e.target.value)} aria-label="Otros medios de pago">
                <option value="">Más medios de pago ▾</option>{rest.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
          </>);
        })() : pays.map((p, i) => (
          <div key={i} className="payrow">
            <select value={p.methodId} onChange={(e) => pickMethod(i, e.target.value)} aria-label="Medio de pago">
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {i === pays.length - 1 ? <span className="payauto">{clp(Math.max(payAmounts[i] || 0, 0))}</span>
              : <input value={p.amount} onChange={(e) => setPays((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} inputMode="numeric" placeholder="Monto" aria-label="Monto" />}
            <button type="button" className="link" onClick={() => setPays((ps) => ps.filter((_, j) => j !== i))} aria-label="Quitar medio">×</button>
          </div>
        ))}
        {isCashOnly && (
          <div className="cashbox">
            <div className="quick-cash">
              <span className="small muted">Recibido:</span>
              {[total, 5000, 10000, 20000].map((v, k) => (
                <button key={k} type="button" className={`chip chip-sm${toInt(received) === v && received ? " on" : ""}`} disabled={v < total || total <= 0} onClick={() => setReceived(String(v))}>{k === 0 ? "Justo" : clp(v)}</button>
              ))}
              <input id="received" value={received} onChange={(e) => setReceived(e.target.value)} inputMode="numeric" placeholder="Otro" aria-label="Recibido en efectivo" />
            </div>
            {Number.isFinite(change) && <p className={`vuelto${change < 0 ? " out" : ""}`}>{change < 0 ? `Faltan ${clp(-change)}` : <>Vuelto <strong>{clp(change)}</strong></>}</p>}
          </div>
        )}
        {tuu && !backdated && cardIdx.length > 0 && <label className="inline small" style={{ fontWeight: 400, margin: "6px 0" }}><input type="checkbox" checked={alreadyPaid} onChange={(e) => setAlreadyPaid(e.target.checked)} style={{ width: "auto" }} /> Ya la cobré en la máquina TUU (no enviar el monto)</label>}

        <div className="pos-sec">Documento</div>
        <div className={`chips chips-doc${autoBoleta ? " three" : ""}`} role="radiogroup" aria-label="Documento">
          <button type="button" role="radio" aria-checked={doc === "boleta"} className={`chip${doc === "boleta" ? " on" : ""}`} onClick={() => setDoc("boleta")}><span className="chip-ic" aria-hidden="true">🧾</span>Boleta</button>
          <button type="button" role="radio" aria-checked={doc === "factura"} className={`chip${doc === "factura" ? " on" : ""}`} onClick={() => setDoc("factura")}><span className="chip-ic" aria-hidden="true">📄</span>Factura</button>
          {autoBoleta && <button type="button" role="radio" aria-checked={doc === "sin"} className={`chip${doc === "sin" ? " on" : ""}`} onClick={() => setDoc("sin")} title="Por ejemplo, si la plataforma ya emite el documento"><span className="chip-ic" aria-hidden="true">⊘</span>Sin boleta</button>}
        </div>
        {autoBoleta && doc === "boleta" && backdated && <p className="muted small" style={{ margin: "4px 0 0" }}>Venta atrasada: la boleta no se emite sola (emítela desde la venta si corresponde).</p>}
        {doc === "factura" && <p className="muted small" style={{ margin: "4px 0 0" }}>Al cobrar te pedirá el RUT del cliente para emitir la factura.</p>}

        <button className="btn btn-primary pos-charge" type="button" onClick={charge} disabled={pending || lines.length === 0 || invalidLine || !paysOk || !discOk}>
          {pending ? "Cobrando…" : backdated ? `Registrar venta del ${saleDate.split("-").reverse().slice(0, 2).join("-")} · ${clp(total)}` : `Cobrar ${clp(total)}`}
        </button>
        {!paysOk && lines.length > 0 && !invalidLine && <p className="muted small">Los montos de pago deben sumar el total.</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <div className="pos-extras">
          {pays.length < 3 && <button type="button" className="link small" onClick={() => setPays((ps) => [{ methodId: methods.find((m) => m.code === "DEBIT")?.id ?? ps[0].methodId, amount: "" }, ...ps])}>＋ Dividir pago</button>}
          {isAdmin && lines.length > 0 && !showDisc && !discount && <button type="button" className="link small" onClick={() => setShowDisc(true)}>＋ Descuento</button>}
          {isAdmin && !showDate && !backdated && <button type="button" className="link small" onClick={() => setShowDate(true)}>📅 Venta atrasada</button>}
          {lines.length > 0 && <button type="button" className="link small" onClick={reset} disabled={pending}>Vaciar venta</button>}
        </div>
        {isAdmin && lines.length > 0 && (showDisc || discount) && (
          <div className="pos-discount">
            <label htmlFor="discount">Descuento</label>
            <input id="discount" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="Ej.: 20% o 1.500" autoComplete="off" />
            {disc && "error" in disc && <p className="out small" style={{ margin: "4px 0 0" }}>{disc.error}</p>}
            {disc && !("error" in disc) && <p className="small" style={{ margin: "4px 0 0" }}>Subtotal {clp(subtotal)} − descuento <b>{clp(disc.applied)}</b>{disc.applied !== disc.asked ? ` (ajustado por redondeo)` : ""}. La boleta muestra los precios ya rebajados.</p>}
          </div>
        )}
        {isAdmin && (showDate || backdated) && (
          <div className={`pos-date ${backdated ? "is-past" : ""}`}>
            <label htmlFor="saledate">Fecha de la venta</label>
            <input id="saledate" type="date" value={saleDate} max={today} onChange={(e) => setSaleDate(e.target.value || today)} />
            {backdated ? (<>
              <p className="small" style={{ margin: "6px 0" }}>⚠ Venta <b>atrasada</b>: queda con fecha {saleDate.split("-").reverse().join("-")} en reportes. El stock se descuenta hoy. <button type="button" className="link small" onClick={() => { setSaleDate(today); setShowDate(false); }}>Volver a hoy</button></p>
              {channel?.code === "LOCAL" && (<><label htmlFor="tuuref">N° comprobante TUU (opcional, evita duplicarlo)</label><input id="tuuref" value={tuuRef} onChange={(e) => setTuuRef(e.target.value)} placeholder="Ej.: 10234" /></>)}
            </>) : <button type="button" className="link small" onClick={() => setShowDate(false)}>Cerrar</button>}
          </div>
        )}
        {!isAdmin && <p className="muted small">Los precios los fija el administrador.</p>}
      </aside>
    </div>
  );
}
