// Enlace público (firmado) para que el cliente vea, imprima o guarde en PDF su cotización. Sin sesión.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { services } from "@/server/container";
import { QuoteDocument } from "@/components/quote-document";
import { PrintButton } from "@/components/print-button";
import { quoteCode } from "@/domain/quotes/quote";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PublicQuotePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const r = await services.quotes.publicGet(ref);
  if (!r) notFound();
  return (
    <main className="page page-quote">
      <div className="pagehead noprint"><h1>Cotización {quoteCode(r.quote.number)}</h1><PrintButton label="Imprimir / Guardar PDF" /></div>
      <QuoteDocument q={r.quote} status={r.status} />
    </main>
  );
}
