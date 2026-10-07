import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { AppError } from "@/core/errors";
import { PurchaseVoid } from "@/components/purchase-void";
import { peso, qty } from "@/lib/format";
import type { VoidPlan } from "@/domain/purchases/purchases";

const DOC: Record<string, string> = { FACTURA: "Factura", BOLETA: "Boleta", OTRO: "Documento" };
const dmy = (s: string) => s.split("-").reverse().join("-");
const q3 = (m: bigint) => `${m / 1000n}.${(m % 1000n).toString().padStart(3, "0")}`;

export default async function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "purchase.read")) redirect("/");
  const { id } = await params; const { nueva } = await searchParams;
  let d;
  try { d = await services.purchases.detail(actor, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const p = d.purchase;
  let voidUi: { mode: "exact" | "adjusted" | "blocked"; variance: number; blockedText?: string } | null = null;
  if (p.status === "CONFIRMED" && can(actor.role, "purchase.void")) {
    const exact: VoidPlan = await services.purchases.previewVoid(actor, id, false);
    if (exact.status === "ok") voidUi = { mode: "exact", variance: 0 };
    else if (exact.reason === "STOCK_BELOW_PURCHASED") voidUi = { mode: "blocked", variance: 0, blockedText: "No se puede anular: ya se vendió o retiró parte de lo comprado (el stock actual es menor que lo comprado). Corrige con un ajuste de inventario." };
    else { const adj = await services.purchases.previewVoid(actor, id, true); voidUi = adj.status === "ok" ? { mode: "adjusted", variance: adj.totalVariance } : { mode: "blocked", variance: 0, blockedText: "No se puede anular en este momento." }; }
  }
  return (
    <main className="page">
      {nueva && <p className="ok" role="status">Compra registrada. El stock y el costo promedio ya se actualizaron.</p>}
      <div className="pagehead">
        <h1>{DOC[p.docType]}{p.docNumber ? ` N° ${p.docNumber}` : ""} {p.status === "VOIDED" && <span className="pill pill-warn">Anulada</span>}</h1>
        <Link className="btn btn-small" href="/compras">← Compras</Link>
      </div>
      <p className="muted">{d.supplier ?? "Sin proveedor"} · Fecha {dmy(p.docDate)} · Costos {p.pricesIncludeVat ? "con IVA" : "netos"} · {p.vatRecoverable ? "IVA recuperable" : "IVA no recuperable"} · Registrada por {d.createdBy}
        {p.status === "VOIDED" && <><br />Anulada por {d.voidedBy}: {p.voidReason}{p.voidMode === "ADJUSTED" ? ` (ajustada, varianza ${peso(p.voidVariance ?? 0)})` : ""}</>}
        {p.note && <><br />Nota: {p.note}</>}</p>
      <div className="tablewrap"><table className="list">
        <thead><tr><th>Producto</th><th className="num">Cantidad</th><th className="num">Neto</th><th className="num hide-sm">IVA</th><th className="num">Total</th><th className="num">Costo inventario</th><th className="num hide-sm">Costo unit.</th></tr></thead>
        <tbody>{d.items.map((i, k) => (
          <tr key={i.id}><td><Link href={`/productos/${i.productId}`}>{i.nameSnapshot}</Link><div className="muted small">{i.sku}</div></td>
            <td className="num">{qty(q3(i.quantity))} <span className="muted small">{i.unit.toLowerCase()}</span></td>
            <td className="num">{peso(i.lineNet)}</td><td className="num hide-sm">{peso(i.lineVat)}</td><td className="num">{peso(i.lineTotal)}</td>
            <td className="num">{peso(i.costBasis)}</td><td className="num hide-sm">{peso(Math.round(Number(d.unitCosts[k])))}</td></tr>))}</tbody>
        <tfoot><tr><th>Totales</th><th></th><th className="num">{peso(p.netAmount)}</th><th className="num hide-sm">{peso(p.vatAmount)}</th><th className="num">{peso(p.totalAmount)}</th><th className="num">{peso(d.items.reduce((s, i) => s + i.costBasis, 0))}</th><th className="hide-sm"></th></tr></tfoot>
      </table></div>
      {voidUi && <div style={{ maxWidth: 760 }}><PurchaseVoid id={p.id} {...voidUi} /></div>}
    </main>
  );
}
