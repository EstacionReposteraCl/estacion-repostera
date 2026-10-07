import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { AppError } from "@/core/errors";
import { ReceiptActions } from "@/components/receipt-actions";
import { SaleAdminPanel } from "@/components/sale-admin-panel";
import { peso, qty } from "@/lib/format";

const dt = (iso: string) => new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" });

export default async function SalePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const { actor } = await requireActor();
  const { id } = await params; const { nueva } = await searchParams;
  let sale, meta;
  try { [sale, meta] = await Promise.all([services.sales.getSaleForActor(actor, id), services.sales.metaForActor(actor, id)]); }
  catch (e) { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; }
  const fin = can(actor.role, "report.financial") ? await services.sales.getSaleFinancial(actor, id) : null;
  return (
    <main className="page">
      {nueva && <p className="ok noprint" role="status">Venta registrada. Folio N° {sale.folio}.</p>}
      <article className="receipt">
        <header>
          <strong>{sale.issuer.legalName}</strong>
          {sale.issuer.taxId && <div>RUT {sale.issuer.taxId}</div>}
          {sale.issuer.address && <div>{sale.issuer.address}</div>}
          <div className="rc-doc">COMPROBANTE INTERNO N° {sale.folio}</div>
          <div>{dt(sale.soldAt)} · {meta.channel}</div>
          <div>Atendido por: {meta.seller}</div>
          {meta.externalRef && <div>Pedido: {meta.externalRef}</div>}
          {sale.status === "VOIDED" && <div className="rc-void">ANULADA{meta.voidReason ? ` — ${meta.voidReason}` : ""}</div>}
        </header>
        <table><tbody>
          {sale.lines.map((l) => (
            <tr key={l.lineNumber}><td>{l.name}<div className="rc-sub">{qty(l.quantity)} × {peso(l.unitPrice)}</div></td><td className="num">{peso(l.lineTotal)}</td></tr>
          ))}
        </tbody></table>
        <dl>
          <div><dt>Neto</dt><dd>{peso(sale.subtotal)}</dd></div>
          <div><dt>IVA 19 %</dt><dd>{peso(sale.vat)}</dd></div>
          <div className="rc-total"><dt>TOTAL</dt><dd>{peso(sale.total)}</dd></div>
          {meta.payments.map((p, i) => <div key={i}><dt>{p.method}</dt><dd>{peso(p.amount)}</dd></div>)}
        </dl>
        <footer>Documento interno, no válido como boleta.<br />¡Gracias por tu compra!</footer>
      </article>
      <ReceiptActions saleId={sale.id} fresh={Boolean(nueva)} />
      {fin && <SaleAdminPanel saleId={sale.id} status={sale.status} fin={fin.financial} charges={fin.charges} />}
    </main>
  );
}
