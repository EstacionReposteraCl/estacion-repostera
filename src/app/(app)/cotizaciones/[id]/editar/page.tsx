import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { services } from "@/server/container";
import { AppError } from "@/core/errors";
import { QuoteForm } from "@/components/quote-form";
import { quoteCode } from "@/domain/quotes/quote";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor();
  const { id } = await params;
  let r;
  try { r = await services.quotes.get(actor, id); } catch (e) { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; }
  const q = r.quote;
  if (q.status === "VOID" || q.saleId) redirect(`/cotizaciones/${id}`);
  const current = new Map((await services.products.publicByIds(actor, q.lines.map((l) => l.productId).filter((x): x is string => !!x))).map((p) => [p.id, p.salePrice]));
  const initial = {
    id: q.id, customer: { name: q.customer.name, rut: q.customer.rut ?? "", phone: q.customer.phone ?? "", email: q.customer.email ?? "" },
    lines: q.lines.map((l) => ({ productId: l.productId, name: l.name, sku: l.sku, qty: String(l.qty).replace(".", ","), price: String(l.unitPrice), base: l.productId ? current.get(l.productId) ?? l.unitPrice : null })),
    validDays: q.validDays, payMethods: q.payMethods, docType: (q.docType ?? "") as "" | "BOLETA" | "FACTURA", discount: q.discount, notes: q.notes ?? "",
  };
  return (
    <main className="page">
      <div className="pagehead"><h1>Editar cotización {quoteCode(q.number)}</h1><Link className="btn" href={`/cotizaciones/${id}`}>Cancelar</Link></div>
      <p className="muted small">Se mantiene el mismo N° y la fecha. Los productos se cotizan con el precio de tienda actual.</p>
      <QuoteForm isAdmin={actor.role === "ADMINISTRADOR"} initial={initial} />
    </main>
  );
}
