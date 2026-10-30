"use client";
// Botones de la cotización: imprimir / PDF, enviar por WhatsApp o correo, cobrar en la caja, aceptar o anular.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setQuoteStatusAction, setQuoteValidityAction } from "@/actions/quotes.actions";
import { QUOTE_VALIDITY } from "@/domain/quotes/quote";

export function QuoteActions({ id, code, shareRef, phone, email, status, canReopen, validDays, sold = false }: { sold?: boolean; validDays: number; id: string; code: string; shareRef: string | null; phone: string | null; email: string | null; status: string; canReopen: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const [ph, setPh] = useState(phone ?? ""); const [mail, setMail] = useState(email ?? ""); const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}/q/${shareRef}`;
  const text = () => `¡Hola! Te enviamos la cotización ${code} de Estación Repostera: ${url()}`;
  const wa = () => { const d = ph.replace(/\D/g, ""); return !d ? "" : d.length === 9 ? `56${d}` : d.length === 8 ? `569${d}` : d; };
  const set = (s: "PENDING" | "ACCEPTED" | "VOID") => start(async () => { setErr(null); const r = await setQuoteStatusAction(id, s); if (!r.ok) setErr(r.error); else router.refresh(); });
  return (
    <div className="quote-actions noprint">
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" type="button" onClick={() => window.print()}>🖨 Imprimir / PDF</button>
        {status !== "VOID" && !sold && <Link className="btn" href={`/cotizaciones/${id}/editar`}>✏️ Editar</Link>}
        {status !== "VOID" && <Link className="btn" href={`/ventas/nueva?cot=${id}`}>Cobrar en la caja</Link>}
        {status === "PENDING" || status === "EXPIRED" ? <button className="btn" type="button" disabled={pending} onClick={() => set("ACCEPTED")}>Marcar aceptada</button> : null}
        {status !== "VOID" ? <button className="btn" type="button" disabled={pending} onClick={() => { if (confirm("¿Anular esta cotización?")) set("VOID"); }}>Anular</button>
          : canReopen && <button className="btn" type="button" disabled={pending} onClick={() => set("PENDING")}>Reactivar</button>}
        {status !== "VOID" && <label className="inline small">Vigencia <select value={validDays} disabled={pending} aria-label="Vigencia" onChange={(e) => { const d = Number(e.target.value); start(async () => { setErr(null); const r = await setQuoteValidityAction(id, d); if (!r.ok) setErr(r.error); else router.refresh(); }); }}>
          {QUOTE_VALIDITY.map((d) => <option key={d} value={d}>{d} días</option>)}</select></label>}
      </div>
      {shareRef && status !== "VOID" && (
        <div className="share-doc">
          <div className="small" style={{ fontWeight: 700, margin: "12px 0 6px" }}>Enviar al cliente</div>
          <div className="share-row">
            <input value={ph} onChange={(e) => setPh(e.target.value)} inputMode="tel" placeholder="Celular, ej. 9 1234 5678" aria-label="Celular del cliente" />
            <button type="button" className="btn btn-small" onClick={() => window.open(`https://wa.me/${wa()}?text=${encodeURIComponent(text())}`, "_blank", "noopener")}>WhatsApp</button>
          </div>
          <div className="share-row">
            <input value={mail} onChange={(e) => setMail(e.target.value)} inputMode="email" placeholder="Correo" aria-label="Correo del cliente" />
            <button type="button" className="btn btn-small" onClick={() => { window.location.href = `mailto:${encodeURIComponent(mail.trim())}?subject=${encodeURIComponent(`Cotización ${code} - Estación Repostera`)}&body=${encodeURIComponent(text())}`; }}>Correo</button>
          </div>
          <button type="button" className="link small" onClick={async () => { try { await navigator.clipboard.writeText(url()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { prompt("Copia el enlace:", url()); } }}>{copied ? "✓ Enlace copiado" : "Copiar enlace"}</button>
          {" · "}<a className="small" href={`/q/${shareRef}`} target="_blank" rel="noopener">Ver como el cliente</a>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
