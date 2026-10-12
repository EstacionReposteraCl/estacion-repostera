"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { connectHaulmerAction, issueBoletaAction, annulBoletaAction } from "@/actions/dte.actions";

export function HaulmerConnectForm() {
  const router = useRouter(); const [pending, start] = useTransition();
  const [key, setKey] = useState(""); const [env, setEnv] = useState("prod"); const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  return (
    <div className="formcard" style={{ maxWidth: 640 }}>
      <h2 className="sect" style={{ marginTop: 0 }}>Conectar Haulmer (boleta electrónica)</h2>
      <ol className="small" style={{ paddingLeft: 18, marginTop: 0 }}>
        <li>En el Espacio de Trabajo de Haulmer entra a <b>Configuración → Desarrolladores → API → Emitir documentos desde otras aplicaciones</b>.</li>
        <li>Genera o copia la <b>API Key</b> y pégala aquí. Se guarda cifrada.</li>
      </ol>
      <div className="fields">
        <div className="field"><label htmlFor="of-key">API Key de Haulmer</label><input id="of-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="new-password" /></div>
        <div className="field"><label htmlFor="of-env">Ambiente</label><select id="of-env" value={env} onChange={(e) => setEnv(e.target.value)}><option value="prod">Producción (boletas reales ante el SII)</option><option value="dev">Pruebas (no llegan al SII)</option></select></div>
      </div>
      <div className="actions"><button className="btn btn-primary" type="button" disabled={pending || key.trim().length < 16} onClick={() => start(async () => {
        setMsg({}); const r = await connectHaulmerAction(key, env); if (r.ok) { setKey(""); setMsg({ ok: `Conectado: ${r.emisor}.` }); router.refresh(); } else setMsg({ err: r.error });
      })}>{pending ? "Comprobando…" : "Conectar"}</button></div>
      {msg.ok && <p className="ok" role="status">{msg.ok}</p>}{msg.err && <p className="error" role="alert">{msg.err}</p>}
    </div>
  );
}

/** Panel en el detalle de la venta: emitir la boleta electrónica (una vez), imprimirla y, si la venta se anula, anularla con nota de crédito. */
export function DteSalePanel({ saleId, configured, canConfigure, folio, card, voided, ncFolio = null, canVoid = false }: { saleId: string; configured: boolean; canConfigure: boolean; folio: number | null; card: boolean; voided: boolean; ncFolio?: number | null; canVoid?: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null); const [allowCard, setAllowCard] = useState(false);
  if (folio) return (
    <div className="formcard noprint" style={{ maxWidth: 520, margin: "16px auto 0" }}>
      {ncFolio ? <p style={{ margin: 0 }}>Boleta electrónica N° {folio} <b>anulada</b> con la <b>nota de crédito N° {ncFolio}</b>.</p>
        : voided ? <p className="error" style={{ margin: 0 }}>La venta está anulada, pero la <b>boleta N° {folio}</b> sigue vigente ante el SII.</p>
        : <p style={{ margin: 0 }}>✓ <b>Boleta electrónica N° {folio}</b> emitida. <span className="muted small">Si anulas la venta, el sistema también anula esta boleta (nota de crédito).</span></p>}
      <div className="actions">
        <Link className={ncFolio || voided ? "btn" : "btn btn-primary"} href={`/ventas/${saleId}/boleta`}>🖨 Boleta</Link>
        {ncFolio && <Link className="btn btn-primary" href={`/ventas/${saleId}/nota-credito`}>🖨 Nota de crédito</Link>}
        {voided && !ncFolio && canVoid && <button className="btn btn-primary" type="button" disabled={pending} onClick={() => {
          if (!confirm(`¿Emitir la nota de crédito que anula la boleta N° ${folio} ante el SII?`)) return;
          setErr(null); start(async () => { const r = await annulBoletaAction(saleId); if (r.ok) router.refresh(); else setErr(r.error); });
        }}>{pending ? "Anulando…" : "Anular boleta (nota de crédito)"}</button>}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
  if (voided) return null;
  if (!configured) return canConfigure ? <p className="muted small noprint" style={{ textAlign: "center" }}>Para emitir boletas desde aquí, <Link href="/boletas">conecta Haulmer</Link>.</p> : null;
  return (
    <div className="formcard noprint" style={{ maxWidth: 520, margin: "16px auto 0" }}>
      <h2 className="sect" style={{ marginTop: 0 }}>Boleta electrónica</h2>
      {card ? <label className="inline small" style={{ fontWeight: 400 }}><input type="checkbox" checked={allowCard} onChange={(e) => setAllowCard(e.target.checked)} style={{ width: "auto" }} /> Se pagó con tarjeta: la máquina TUU ya emite boleta. Emitir igual (solo si TUU no la emitió).</label>
        : <p className="muted small" style={{ marginTop: 0 }}>Para ventas de Rappi, transferencias, efectivo u otras que no pasaron por la máquina TUU.</p>}
      <div className="actions"><button className="btn btn-primary" type="button" disabled={pending || (card && !allowCard)} onClick={() => {
        if (!confirm("¿Emitir la boleta electrónica de esta venta ante el SII? No se puede deshacer.")) return;
        setErr(null); start(async () => { const r = await issueBoletaAction(saleId, allowCard); if (r.ok) router.push(`/ventas/${saleId}/boleta`); else setErr(r.error); });
      }}>{pending ? "Emitiendo…" : "Emitir boleta electrónica"}</button></div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
