import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { services } from "@/server/container";
import { AppError } from "@/core/errors";
import { ProductForm } from "@/components/product-form";
import { ArchiveForm } from "@/components/archive-form";
import { peso, qty } from "@/lib/format";

const OK: Record<string, string> = { creado: "Producto creado.", guardado: "Cambios guardados.", archivado: "Producto archivado.", reactivado: "Producto reactivado." };

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { actor } = await requireActor();
  const { id } = await params; const { ok } = await searchParams;
  let p;
  try { p = await services.products.getAdmin(actor, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const [opts, info] = await Promise.all([services.products.formOptions(actor), services.products.stockSetupInfo(actor, [id])]);
  const hasMovements = info.withMovements.has(id);
  return (
    <main className="page">
      <div className="pagehead">
        <h1>{p.name}</h1>
        <Link className="btn btn-small" href="/productos">← Productos</Link>
      </div>
      {ok && OK[ok] && <p className="ok" role="status">{OK[ok]}</p>}
      {p.kind === "GOODS" && (
        <p className="muted">Stock: <strong>{qty(p.stock)}</strong> · Costo promedio: <strong>{p.avgCost ? peso(Math.round(Number(p.avgCost))) : "—"}</strong> · Valor en inventario: <strong>{peso(p.inventoryValue)}</strong>
          {" · "}<Link href={`/inventario?q=${encodeURIComponent(p.sku)}`}>{hasMovements ? "Ajustar stock" : "Ingresar stock inicial"}</Link></p>
      )}
      <ProductForm units={opts.units} categories={opts.categories} lockUnit={hasMovements}
        values={{ id: p.id, name: p.name, sku: p.sku, brand: p.brand ?? "", categoryId: p.categoryId ?? "", unitCode: p.unit, kind: p.kind, salePrice: String(p.salePrice), vatTreatment: p.vatTreatment, barcodes: p.barcodes.join(", ") }} />
      <div style={{ maxWidth: 760 }}><ArchiveForm id={p.id} isActive={p.isActive} /></div>
    </main>
  );
}
