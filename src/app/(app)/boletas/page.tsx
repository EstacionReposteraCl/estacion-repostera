import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { HaulmerConnectForm, AutoBoletaToggle } from "@/components/dte-ui";

export default async function BoletasPage() {
  const { actor } = await requireActor();
  if (!can(actor.role, "settings.write")) redirect("/");
  const st = await services.dte.status(actor); const auto = st.configured ? await services.dte.autoBoleta(actor) : false;
  return (
    <main className="page">
      <div className="pagehead"><h1>Boleta electrónica (Haulmer)</h1></div>
      <p className="muted" style={{ marginTop: -6 }}>Emite boletas desde el detalle de cada venta (Rappi, transferencias, efectivo…) y las imprime en la impresora térmica.</p>
      {st.configured && <p className="ok" role="status">Conectado a Haulmer como <b>{st.emisor?.razonSocial}</b> (RUT {st.emisor?.rut}) · ambiente <b>{st.env === "dev" ? "de pruebas" : "de producción"}</b>.</p>}
      {st.configured && <AutoBoletaToggle enabled={auto} />}
      <HaulmerConnectForm />
    </main>
  );
}
