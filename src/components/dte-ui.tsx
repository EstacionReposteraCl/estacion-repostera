"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setAutoBoletaAction, attachIssuedAction, connectHaulmerAction, issueBoletaAction, annulBoletaAction, markBoletaAnnulledAction, lookupCustomerAction, issueFacturaAction } from "@/actions/dte.actions";

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
export function DteSalePanel({ saleId, configured, canConfigure, folio, card, voided, ncFolio = null, ncManual = false, canVoid = false, tipo = 39, openFactura = false, share = null, origin = null, saleDate = "" }: { origin?: "web" | "haulmer" | null; saleDate?: string; share?: { ref: string; email: string | null } | null; saleId: string; configured: boolean; canConfigure: boolean; folio: number | null; card: boolean; voided: boolean; ncFolio?: number | null; ncManual?: boolean; canVoid?: boolean; tipo?: number | null; openFactura?: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null); const [allowCard, setAllowCard] = useState(false);
  const [mode, setMode] = useState<"boleta" | "factura">(openFactura ? "factura" : "boleta");
  const doc = tipo === 33 ? "Factura electrónica" : tipo === 34 ? "Factura exenta electrónica" : "Boleta electrónica"; const docShort = tipo === 39 || !tipo ? "boleta" : "factura";
  if (folio) return (
    <div className="formcard noprint" style={{ maxWidth: 520, margin: "16px auto 0" }}>
      {ncFolio !== null ? <p style={{ margin: 0 }}>{doc} N° {folio} <b>anulada</b>{ncFolio ? <> con la <b>nota de crédito N° {ncFolio}</b></> : null}{ncManual ? " (anulada directamente en Haulmer)" : ""}.</p>
        : voided ? <p className="error" style={{ margin: 0 }}>La venta está anulada, pero la <b>{docShort} N° {folio}</b> sigue vigente ante el SII.</p>
        : <p style={{ margin: 0 }}>✓ <b>{doc} N° {folio}</b> {origin === "web" ? "emitida por la página web" : origin === "haulmer" ? "emitida en Haulmer" : "emitida"}. <span className="muted small">Si anulas la venta, el sistema también anula esta {docShort} (nota de crédito).</span></p>}
      <div className="actions">
        <Link className={ncFolio !== null || voided ? "btn" : "btn btn-primary"} href={`/ventas/${saleId}/boleta`}>🖨 {docShort === "boleta" ? "Boleta" : "Factura"}</Link>
        {ncFolio !== null && !ncManual && <Link className="btn btn-primary" href={`/ventas/${saleId}/nota-credito`}>🖨 Nota de crédito</Link>}
        {voided && ncFolio === null && canVoid && <button className="btn btn-primary" type="button" disabled={pending} onClick={() => {
          if (!confirm(`¿Emitir la nota de crédito que anula la ${docShort} N° ${folio} ante el SII?`)) return;
          setErr(null); start(async () => { const r = await annulBoletaAction(saleId); if (r.ok) router.refresh(); else setErr(r.error); });
        }}>{pending ? "Anulando…" : `Anular ${docShort} (nota de crédito)`}</button>}
        {voided && ncFolio === null && canVoid && <button className="btn" type="button" disabled={pending} onClick={() => {
          const f = prompt(`¿Ya anulaste la ${docShort} N° ${folio} directamente en Haulmer? Escribe el N° de la nota de crédito (o déjalo vacío si no lo tienes):`, "");
          if (f === null) return;
          setErr(null); start(async () => { const r = await markBoletaAnnulledAction(saleId, f); if (r.ok) router.refresh(); else setErr(r.error); });
        }}>Ya la anulé en Haulmer</button>}
      </div>
      {share && ncFolio === null && !voided && <ShareDoc refId={share.ref} email={share.email} doc={doc} folio={folio} />}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
  if (voided) return null;
  if (!configured) return canConfigure ? <p className="muted small noprint" style={{ textAlign: "center" }}>Para emitir boletas desde aquí, <Link href="/boletas">conecta Haulmer</Link>.</p> : null;
  return (
    <div className="formcard noprint" style={{ maxWidth: 560, margin: "16px auto 0" }}>
      <div className="doc-toggle" role="radiogroup" aria-label="Documento" style={{ marginTop: 0, marginBottom: 12 }}>
        <button type="button" role="radio" aria-checked={mode === "boleta"} className={mode === "boleta" ? "on" : ""} onClick={() => setMode("boleta")}>Boleta electrónica</button>
        <button type="button" role="radio" aria-checked={mode === "factura"} className={mode === "factura" ? "on" : ""} onClick={() => setMode("factura")}>Factura electrónica</button>
      </div>
      {mode === "factura" ? <FacturaForm saleId={saleId} card={card} /> : (<>
        <AttachIssued saleId={saleId} saleDate={saleDate} />
        {card ? <label className="inline small" style={{ fontWeight: 400 }}><input type="checkbox" checked={allowCard} onChange={(e) => setAllowCard(e.target.checked)} style={{ width: "auto" }} /> Se pagó con tarjeta: la máquina TUU ya emite boleta. Emitir igual (solo si TUU no la emitió).</label>
          : <p className="muted small" style={{ marginTop: 0 }}>Para ventas de Rappi, transferencias, efectivo u otras que no pasaron por la máquina TUU.</p>}
        <div className="actions"><button className="btn btn-primary" type="button" disabled={pending || (card && !allowCard)} onClick={() => {
          if (!confirm("¿Emitir la boleta electrónica de esta venta ante el SII? No se puede deshacer.")) return;
          setErr(null); start(async () => { const r = await issueBoletaAction(saleId, allowCard); if (r.ok) router.push(`/ventas/${saleId}/boleta`); else setErr(r.error); });
        }}>{pending ? "Emitiendo…" : "Emitir boleta electrónica"}</button></div>
        {err && <p className="error" role="alert">{err}</p>}
      </>)}
    </div>
  );
}

type Rec = { rut: string; razonSocial: string; giro: string; direccion: string; comuna: string; email: string };
/** Factura: RUT del cliente → datos desde el SII (o los guardados), editables; contado o crédito. */
function FacturaForm({ saleId, card }: { saleId: string; card: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const [r, setR] = useState<Rec>({ rut: "", razonSocial: "", giro: "", direccion: "", comuna: "", email: "" }); const [fma, setFma] = useState("1"); const [allowCard, setAllowCard] = useState(false);
  const set = (k: keyof Rec, v: string) => setR((x) => ({ ...x, [k]: v }));
  const lookup = () => { setErr(null); setInfo(null); start(async () => {
    const x = await lookupCustomerAction(r.rut);
    if (!x.ok) { setErr(x.error); return; }
    if (!x.found || !x.receptor) { setInfo("No encontré ese RUT en el SII: completa los datos a mano."); return; }
    const rc = x.receptor; setR({ rut: rc.rut, razonSocial: rc.razonSocial, giro: rc.giro, direccion: rc.direccion, comuna: rc.comuna, email: rc.email ?? "" });
    setInfo(x.source === "saved" ? "Cliente guardado: revisa que los datos sigan vigentes." : "Datos traídos del SII: revísalos.");
  }); };
  const ready = r.rut.trim() && r.razonSocial.trim() && r.giro.trim() && r.direccion.trim() && r.comuna.trim() && (!card || allowCard);
  return (<>
    <div className="fac-grid">
      <div className="field full"><label htmlFor="f-rut">RUT del cliente</label>
        <div style={{ display: "flex", gap: 8 }}><input id="f-rut" value={r.rut} onChange={(e) => set("rut", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup(); } }} placeholder="76.086.428-5" style={{ maxWidth: 200 }} autoFocus />
          <button type="button" className="btn" disabled={pending || r.rut.trim().length < 8} onClick={lookup}>{pending ? "Buscando…" : "Buscar datos"}</button></div></div>
      <div className="field full"><label htmlFor="f-rs">Razón social</label><input id="f-rs" value={r.razonSocial} onChange={(e) => set("razonSocial", e.target.value)} /></div>
      <div className="field full"><label htmlFor="f-giro">Giro</label><input id="f-giro" value={r.giro} onChange={(e) => set("giro", e.target.value)} /></div>
      <div className="field"><label htmlFor="f-dir">Dirección</label><input id="f-dir" value={r.direccion} onChange={(e) => set("direccion", e.target.value)} /></div>
      <div className="field"><label htmlFor="f-com">Comuna</label><input id="f-com" value={r.comuna} onChange={(e) => set("comuna", e.target.value)} /></div>
      <div className="field"><label htmlFor="f-mail">Correo (opcional)</label><input id="f-mail" type="email" value={r.email} onChange={(e) => set("email", e.target.value)} /></div>
      <div className="field"><label htmlFor="f-fma">Forma de pago</label><select id="f-fma" value={fma} onChange={(e) => setFma(e.target.value)}><option value="1">Contado</option><option value="2">Crédito</option></select></div>
    </div>
    {info && <p className="muted small">{info}</p>}
    {card && <label className="inline small" style={{ fontWeight: 400 }}><input type="checkbox" checked={allowCard} onChange={(e) => setAllowCard(e.target.checked)} style={{ width: "auto" }} /> Se pagó con tarjeta: la máquina TUU ya emitió una boleta; la anularé en Haulmer.</label>}
    <div className="actions"><button className="btn btn-primary" type="button" disabled={pending || !ready} onClick={() => {
      if (!confirm(`¿Emitir la factura electrónica a ${r.razonSocial} ante el SII? No se puede deshacer.`)) return;
      setErr(null); start(async () => { const x = await issueFacturaAction(saleId, r, Number(fma), allowCard); if (x.ok) router.push(`/ventas/${saleId}/boleta`); else setErr(x.error); });
    }}>{pending ? "Emitiendo…" : "Emitir factura electrónica"}</button></div>
    {err && <p className="error" role="alert">{err}</p>}
  </>);
}

/** Compartir el PDF de la boleta/factura electrónica por WhatsApp o correo (enlace firmado, abre el PDF de Haulmer). */
function ShareDoc({ refId, email, doc, folio }: { refId: string; email: string | null; doc: string; folio: number }) {
  const [phone, setPhone] = useState(""); const [mail, setMail] = useState(email ?? ""); const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}/c/${refId}`;
  const text = () => `¡Hola! Te enviamos tu ${doc.toLowerCase()} N° ${folio} de Estación Repostera: ${url()}\n¡Gracias por tu compra!`;
  const waNumber = () => { const d = phone.replace(/\D/g, ""); return !d ? "" : d.length === 9 ? `56${d}` : d.length === 8 ? `569${d}` : d; };
  return (
    <div className="share-doc">
      <div className="small" style={{ fontWeight: 700, margin: "12px 0 6px" }}>Enviar al cliente</div>
      <div className="share-row">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Celular (opcional), ej. 9 1234 5678" aria-label="Celular del cliente" />
        <button type="button" className="btn btn-small" onClick={() => window.open(`https://wa.me/${waNumber()}?text=${encodeURIComponent(text())}`, "_blank", "noopener")}>WhatsApp</button>
      </div>
      <div className="share-row">
        <input value={mail} onChange={(e) => setMail(e.target.value)} inputMode="email" placeholder="Correo (opcional)" aria-label="Correo del cliente" />
        <button type="button" className="btn btn-small" onClick={() => { window.location.href = `mailto:${encodeURIComponent(mail.trim())}?subject=${encodeURIComponent(`${doc} N° ${folio} - Estación Repostera`)}&body=${encodeURIComponent(text())}`; }}>Correo</button>
      </div>
      <button type="button" className="link small" onClick={async () => { try { await navigator.clipboard.writeText(url()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { prompt("Copia el enlace:", url()); } }}>{copied ? "✓ Enlace copiado" : "Copiar enlace del PDF"}</button>
      {" · "}<a className="small" href={`/c/${refId}`} target="_blank" rel="noopener">Ver PDF</a>
    </div>
  );
}

/** Traer una boleta que ya se emitió fuera del sistema (Espacio de Trabajo de Haulmer, página web) para imprimirla y compartirla desde aquí. */
function AttachIssued({ saleId, saleDate }: { saleId: string; saleDate: string }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [open, setOpen] = useState(false);
  const [folio, setFolio] = useState(""); const [fecha, setFecha] = useState(saleDate); const [err, setErr] = useState<string | null>(null);
  if (!open) return <p className="small" style={{ marginTop: 0 }}><button type="button" className="link small" onClick={() => setOpen(true)}>¿Ya la emitiste en Haulmer o en la página web? Tráela aquí</button></p>;
  return (
    <div className="tile" style={{ marginBottom: 12 }}>
      <p className="small" style={{ marginTop: 0 }}>Escribe el N° de la boleta y su fecha. El sistema la trae de Haulmer (con su timbre) para imprimirla en tu formato y compartirla. El total debe ser igual al de esta venta.</p>
      <div className="share-row">
        <input value={folio} onChange={(e) => setFolio(e.target.value)} inputMode="numeric" placeholder="N° de boleta, ej. 15294" aria-label="N° de boleta" />
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha de la boleta" style={{ width: "auto" }} />
        <button type="button" className="btn btn-small" disabled={pending || !folio.trim()} onClick={() => { setErr(null); start(async () => { const r = await attachIssuedAction(saleId, folio, fecha); if (r.ok) router.refresh(); else setErr(r.error); }); }}>{pending ? "Buscando…" : "Traer"}</button>
      </div>
      {err && <p className="error small" role="alert">{err}</p>}
    </div>
  );
}

/** Modo "boleta desde el sistema": al cobrar en la Caja se emite la boleta aquí; la máquina TUU solo cobra. */
export function AutoBoletaToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  return (
    <div className="formcard" style={{ maxWidth: 640, marginBottom: 16 }}>
      <h2 className="sect" style={{ marginTop: 0 }}>Boleta al cobrar</h2>
      <p style={{ marginTop: 0 }}>{enabled ? <>✓ <b>Activado:</b> al cobrar en la Caja se emite la boleta electrónica desde el sistema y se abre para imprimir. <b>La máquina TUU solo cobra</b> (configúrala para que no emita boleta).</> : <>Desactivado: la boleta la emite la máquina TUU (tarjetas) o se emite a mano desde cada venta.</>}</p>
      <ul className="small muted" style={{ paddingLeft: 18 }}>
        <li>Vale para todos los medios de pago (efectivo, débito, crédito, transferencia…).</li>
        <li>En la Caja puedes elegir <b>Factura</b> o <b>Sin boleta</b> (por ejemplo, si la plataforma ya emite el documento).</li>
        <li>Las ventas atrasadas no emiten boleta solas.</li>
      </ul>
      <button className={enabled ? "btn" : "btn btn-primary"} type="button" disabled={pending} onClick={() => {
        if (!confirm(enabled ? "¿Desactivar la boleta automática? La máquina TUU tendrá que volver a emitir boletas." : "¿Activar la boleta automática? Antes, configura la máquina TUU para que NO emita boleta, o tendrás boletas duplicadas.")) return;
        setErr(null); start(async () => { const r = await setAutoBoletaAction(!enabled); if (r.ok) router.refresh(); else setErr(r.error); });
      }}>{pending ? "Guardando…" : enabled ? "Desactivar" : "Activar boleta al cobrar"}</button>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
