import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { AppError } from "@/core/errors";
import { QuoteDocument } from "@/components/quote-document";
import { QuoteActions } from "@/components/quote-actions";
import { QUOTE_STATUS_LABEL, quoteCode } from "@/domain/quotes/quote";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor();
  const { id } = await params;
  let r;
  try { r = await services.quotes.get(actor, id); } catch (e) { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; }
  const q = r.quote; const share = await services.quotes.shareRef(actor, id).catch(() => null);
  return (
    <main className="page page-quote">
      <div className="pagehead noprint"><h1>Cotización {quoteCode(q.number)} <span className="small muted">· {QUOTE_STATUS_LABEL[r.status]}</span></h1><Link className="btn" href="/cotizaciones">Volver</Link></div>
      {q.saleId && <p className="noprint small">Cobrada en la <Link href={`/ventas/${q.saleId}`}>venta registrada</Link>.</p>}
      <QuoteActions id={q.id} code={quoteCode(q.number)} shareRef={share} phone={q.customer.phone} email={q.customer.email} status={r.status} canReopen={can(actor.role, "settings.write")} validDays={q.validDays} />
      <QuoteDocument q={q} status={r.status} />
    </main>
  );
}
