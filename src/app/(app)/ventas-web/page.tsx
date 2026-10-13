import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { peso } from "@/lib/format";
import { WebSalesActivate, WebSalesControls, PendingWebOrder } from "@/components/web-orders-ui";
import { PAY_OPTIONS } from "@/domain/web-orders/web-orders";

const dmy = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("-") : "");
const when = (d: Date) => new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
const STATE: Record<string, [string, string]> = { DONE: ["Registrada", "pill-ok"], SKIPPED: ["No aplica", ""], IGNORED: ["No registrada", ""], PENDING: ["Por revisar", "pill-warn"] };
const PAY = Object.fromEntries(PAY_OPTIONS) as Record<string, string>;

export default async function WebSalesPage() {
  const { actor } = await requireActor();
  if (!can(actor.role, "sale.read.any")) redirect("/");
  await services.webOrders.sync().catch(() => null);                 // revisión rápida al abrir (con pausa entre revisiones)
  const [st, today] = await Promise.all([services.webOrders.status(actor), services.reports.today(actor)]);
  const localDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso.includes("T") ? iso : iso.replace(" UTC", "Z").replace(" ", "T"))) : "");

  return (
    <main className="page page-wide">
      <div className="pagehead"><h1>Ventas de la página web</h1><Link className="btn" href="/despacho">Etiquetas de despacho</Link></div>
      <p className="muted" style={{ marginTop: -6, maxWidth: 860 }}>Los pedidos pagados en tu tienda Jumpseller se registran solos como ventas del canal <b>Página Web</b>, con su N° de pedido. Los productos se buscan por SKU (o por nombre exacto); si alguno no calza, el pedido queda <b>por revisar</b> aquí.</p>

      {!st.jumpseller ? <p className="tile">Primero conecta Jumpseller en <Link href="/despacho">Etiquetas de despacho</Link>.</p>
        : !st.enabled ? (st.canConfigure ? <WebSalesActivate today={today} /> : <p className="muted">El registro automático no está activado. Pídele al administrador que lo active.</p>)
        : (<>
          <div className="tile" style={{ marginBottom: 12 }}>
            <p style={{ margin: 0 }}>✓ <b>Activo</b> desde el {dmy(st.since)}. {st.hookOk ? "Jumpseller avisa al sistema apenas se paga un pedido." : "El sistema revisa los pedidos cada vez que abres el Inicio, Despacho o esta página."}</p>
            {!st.hookOk && st.hookError && <p className="muted small" style={{ margin: "4px 0 0" }}>{st.hookError}</p>}
          </div>
          <WebSalesControls canConfigure={st.canConfigure} />
        </>)}

      {st.pending.length > 0 && (<>
        <h2 className="sect">Por revisar ({st.pending.length})</h2>
        <div className="webpend-list">{st.pending.map((e) => (
          <PendingWebOrder key={e.orderId} orderId={e.orderId} date={localDate(e.order.date)} customer={e.order.customer} total={e.order.total} payment={e.payment} paymentName={e.order.payment} reason={e.reason ?? ""}
            lines={e.lines} />
        ))}</div>
      </>)}

      {st.recent.length > 0 && (<>
        <h2 className="sect">Últimos pedidos procesados</h2>
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th className="num">Total</th><th>Pago</th><th>Estado</th></tr></thead>
          <tbody>{st.recent.map((e) => { const [label, cls] = STATE[e.state] ?? [e.state, ""]; return (
            <tr key={e.orderId}>
              <td>#{e.orderId}</td><td>{localDate(e.order.date)}<div className="muted small">procesado {when(e.at)}</div></td><td>{e.order.customer}</td>
              <td className="num">{peso(e.order.total)}</td><td className="small">{e.payment && PAY[e.payment] ? PAY[e.payment] : e.order.payment}</td>
              <td><span className={`pill ${cls}`}>{label}</span>{e.saleId && <> <Link href={`/ventas/${e.saleId}`}>Venta N° {e.folio}</Link></>}{e.state !== "DONE" && e.reason && <div className="muted small">{e.reason}</div>}</td>
            </tr>); })}</tbody>
        </table></div>
      </>)}
    </main>
  );
}
