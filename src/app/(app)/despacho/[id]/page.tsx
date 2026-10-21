import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { toClientError } from "@/core/errors";
import { peso } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

const when = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s.includes("T") ? s : s.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
};

export default async function ShippingLabelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ formato?: string }> }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "shipping.labels")) redirect("/");
  const { id } = await params; const big = (await searchParams).formato === "100x150";
  let o: Awaited<ReturnType<typeof services.shipping.order>> | null = null; let err: string | null = null;
  try { o = await services.shipping.order(actor, Number(id)); } catch (e) { err = toClientError(e).message; }
  if (!o) return <main className="page"><p className="error" role="alert">{err}</p><Link className="btn" href="/despacho">Volver</Link></main>;
  const biz = await services.cash.issuer(actor).catch(() => null);
  const place = [o.municipality, o.city && o.city !== o.municipality ? o.city : "", o.region].filter(Boolean).join(", ");
  const from = biz?.address || o.pickupAddress;
  const long = (x: string) => x.length > 22 && !/\s/.test(x);
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
          {when(o.completedAt ?? o.createdAt) && <div className="lb-date">{when(o.completedAt ?? o.createdAt)}</div>}
        </header>
        <div className="lb-sec">REMITENTE</div>
        <div className="lb-small">{biz?.legalName || "Estación Repostera"}{biz?.taxId ? ` · RUT ${biz.taxId}` : ""}</div>
        {from && <div className="lb-small">{from}</div>}
        <div className="lb-sec">DESTINATARIO</div>
        <div className={`lb-name${long(o.name) ? " lb-long" : ""}`}>{o.name || "—"}</div>
        {o.taxId && <div className="lb-small">RUT {o.taxId}</div>}
        {o.pickup ? <div className="lb-addr">Retira en tienda</div> : (<>
          {o.address && <div className="lb-addr">{o.address}{o.complement ? `, ${o.complement}` : ""}</div>}
          {place && <div className="lb-addr">{place}</div>}
          {(o.postal || o.country) && <div className="lb-small">{[o.postal && `CP ${o.postal}`, o.country].filter(Boolean).join(" · ")}</div>}
        </>)}
        {o.phone && <div className="lb-phone">Tel: {o.phone}</div>}
        {o.email && <div className={`lb-small${long(o.email) ? " lb-wrap" : ""}`}>{o.email}</div>}
        <div className="lb-sec">ENVÍO Y PAGO</div>
        <div className="lb-small">{o.shippingMethod || "—"}{o.paymentMethod ? ` · ${o.paymentMethod}` : ""}</div>
        {o.products.length > 0 && <><div className="lb-sec">PRODUCTOS</div>
          <table><tbody>{o.products.map((p, i) => <tr key={i}><td className="num" style={{ paddingLeft: 0, paddingRight: 6 }}>{p.qty} x</td><td style={{ textAlign: "left" }}>{p.name}{p.sku ? <span className="lb-sku"> ({p.sku})</span> : null}</td><td className="num">{p.price !== null ? peso(Math.round(p.price * p.qty)) : ""}</td></tr>)}</tbody></table>
          <table className="lb-tot"><tbody>
            {o.shippingCost ? <tr><td>Envío</td><td className="num">{peso(Math.round(o.shippingCost))}</td></tr> : null}
            {o.discount ? <tr><td>Descuento</td><td className="num">−{peso(Math.round(o.discount))}</td></tr> : null}
            {o.total !== null && <tr><td><b>TOTAL</b></td><td className="num"><b>{peso(Math.round(o.total))}</b></td></tr>}
          </tbody></table></>}
        {o.notes && <><div className="lb-sec">NOTA</div><div>{o.notes}</div></>}
        <footer>estacionrepostera.cl</footer>
      </article>
      <div className="actions noprint" style={{ justifyContent: "center" }}><PrintButton label="Imprimir etiqueta" /><Link className="btn" href="/despacho">Volver</Link></div>
    </main>
  );
}
