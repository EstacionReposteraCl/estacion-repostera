import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { toClientError } from "@/core/errors";
import { PrintButton } from "@/components/print-button";

export default async function ShippingLabelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ formato?: string }> }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "shipping.labels")) redirect("/");
  const { id } = await params; const big = (await searchParams).formato === "100x150";
  let o: Awaited<ReturnType<typeof services.shipping.order>> | null = null; let err: string | null = null;
  try { o = await services.shipping.order(actor, Number(id)); } catch (e) { err = toClientError(e).message; }
  if (!o) return <main className="page"><p className="error" role="alert">{err}</p><Link className="btn" href="/despacho">Volver</Link></main>;
  const place = [o.municipality, o.city && o.city !== o.municipality ? o.city : "", o.region].filter(Boolean).join(", ");
  return (
    <main className="page">
      <div className="actions noprint" style={{ justifyContent: "center", marginBottom: 10 }}>
        <span className="muted small">Formato:</span>
        <Link className={`btn btn-small${big ? "" : " btn-primary"}`} href={`/despacho/${id}`}>Térmica (rollo)</Link>
        <Link className={`btn btn-small${big ? " btn-primary" : ""}`} href={`/despacho/${id}?formato=100x150`}>Etiqueta 100 × 150 mm</Link>
      </div>
      {big && <style>{"@page { size: 100mm 150mm; margin: 0; }"}</style>}
      <article className={`receipt label${big ? " lb-100" : ""}`}>
        <header>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-er-bn.png" alt="Estación Repostera" className="rc-logo lb-logo" width={72} height={101} />
          <strong>ESTACIÓN REPOSTERA</strong>
          <div className="lb-order">PEDIDO #{o.id}</div>
        </header>
        <div className="lb-sec">DESTINATARIO</div>
        <div className={`lb-name${(o.name ?? "").length > 22 && !/\s/.test(o.name ?? "") ? " lb-long" : ""}`}>{o.name || "—"}</div>
        <div className="lb-addr">{o.address}{o.complement ? `, ${o.complement}` : ""}</div>
        {place && <div className="lb-addr">{place}</div>}
        {o.phone && <div className="lb-phone">Tel: {o.phone}</div>}
        {o.shippingMethod && <><div className="lb-sec">ENVÍO</div><div>{/store[_\s-]?pickup/i.test(o.shippingMethod) ? "Retiro en tienda" : o.shippingMethod}</div></>}
        {o.products.length > 0 && <><div className="lb-sec">PRODUCTOS</div>
          <table><tbody>{o.products.map((p, i) => <tr key={i}><td className="num" style={{ paddingLeft: 0, paddingRight: 6 }}>{p.qty} x</td><td style={{ textAlign: "left" }}>{p.name}</td></tr>)}</tbody></table></>}
        {o.notes && <><div className="lb-sec">NOTA</div><div>{o.notes}</div></>}
        <footer>estacionrepostera.cl</footer>
      </article>
      <div className="actions noprint" style={{ justifyContent: "center" }}><PrintButton label="Imprimir etiqueta" /><Link className="btn" href="/despacho">Volver</Link></div>
    </main>
  );
}
