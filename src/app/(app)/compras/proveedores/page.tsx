import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { SupplierForm } from "@/components/supplier-form";

export default async function SuppliersPage() {
  const { actor } = await requireActor();
  if (!can(actor.role, "supplier.write")) redirect("/");
  const sups = await services.purchases.suppliers(actor, true);
  return (
    <main className="page">
      <div className="pagehead"><h1>Proveedores</h1><Link className="btn btn-small" href="/compras">← Compras</Link></div>
      <SupplierForm />
      <h2 className="sect">Registrados ({sups.length})</h2>
      {sups.length === 0 ? <p className="muted">Aún no hay proveedores. También puedes crearlos al registrar una compra.</p> :
        <ul className="entries">{sups.map((s) => <li key={s.id}><SupplierForm s={s} /></li>)}</ul>}
    </main>
  );
}
