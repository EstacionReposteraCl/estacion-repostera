import { after } from "next/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { peso } from "@/lib/format";
import { toClientError } from "@/core/errors";
import { JumpsellerConnectForm } from "@/components/shipping-ui";

const when = (s: string | null) => { if (!s) return ""; const d = new Date(s); return Number.isNaN(d.getTime()) ? s : new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d); };
const ST: Record<string, string> = { Paid: "Pagado", "Pending Payment": "Pago pendiente", Canceled: "Cancelado", Abandoned: "Abandonado" };

export default async function ShippingPage({ searchParams }: { searchParams: Promise<{ pedido?: string; conectar?: string }> }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "shipping.labels")) redirect("/");
  after(() => services.webOrders.sync().then(() => undefined, () => undefined));
  const sp = await searchParams;
  if (sp.pedido && /^\d+$/.test(sp.pedido.trim())) redirect(`/despacho/${sp.pedido.trim()}`);
  const st = await services.shipping.status(actor);
  let rows: Awaited<ReturnType<typeof services.shipping.recent>> = []; let err: string | null = null;
  if (st.configured) { try { rows = await services.shipping.recent(actor); } catch (e) { err = toClientError(e).message; } }
  return (
    <main className="page">
      <div className="pagehead"><h1>Etiquetas de despacho</h1></div>
      <p className="muted" style={{ marginTop: -6 }}>Pedidos de la tienda web (Jumpseller) listos para imprimir en la impresora de boletas.</p>
      {!st.configured ? (st.canConfigure ? <JumpsellerConnectForm login={st.login} /> : <p className="tile">Falta conectar Jumpseller. Pídele al administrador que lo configure.</p>) : (<>
        <form className="filters" action="/despacho">
          <label className="inline">N° de pedido <input name="pedido" inputMode="numeric" placeholder="Ej.: 1017" style={{ width: 120 }} autoFocus /></label>
          <button className="btn btn-primary" type="submit">Ver etiqueta</button>
        </form>
        {err && <p className="error" role="alert">{err}</p>}
        {rows.length > 0 && (
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Comuna</th><th>Envío</th><th>Estado</th><th className="num">Total</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td><b>#{r.id}</b></td><td>{when(r.createdAt)}</td><td>{r.name || "—"}</td><td>{r.municipality || "—"}</td><td className="small">{r.shippingMethod || "—"}</td>
                <td>{ST[r.status] ?? r.status}</td><td className="num">{r.total !== null ? peso(Math.round(r.total)) : ""}</td><td><Link className="btn btn-small" href={`/despacho/${r.id}`}>Etiqueta</Link></td></tr>))}</tbody>
          </table></div>
        )}
        {st.canConfigure && (sp.conectar ? <JumpsellerConnectForm login={st.login} /> : <p className="muted small" style={{ marginTop: 16 }}>Conectado como <b>{st.login}</b> · <Link href="/despacho?conectar=1">cambiar credenciales</Link></p>)}
      </>)}
    </main>
  );
}
