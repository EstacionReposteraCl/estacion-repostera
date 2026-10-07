import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { peso } from "@/lib/format";

const DOC: Record<string, string> = { FACTURA: "Factura", BOLETA: "Boleta", OTRO: "Otro" };
const dmy = (s: string) => s.split("-").reverse().join("-");

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; prov?: string; estado?: string }> }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "purchase.read")) redirect("/");
  const sp = await searchParams; const today = (await services.sales.posOptions(actor)).today;
  const from = sp.desde || today.slice(0, 8) + "01"; const to = sp.hasta || today;
  const [r, sups] = await Promise.all([
    services.purchases.list(actor, { from, to, supplierId: sp.prov || undefined, status: sp.estado === "anuladas" ? "VOIDED" : sp.estado === "validas" ? "CONFIRMED" : undefined }),
    services.purchases.suppliers(actor, true),
  ]);
  return (
    <main className="page">
      <div className="pagehead"><h1>Compras</h1><div className="inline"><Link className="btn" href="/compras/proveedores">Proveedores</Link><Link className="btn btn-primary" href="/compras/nueva">+ Nueva compra</Link></div></div>
      <form className="filters">
        <label className="inline small">Desde <input type="date" name="desde" defaultValue={from} /></label>
        <label className="inline small">Hasta <input type="date" name="hasta" defaultValue={to} /></label>
        <select name="prov" defaultValue={sp.prov ?? ""} aria-label="Proveedor"><option value="">Todos los proveedores</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select name="estado" defaultValue={sp.estado ?? ""} aria-label="Estado"><option value="">Todas</option><option value="validas">Vigentes</option><option value="anuladas">Anuladas</option></select>
        <button className="btn" type="submit">Ver</button>
      </form>
      <div className="grid" style={{ marginTop: 0, marginBottom: 14 }}>
        <div className="tile"><p>Compras vigentes</p><h3 style={{ fontSize: "1.4rem" }}>{r.totals.count}</h3></div>
        <div className="tile"><p>Neto</p><h3 style={{ fontSize: "1.2rem" }}>{peso(r.totals.net)}</h3></div>
        <div className="tile"><p>IVA</p><h3 style={{ fontSize: "1.2rem" }}>{peso(r.totals.vat)}</h3></div>
        <div className="tile"><p>Total pagado</p><h3 style={{ fontSize: "1.4rem" }}>{peso(r.totals.total)}</h3></div>
      </div>
      {r.rows.length === 0 ? <p className="muted">No hay compras en ese período.</p> : (
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Fecha</th><th>Documento</th><th className="hide-sm">Proveedor</th><th className="num hide-sm">Líneas</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{r.rows.map((p) => (
            <tr key={p.id}>
              <td>{dmy(p.docDate)}</td>
              <td><Link href={`/compras/${p.id}`}>{DOC[p.docType]}{p.docNumber ? ` N° ${p.docNumber}` : ""}</Link></td>
              <td className="hide-sm">{p.supplier ?? <span className="muted">—</span>}</td><td className="num hide-sm">{p.items}</td>
              <td className="num">{p.status === "VOIDED" ? <s className="muted">{peso(p.totalAmount)}</s> : peso(p.totalAmount)}</td>
              <td>{p.status === "VOIDED" && <span className="pill pill-warn">Anulada</span>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </main>
  );
}
