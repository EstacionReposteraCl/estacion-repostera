import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { peso } from "@/lib/format";
import { QUOTE_STATUS_LABEL, quoteCode } from "@/domain/quotes/quote";

const dmy = (s: string) => s.split("-").reverse().join("-");
const PILL: Record<string, string> = { PENDING: "pill", ACCEPTED: "pill pill-ok", VOID: "pill pill-off", EXPIRED: "pill pill-warn" };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string }> }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "sale.create")) redirect("/");
  const sp = await searchParams; const term = (sp.q ?? "").trim().toLowerCase();
  const all = await services.quotes.list(actor);
  const rows = all.filter((r) => (!sp.estado || r.status === sp.estado) && (!term || r.customer.toLowerCase().includes(term) || quoteCode(r.number).toLowerCase().includes(term)));
  return (
    <main className="page">
      <div className="pagehead"><h1>Cotizaciones</h1><div className="inline">
        {can(actor.role, "settings.write") && <Link className="btn" href="/cotizaciones/datos">Datos del proveedor</Link>}
        <Link className="btn btn-primary" href="/cotizaciones/nueva">+ Nueva cotización</Link></div></div>
      <form className="filters">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar cliente o N°" aria-label="Buscar" />
        <select name="estado" defaultValue={sp.estado ?? ""} aria-label="Estado"><option value="">Todas</option>{Object.entries(QUOTE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn" type="submit">Ver</button>
      </form>
      {rows.length === 0 ? <p className="muted">No hay cotizaciones{all.length ? " con ese filtro" : " todavía"}.</p> : (
        <div className="tablewrap"><table className="list">
          <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Válida hasta</th><th className="num">Total</th><th>Estado</th><th>Hecha por</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><Link href={`/cotizaciones/${r.id}`}>{quoteCode(r.number)}</Link></td><td>{dmy(r.date)}</td><td>{r.customer}</td><td>{dmy(r.validUntil)}</td>
              <td className="num">{peso(r.total)}</td><td><span className={PILL[r.status]}>{QUOTE_STATUS_LABEL[r.status]}</span></td><td className="small muted">{r.createdBy}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </main>
  );
}
