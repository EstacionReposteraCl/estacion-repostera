import Link from "next/link";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { peso } from "@/lib/format";

const hm = (d: Date) => d.toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" });
const dmy = (s: string) => s.split("-").reverse().join("-");

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; estado?: string }> }) {
  const { actor } = await requireActor();
  const sp = await searchParams;
  if (!can(actor.role, "sale.read.any")) {
    const [mine, today] = await Promise.all([services.sales.listSales(actor, 200), services.reports.sellerToday(actor)]);
    return (
      <main className="page">
        <div className="pagehead"><h1>Mis ventas de hoy</h1><Link className="btn btn-primary" href="/ventas/nueva">+ Nueva venta</Link></div>
        <p className="muted">{today.count} venta(s) · <strong>{peso(today.total)}</strong></p>
        {mine.length === 0 ? <p className="muted">Aún no registras ventas hoy.</p> : (
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Folio</th><th>Hora</th><th className="num">Total</th><th>Estado</th></tr></thead>
            <tbody>{mine.map((s) => (
              <tr key={s.id}><td><Link href={`/ventas/${s.id}`}>N° {s.folio}</Link></td><td>{new Date(s.soldAt).toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="num">{peso(s.total)}</td><td>{s.status === "VOIDED" ? <span className="pill pill-warn">Anulada</span> : "OK"}</td></tr>))}</tbody>
          </table></div>
        )}
      </main>
    );
  }
  const status = sp.estado === "anuladas" ? "VOIDED" : sp.estado === "validas" ? "COMPLETED" : undefined;
  const r = await services.sales.listAdmin(actor, { from: sp.desde, to: sp.hasta, status });
  const byMethod = new Map<string, number>();
  for (const s of r.rows) if (s.status === "COMPLETED") for (const p of s.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
  return (
    <main className="page">
      <div className="pagehead"><h1>Ventas</h1><Link className="btn btn-primary" href="/ventas/nueva">+ Nueva venta</Link></div>
      <form className="filters">
        <label className="inline small">Desde <input type="date" name="desde" defaultValue={r.from} /></label>
        <label className="inline small">Hasta <input type="date" name="hasta" defaultValue={r.to} /></label>
        <select name="estado" defaultValue={sp.estado ?? ""} aria-label="Estado"><option value="">Todas</option><option value="validas">Válidas</option><option value="anuladas">Anuladas</option></select>
        <button className="btn" type="submit">Ver</button>
      </form>
      <div className="grid" style={{ marginTop: 0, marginBottom: 14 }}>
        <div className="tile"><p>Ventas válidas</p><h3 style={{ fontSize: "1.4rem" }}>{r.totals.count}</h3></div>
        <div className="tile"><p>Total vendido</p><h3 style={{ fontSize: "1.4rem" }}>{peso(r.totals.total)}</h3></div>
        {[...byMethod].map(([m, v]) => <div className="tile" key={m}><p>{m}</p><h3 style={{ fontSize: "1.2rem" }}>{peso(v)}</h3></div>)}
      </div>
      {r.rows.length === 0 ? <p className="muted">No hay ventas en ese período.</p> : (
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Folio</th><th>{r.from === r.to ? "Hora" : "Fecha"}</th><th className="hide-sm">Vendedor</th><th className="hide-sm">Canal</th><th className="hide-sm">Pago</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{r.rows.map((s) => (
            <tr key={s.id}>
              <td><Link href={`/ventas/${s.id}`}>N° {s.folio}</Link></td>
              <td>{r.from === r.to ? hm(s.soldAt) : `${dmy(s.businessDate)} ${hm(s.soldAt)}`}</td>
              <td className="hide-sm">{s.seller}</td><td className="hide-sm">{s.channel}{s.externalRef && <div className="muted small">{s.externalRef}</div>}</td>
              <td className="hide-sm">{s.payments.map((p) => p.method).join(" + ")}</td>
              <td className="num">{s.status === "VOIDED" ? <s className="muted">{peso(s.total)}</s> : peso(s.total)}</td>
              <td>{s.status === "VOIDED" && <span className="pill pill-warn">Anulada</span>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </main>
  );
}
