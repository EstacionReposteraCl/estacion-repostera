import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { StockTable, type StockRow } from "@/components/stock-table";

type SP = Promise<{ q?: string; cat?: string; p?: string }>;

export default async function InventoryPage({ searchParams }: { searchParams: SP }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "inventory.adjust")) redirect("/");
  const sp = await searchParams; const q = (sp.q ?? "").trim(); const page = Math.max(Number(sp.p) || 1, 1);
  const [list, opts] = await Promise.all([
    services.products.listAdmin(actor, { q, categoryId: sp.cat || null, status: "active", page, pageSize: 40 }),
    services.products.formOptions(actor),
  ]);
  const goods = list.rows.filter((r) => r.stock !== null);
  const info = await services.products.stockSetupInfo(actor, goods.map((r) => r.id));
  const rows: StockRow[] = goods.map((r) => ({ id: r.id, name: r.name, sku: r.sku, unit: r.unit, stock: r.stock ?? "0.000",
    avgCost: r.avgCost ? Math.round(Number(r.avgCost)) : null, refCost: info.referenceCosts.get(r.id) ?? null, hasMovements: info.withMovements.has(r.id) }));
  const pages = Math.max(Math.ceil(list.total / list.pageSize), 1);
  const link = (p: number) => { const u = new URLSearchParams(); if (q) u.set("q", q); if (sp.cat) u.set("cat", sp.cat); if (p > 1) u.set("p", String(p)); const s = u.toString(); return `/inventario${s ? "?" + s : ""}`; };
  return (
    <main className="page">
      <div className="pagehead"><h1>Inventario</h1></div>
      <p className="muted" style={{ marginTop: -6 }}>Escribe el stock que tienes hoy. Si el producto aún no tiene movimientos se registra como <strong>stock inicial</strong> (con el costo unitario propuesto desde tu planilla; puedes cambiarlo). Si ya tiene movimientos se registra como <strong>ajuste por conteo</strong>, con nota y auditoría.</p>
      <form className="filters" role="search">
        <input type="search" name="q" defaultValue={q} placeholder="Buscar por nombre, marca, SKU o código" />
        <select name="cat" defaultValue={sp.cat ?? ""} aria-label="Categoría"><option value="">Todas las categorías</option>{opts.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn" type="submit">Filtrar</button>
      </form>
      {rows.length === 0 ? <p className="muted">No hay productos con ese filtro.</p> : <StockTable key={`${q}|${sp.cat}|${page}`} rows={rows} />}
      {pages > 1 && (
        <div className="pager">
          {page > 1 && <Link className="btn btn-small" href={link(page - 1)}>← Anterior</Link>}
          <span className="muted small">Página {page} de {pages}</span>
          {page < pages && <Link className="btn btn-small" href={link(page + 1)}>Siguiente →</Link>}
        </div>
      )}
    </main>
  );
}
