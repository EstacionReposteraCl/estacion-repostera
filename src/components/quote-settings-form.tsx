"use client";
// Datos del proveedor que salen en cada cotización (empresa y cuenta para transferencias). Solo administradora.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveQuoteSettingsAction } from "@/actions/quotes.actions";
import type { QuoteProvider } from "@/domain/quotes/quote";

export function QuoteSettingsForm({ initial }: { initial: QuoteProvider }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [p, setP] = useState(initial); const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const f = (k: keyof Omit<QuoteProvider, "bank">, label: string, full = false) => (
    <div className={`field${full ? " full" : ""}`}><label htmlFor={`qs-${k}`}>{label}</label>
      {k === "footer" ? <textarea id={`qs-${k}`} rows={2} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} /> : <input id={`qs-${k}`} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />}</div>);
  const b = (k: keyof QuoteProvider["bank"], label: string) => (
    <div className="field"><label htmlFor={`qb-${k}`}>{label}</label><input id={`qb-${k}`} value={p.bank[k]} onChange={(e) => setP({ ...p, bank: { ...p.bank, [k]: e.target.value } })} /></div>);
  return (
    <div>
      <section className="tile"><h2 className="qf-h">Empresa</h2><div className="fields">
        {f("legalName", "Razón social")}{f("tradeName", "Nombre de fantasía")}{f("rut", "RUT")}{f("phone", "Teléfono")}{f("address", "Dirección", true)}{f("email", "Correo electrónico", true)}
      </div></section>
      <section className="tile"><h2 className="qf-h">Cuenta para transferencias</h2><div className="fields">
        {b("bank", "Banco")}{b("accountType", "Tipo de cuenta")}{b("accountNumber", "Número de cuenta")}{b("holder", "Titular")}{b("rut", "RUT del titular")}{b("email", "Correo para comprobantes")}
      </div></section>
      <section className="tile"><div className="fields">{f("footer", "Texto al pie de cada cotización (opcional)", true)}</div></section>
      <div className="actions">
        <button className="btn btn-primary" type="button" disabled={pending} onClick={() => start(async () => { const r = await saveQuoteSettingsAction(p); setMsg(r.ok ? { ok: "Guardado. Las cotizaciones nuevas usarán estos datos." } : { err: r.error }); if (r.ok) router.refresh(); })}>{pending ? "Guardando…" : "Guardar"}</button>
        {msg.ok && <span className="ok small">{msg.ok}</span>}
      </div>
      {msg.err && <p className="error" role="alert">{msg.err}</p>}
    </div>
  );
}
