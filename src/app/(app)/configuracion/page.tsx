import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { BusinessForm, FeeRulesTable, EntriesList } from "@/components/settings-forms";

export default async function SettingsPage() {
  const { actor } = await requireActor();
  if (!can(actor.role, "settings.write")) redirect("/");
  const o = await services.settings.overview(actor);
  return (
    <main className="page">
      <div className="pagehead"><h1>Configuración</h1></div>
      <h2 className="sect">Datos del negocio</h2>
      <p className="muted" style={{ marginTop: 0 }}>Aparecen en el encabezado del comprobante.</p>
      <BusinessForm b={o.business} />
      <h2 className="sect">Comisiones</h2>
      <p className="muted" style={{ marginTop: 0 }}>Lo que te cobra cada medio de pago o canal. <strong>Automática</strong>: se descuenta sola al cobrar y se ve en la ganancia real de la venta. <strong>Manual</strong>: la agregas tú después en la venta (útil cuando el monto exacto llega más tarde, como en Mercado Libre). Los cambios aplican solo a ventas nuevas.</p>
      <FeeRulesTable rules={o.feeRules} />
      <h2 className="sect">Canales y medios de pago</h2>
      <p className="muted" style={{ marginTop: 0 }}>Los inactivos no aparecen en la caja. No se borran porque hay ventas que los usan. Si un canal y un medio de pago tienen el mismo nombre (por ejemplo Rappi), la caja elige ese medio de pago al seleccionar el canal. Pon la comisión en <strong>uno solo</strong> de los dos para no descontarla dos veces.</p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <div className="tile"><h3>Canales de venta</h3><EntriesList items={o.channels} kind="channel" /></div>
        <div className="tile"><h3>Medios de pago</h3><EntriesList items={o.paymentMethods} kind="paymentMethod" /></div>
      </div>
    </main>
  );
}
