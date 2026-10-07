import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { PurchaseForm } from "@/components/purchase-form";

export default async function NewPurchasePage() {
  const { actor } = await requireActor();
  if (!can(actor.role, "purchase.create")) redirect("/");
  const [sup, pos] = await Promise.all([services.purchases.suppliers(actor), services.sales.posOptions(actor)]);
  return (
    <main className="page page-wide">
      <div className="pagehead"><h1>Nueva compra</h1></div>
      <PurchaseForm suppliers={sup.map((s) => ({ id: s.id, name: s.name, taxId: s.taxId }))} today={pos.today} />
    </main>
  );
}
