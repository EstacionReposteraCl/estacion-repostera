import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { QuoteForm } from "@/components/quote-form";

export default async function NewQuotePage() {
  const { actor } = await requireActor();
  if (!can(actor.role, "sale.create")) redirect("/");
  const p = await services.quotes.settings(actor);
  return (
    <main className="page">
      <div className="pagehead"><h1>Nueva cotización</h1><Link className="btn" href="/cotizaciones">Volver</Link></div>
      {!p.legalName && <p className="error" role="alert">Faltan los datos del proveedor (empresa y cuenta bancaria). {can(actor.role, "settings.write") ? <Link href="/cotizaciones/datos">Complétalos aquí</Link> : "Pídele a la administradora que los complete."}</p>}
      <QuoteForm isAdmin={actor.role === "ADMINISTRADOR"} />
    </main>
  );
}
