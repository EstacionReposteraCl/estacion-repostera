import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { peso } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

type SP = Promise<{ q?: string; cat?: string; stock?: string; desde?: string; hasta?: string }>;
const num = (s?: string) => { const t = (s ?? "").trim().replace(",", "."); return t !== "" && Number.isFinite(Number(t)) && Number(t) >= 0 ? Number(t) : null; };
const TITLE = { sin: "Productos sin stock", bajo: "Productos con stock bajo" } as const;
const qty = (s: string | null) => { if (s === null) return ""; const n = Number(s); return Number.isInteger(n) ? String(n) : n.toLocaleString("es-CL"); };

/** Lista para imprimir (A4) de los productos sin stock o con stock bajo: sirve para hacer el pedido a proveedores. */
export default async function InventoryPrintPage({ searchParams }: { searchParams: SP }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "inventory.adjust")) redirect("/");
  const sp = await searchParams; const q = (sp.q ?? "").trim(); const desde = num(sp.desde); const hasta = num(sp.hasta); const range = desde !== null || hasta !== null;
  const stock = sp.stock === "bajo" ? "bajo" : sp.stock === "sin" || !range ? "sin" : null;
  const title = stock ? TITLE[stock] : `Productos con stock ${desde !== null && hasta !== null ? `entre ${desde} y ${hasta}` : desde !== null ? `desde ${desde}` : `hasta ${hasta}`}`;
  const rows = [];
  for (let page = 1; page <= 20; page++) {
    const r = await services.products.listAdmin(actor, { q, categoryId: sp.cat || null, status: "active", page, pageSize: 200, stock, minQty: desde, maxQty: hasta });
    rows.push(...r.rows.filter((x) => x.stock !== null)); if (page * r.pageSize >= r.total) break;
  }
  rows.sort((a, b) => (a.category ?? "~").localeCompare(b.category ?? "~") || a.name.localeCompare(b.name));
  const info = await services.products.stockSetupInfo(actor, rows.map((r) => r.id));
  const [business, cats] = await Promise.all([services.cash.issuer(actor), services.products.formOptions(actor)]);
  const catName = sp.cat ? cats.categories.find((c) => c.id === sp.cat)?.name : null;
  const generated = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" }).format(new Date());
  const back = `/inventario?${new URLSearchParams({ ...(q ? { q } : {}), ...(sp.cat ? { cat: sp.cat } : {}), ...(stock ? { stock } : {}), ...(desde !== null ? { desde: String(desde) } : {}), ...(hasta !== null ? { hasta: String(hasta) } : {}) }).toString()}`;
  return (
    <main className="page page-wide report-print">
      <div className="print-head print-only">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-empresa-bn.png" alt="" width={72} height={60} />
        <div><strong>{business.legalName}</strong>{business.taxId ? <span> · RUT {business.taxId}</span> : null}
          <h1>{title}{catName ? ` · ${catName}` : ""}</h1>
          <p>{rows.length} producto(s) · Generado el {generated}</p></div>
      </div>
      <div className="pagehead noprint"><h1>{title}{catName ? ` · ${catName}` : ""}</h1>
        <div className="actions" style={{ margin: 0 }}><PrintButton label="Imprimir lista" /><Link className="btn" href={back}>Volver</Link></div></div>
      <p className="muted noprint" style={{ marginTop: -6 }}>{rows.length} producto(s), ordenados por categoría. La columna <b>Pedir</b> queda en blanco para anotar a mano.</p>
      {rows.length === 0 ? <p className="muted">No hay productos con ese filtro.</p> : (
        <div className="tablewrap"><table className="list print-list">
          <thead><tr><th>#</th><th>Producto</th><th>SKU</th><th>Marca</th><th>Categoría</th><th className="num">Stock</th><th className="num">Últ. costo</th><th className="num">Precio</th><th>Pedir</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const cost = r.avgCost ? Math.round(Number(r.avgCost)) : info.referenceCosts.get(r.id) ?? null;
            return (<tr key={r.id}><td className="muted">{i + 1}</td><td>{r.name}</td><td className="small">{r.sku}</td><td className="small">{r.brand ?? ""}</td><td className="small">{r.category ?? ""}</td>
              <td className="num">{qty(r.stock)}</td><td className="num">{cost ? peso(cost) : ""}</td><td className="num">{peso(r.salePrice)}</td><td className="pedir"></td></tr>);
          })}</tbody>
        </table></div>
      )}
    </main>
  );
}
