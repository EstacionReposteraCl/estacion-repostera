"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enableWebSalesAction, disableWebSalesAction, syncWebSalesAction, resolveWebOrderAction, ignoreWebOrderAction } from "@/actions/web-orders.actions";
import { posSearchAction } from "@/actions/sales.actions";
import { PAY_OPTIONS } from "@/domain/web-orders/web-orders";

const peso = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

export function WebSalesActivate({ today }: { today: string }) {
  const router = useRouter(); const [since, setSince] = useState(today); const [pending, start] = useTransition(); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  return (
    <div className="formcard" style={{ maxWidth: 640 }}>
      <h2 className="sect" style={{ marginTop: 0 }}>Activar registro automático</h2>
      <p className="muted small">Desde la fecha que elijas, cada pedido <b>pagado</b> en tu tienda web se registra solo como venta (canal Página Web, con su N° de pedido, productos, envío y pago). Lo que no calce queda en “Por revisar”. Los pedidos anteriores a esa fecha no se tocan.</p>
      <div className="field"><label htmlFor="ws-since">Registrar pedidos pagados desde</label><input id="ws-since" type="date" value={since} max={today} onChange={(e) => setSince(e.target.value)} style={{ maxWidth: 200 }} /></div>
      <div className="actions"><button className="btn btn-primary" type="button" disabled={pending || !since} onClick={() => {
        setErr(null); setMsg(null);
        start(async () => { const r = await enableWebSalesAction(since); if (!r.ok) setErr(r.error); else { setMsg(r.hookOk ? "Listo: Jumpseller avisará al sistema apenas se pague cada pedido." : `Activado. ${r.hookError ?? ""} El sistema revisará los pedidos cada vez que abras el Inicio, Despacho o esta página.`); router.refresh(); } });
      }}>{pending ? "Activando…" : "Activar"}</button></div>
      {msg && <p className="ok" role="status">{msg}</p>}{err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

export function WebSalesControls({ canConfigure }: { canConfigure: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="actions" style={{ marginTop: 0 }}>
      <button className="btn btn-primary" type="button" disabled={pending} onClick={() => start(async () => {
        const r = await syncWebSalesAction(); setMsg(r.ok ? (r.done || r.pending ? `${r.done} venta(s) nueva(s) registrada(s)${r.pending ? ` · ${r.pending} por revisar` : ""}.` : "No hay pedidos pagados nuevos.") : r.error); router.refresh();
      })}>{pending ? "Revisando…" : "Revisar pedidos ahora"}</button>
      {canConfigure && <button className="btn" type="button" disabled={pending} onClick={() => { if (!confirm("¿Desactivar el registro automático de ventas web?")) return; start(async () => { await disableWebSalesAction(); router.refresh(); }); }}>Desactivar</button>}
      {msg && <span className="muted small" role="status">{msg}</span>}
    </div>
  );
}

type Line = { name: string; sku: string; qty: number; productId: string | null; productName: string | null };
function ProductPick({ value, label, onPick }: { value: string | null; label: string | null; onPick: (id: string, name: string) => void }) {
  const [q, setQ] = useState(""); const [rows, setRows] = useState<{ id: string; name: string; sku: string; salePrice: number }[]>([]); const [open, setOpen] = useState(!value); const seq = useRef(0);
  useEffect(() => {
    const t = q.trim(); if (t.length < 3) return; const my = ++seq.current;
    const h = setTimeout(async () => { const r = await posSearchAction(t); if (my === seq.current) setRows(r.ok ? r.rows.map((x) => ({ id: x.id, name: x.name, sku: x.sku, salePrice: x.salePrice })) : []); }, 250);
    return () => clearTimeout(h);
  }, [q]);
  if (value && !open) return <span>✓ <b>{label}</b> <button type="button" className="link small" onClick={() => setOpen(true)}>cambiar</button></span>;
  return (
    <div className="picker" style={{ margin: 0, maxWidth: 380 }}>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca el producto correcto (3 letras)" aria-label="Producto del sistema" />
      {q.trim().length >= 3 && rows.length > 0 && (
        <ul className="picker-list">{rows.map((r) => <li key={r.id} onMouseDown={(e) => { e.preventDefault(); onPick(r.id, r.name); setOpen(false); setQ(""); }}><span><b>{r.name}</b><small className="muted"> · {r.sku}</small></span><span className="muted">{peso(r.salePrice)}</span></li>)}</ul>
      )}
    </div>
  );
}

export function PendingWebOrder({ orderId, date, customer, total, payment, paymentName, reason, lines }: { orderId: number; date: string; customer: string; total: number; payment: string | null; paymentName: string; reason: string; lines: Line[] }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ id: string | null; name: string | null }[]>(lines.map((l) => ({ id: l.productId, name: l.productName })));
  const [pay, setPay] = useState<string>(payment && payment !== "ML" ? payment : "");
  const dup = /Posible duplicado/.test(reason); const [notDup, setNotDup] = useState(false);
  const ready = picked.every((p) => p.id) && !!pay && (!dup || notDup);
  return (
    <div className="formcard webpend">
      <div className="webpend-head"><div><b>Pedido #{orderId}</b> · {date}{customer ? ` · ${customer}` : ""}</div><b>{peso(total)}</b></div>
      <p className="error small" style={{ margin: "4px 0 8px" }}>{reason}</p>
      <table className="list mini"><tbody>{lines.map((l, i) => (
        <tr key={i}><td>{l.qty} × {l.name}<div className="muted small">{l.sku ? `SKU web ${l.sku}` : "sin SKU en la web"}</div></td>
          <td><ProductPick value={picked[i].id} label={picked[i].name} onPick={(id, name) => setPicked((p) => p.map((x, j) => (j === i ? { id, name } : x)))} /></td></tr>
      ))}</tbody></table>
      <div className="webpend-foot">
        <label className="small">Pagado con <span className="muted">(en la web: {paymentName || "sin dato"})</span>
          <select value={pay} onChange={(e) => setPay(e.target.value)}><option value="">Elige…</option>{PAY_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {dup && <label className="inline small"><input type="checkbox" checked={notDup} onChange={(e) => setNotDup(e.target.checked)} style={{ width: "auto" }} /> Revisé: no es la misma venta, registrarla igual</label>}
      </div>
      <div className="actions">
        <button className="btn btn-primary" type="button" disabled={pending || !ready} onClick={() => { setErr(null); start(async () => {
          const r = await resolveWebOrderAction(orderId, picked.map((p) => p.id), pay, notDup);
          if (!r.ok) setErr(r.error); else if (r.state !== "DONE") setErr(r.reason ?? "No se pudo registrar."); router.refresh();
        }); }}>{pending ? "Registrando…" : "Registrar venta"}</button>
        <button className="btn" type="button" disabled={pending} onClick={() => { const why = prompt("¿Por qué no se registra este pedido? (ej.: ya lo registré a mano, pedido de prueba)"); if (!why) return; start(async () => { const r = await ignoreWebOrderAction(orderId, why); if (!r.ok) setErr(r.error); router.refresh(); }); }}>No registrar</button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
