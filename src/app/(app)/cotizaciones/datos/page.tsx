import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { QuoteSettingsForm } from "@/components/quote-settings-form";

export default async function QuoteSettingsPage() {
  const { actor } = await requireActor();
  if (!can(actor.role, "settings.write")) redirect("/cotizaciones");
  const p = await services.quotes.settings(actor);
  return (
    <main className="page">
      <div className="pagehead"><h1>Datos del proveedor</h1><Link className="btn" href="/cotizaciones">Volver</Link></div>
      <p className="muted small">Salen en cada cotización nueva. Las cotizaciones ya hechas conservan los datos con que se emitieron.</p>
      <QuoteSettingsForm initial={p} />
    </main>
  );
}
