import Link from "next/link";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { peso, qty } from "@/lib/format";

type SP = Promise<{ q?: string; cat?: string; estado?: string; p?: string }>;

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const { actor } = await requireActor();
  const sp = await searchParams; const q = (sp.q ?? "").trim();
  const isAdmin = can(actor.role, "product.read.admin");
  if (!isAdmin) {
    const rows = q ? await services.products.search(actor, q, 50) : [];
    return (
      <main className="page">
        <div className="pagehead"><h1>Productos</h1></div>
        <form className="filters" role="search">
          <input type="search" name="q" defaultValue={q} placeholder="Nombre, SKU o escanea el código de barras" autoFocus />
          <button className="btn" type="submit">Buscar</button>
        </form>
        {!q ? <p className="muted">Escribe un nombre o escanea un código para ver precio y stock.</p> : rows.length === 0 ? <p className="muted">Sin resultados para “{q}”.</p> : (
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Producto</th><th className="hide-sm">SKU</th><th className="num">Precio</th><th className="num">Stock</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td>{r.name}</td><td className="hide-sm muted">{r.sku}</td><td className="num">{peso(r.salePrice)}</td><td className="num">{r.stock === null ? "—" : qty(r.stock)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </main>
    );
  }
  const estado = sp.estado === "archivados" ? "archived" : sp.estado === "todos" ? "all" : "active";
  const page = Math.max(Number(sp.p) || 1, 1);
  const [list, opts] = await Promise.all([
    services.products.listAdmin(actor, { q, categoryId: sp.cat || null, status: estado, page, pageSize: 50 }),
    services.products.formOptions(actor),
  ]);
  const pages = Math.max(Math.ceil(list.total / list.pageSize), 1);
  const link = (p: number) => { const u = new URLSearchParams(); if (q) u.set("q", q); if (sp.cat) u.set("cat", sp.cat); if (sp.estado) u.set("estado", sp.estado); if (p > 1) u.set("p", String(p)); const s = u.toString(); return `/productos${s ? "?" + s : ""}`; };
  return (
    <main className="page">
      <div className="pagehead">
        <h1>Productos <span className="muted small">({list.total.toLocaleString("es-CL")})</span></h1>
        <Link className="btn btn-primary" href="/productos/nuevo">+ Nuevo producto</Link>
      </div>
      <form className="filters" role="search">
        <input type="search" name="q" defaultValue={q} placeholder="Buscar por nombre, marca, SKU o código de barras" />
        <select name="cat" defaultValue={sp.cat ?? ""} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {opts.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="estado" defaultValue={sp.estado ?? ""} aria-label="Estado">
          <option value="">Activos</option><option value="archivados">Archivados</option><option value="todos">Todos</option>
        </select>
        <button className="btn" type="submit">Filtrar</button>
      </form>
      {list.rows.length === 0 ? <p className="muted">No hay productos con ese filtro.</p> : (
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Producto</th><th className="hide-sm">SKU</th><th className="hide-sm">Categoría</th><th className="num">Precio</th><th className="num">Stock</th><th className="num hide-sm">Costo prom.</th></tr></thead>
          <tbody>{list.rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/productos/${r.id}`}>{r.name}</Link>{r.brand && <div className="muted small">{r.brand}</div>}{!r.isActive && <span className="pill pill-warn">Archivado</span>}</td>
              <td className="hide-sm muted">{r.sku}</td>
              <td className="hide-sm">{r.category ?? <span className="muted">—</span>}</td>
              <td className="num">{peso(r.salePrice)}</td>
              <td className="num">{r.stock === null ? <span className="muted">servicio</span> : qty(r.stock)}</td>
              <td className="num hide-sm">{r.avgCost ? peso(Math.round(Number(r.avgCost))) : <span className="muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
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
