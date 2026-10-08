import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { peso, qty } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

const CHG: Record<string, string> = { PAYMENT_FEE: "Comisiones de medios de pago", CHANNEL_COMMISSION: "Comisiones de canales", CHANNEL_FIXED_FEE: "Cargos fijos de canales", SHIPPING_COST: "Envíos asumidos", OTHER: "Otros cargos" };
const DOC: Record<string, string> = { FACTURA: "Factura", BOLETA: "Boleta", OTRO: "Otro" };
const pct = (a: number, b: number) => (b ? `${(Math.round((a / b) * 1000) / 10).toLocaleString("es-CL")} %` : "—");
const dm = (s: string) => { const [, m, d] = s.split("-"); return `${d}/${m}`; };
const dmy = (s: string) => s.split("-").reverse().join("-");
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const shift = (iso: string, days: number) => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); };

/** Tipos de reporte: lo que se ve en pantalla es exactamente lo que se imprime. */
const TIPOS = [
  { id: "general", label: "Resumen general", title: "Resumen general" },
  { id: "ventas", label: "Ventas", title: "Reporte de ventas" },
  { id: "productos", label: "Productos vendidos", title: "Productos vendidos" },
  { id: "gastos", label: "Gastos y utilidad", title: "Gastos y utilidad del negocio" },
  { id: "compras", label: "Compras", title: "Compras a proveedores" },
  { id: "inventario", label: "Inventario valorizado", title: "Inventario valorizado" },
  { id: "sinstock", label: "Sin stock", title: "Productos sin stock" },
] as const;
type Tipo = (typeof TIPOS)[number]["id"];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; mes?: string; tipo?: string }> }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "report.financial")) redirect("/");
  const sp = await searchParams; const today = await services.reports.today(actor);
  const tipo: Tipo = (TIPOS.find((x) => x.id === sp.tipo)?.id ?? "general");
  const tipoInfo = TIPOS.find((x) => x.id === tipo)!;
  const monthStart = today.slice(0, 8) + "01";
  const iso = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined);
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) && sp.mes <= today.slice(0, 7) ? sp.mes : undefined;
  let from = mes ? `${mes}-01` : iso(sp.desde) || monthStart; let to = mes ? (lastDay(mes) > today ? today : lastDay(mes)) : iso(sp.hasta) || today;
  if (to > today) to = today; if (from > to) [from, to] = [to, from];
  const isWholeMonth = from.endsWith("-01") && (to === lastDay(from.slice(0, 7)) || (to === today && from.slice(0, 7) === today.slice(0, 7)));
  const periodTitle = isWholeMonth ? `${MESES[Number(from.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase())} ${from.slice(0, 4)}${to === today && to !== lastDay(from.slice(0, 7)) ? ` (al ${dmy(to)})` : ""}` : from === to ? dmy(from) : `${dmy(from)} al ${dmy(to)}`;
  let business: { legalName: string; taxId: string | null } = { legalName: "Estación Repostera", taxId: null };
  try { business = (await services.settings.overview(actor)).business; } catch { /* sin permiso de configuración: se usa el nombre por defecto */ }
  const generated = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" }).format(new Date());

  // Solo se consulta lo que el tipo elegido necesita
  const needsOverview = tipo === "general" || tipo === "ventas" || tipo === "productos" || tipo === "gastos";
  const allGoods = async () => {
    const rows = []; for (let page = 1; page <= 50; page++) {
      const l = await services.products.listAdmin(actor, { status: "active", page, pageSize: 200 }); rows.push(...l.rows);
      if (page * l.pageSize >= l.total) break;
    }
    return rows.filter((p) => p.kind === "GOODS");
  };
  const [r, expenses, purchases, inventory, noStock] = await Promise.all([
    needsOverview ? services.reports.overview(actor, { from, to }) : null,
    tipo === "gastos" ? services.expenses.list(actor, { from, to, status: "CONFIRMED" }) : null,
    tipo === "compras" ? services.purchases.list(actor, { from, to }) : null,
    tipo === "inventario" ? allGoods().then((rows) => rows.filter((p) => p.stock !== null && Number(p.stock) > 0).sort((a, b) => a.name.localeCompare(b.name, "es"))) : null,
    // mismo criterio que el contador "Productos sin stock": activos, de inventario, con stock 0 o sin stock registrado
    tipo === "sinstock" ? allGoods().then((rows) => rows.filter((p) => p.stock === null || Number(p.stock) <= 0)
      .sort((a, b) => (a.category ?? "~").localeCompare(b.category ?? "~", "es") || a.name.localeCompare(b.name, "es"))) : null,
  ]);

  const prevMonthEnd = shift(monthStart, -1); const prevMonthStart = prevMonthEnd.slice(0, 8) + "01";
  const dow = new Date(today + "T12:00:00Z").getUTCDay(); const weekStart = shift(today, -((dow + 6) % 7));
  const quick = [["Hoy", today, today], ["Ayer", shift(today, -1), shift(today, -1)], ["Esta semana", weekStart, today], ["Este mes", monthStart, today], ["Mes anterior", prevMonthStart, prevMonthEnd], ["Últimos 30 días", shift(today, -29), today]] as const;
  const href = (o: { tipo?: string; desde?: string; hasta?: string }) => { const u = new URLSearchParams({ tipo: o.tipo ?? tipo, desde: o.desde ?? from, hasta: o.hasta ?? to }); return `/reportes?${u}`; };
  const usesPeriod = tipo !== "inventario" && tipo !== "sinstock";

  const t = r?.totals; const b = r?.breakdown;
  const totalWithVat = b ? b.byDay.reduce((a, d) => a + d.total, 0) : 0;
  const max = b ? Math.max(1, ...b.byDay.map((d) => d.net)) : 1;
  const show = { kpis: tipo === "general" || tipo === "ventas", byDay: tipo === "general" || tipo === "ventas", products: tipo === "general" || tipo === "productos",
    grid: tipo === "general" || tipo === "ventas", result: tipo === "general" || tipo === "gastos", invSummary: tipo === "general" };

  return (
    <main className="page page-wide report-print">
      <div className="print-head print-only">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-empresa-bn.png" alt="" width={72} height={60} />
        <div><strong>{business.legalName}</strong>{business.taxId ? <span> · RUT {business.taxId}</span> : null}
          <h1>{tipoInfo.title}</h1>
          <p>{usesPeriod ? <>Período: <b>{periodTitle}</b> ({dmy(from)} al {dmy(to)}) · </> : <>Stock y costos al momento de generar · </>}Generado el {generated}</p></div>
      </div>
      <div className="pagehead noprint"><h1>Reportes</h1><PrintButton label={`Imprimir: ${tipoInfo.label}`} /></div>

      <div className="noprint rep-type">
        <span className="small muted">Tipo de reporte</span>
        <div className="chips" role="tablist" aria-label="Tipo de reporte">{TIPOS.map((x) => <Link key={x.id} role="tab" aria-selected={x.id === tipo} className={`chip ${x.id === tipo ? "on" : ""}`} href={href({ tipo: x.id })}>{x.label}</Link>)}</div>
      </div>

      {usesPeriod ? (<>
        <div className="chips noprint">{quick.map(([l, f, h]) => <Link key={l} className={`chip chip-soft ${f === from && h === to ? "on" : ""}`} href={href({ desde: f, hasta: h })}>{l}</Link>)}</div>
        <div className="filters-row noprint">
          <form className="filters"><input type="hidden" name="tipo" value={tipo} />
            <label className="inline small">Mes <input type="month" name="mes" defaultValue={from.slice(0, 7)} max={today.slice(0, 7)} /></label>
            <button className="btn" type="submit">Ver mes</button>
          </form>
          <form className="filters"><input type="hidden" name="tipo" value={tipo} />
            <label className="inline small">Desde <input type="date" name="desde" defaultValue={from} max={today} /></label>
            <label className="inline small">Hasta <input type="date" name="hasta" defaultValue={to} max={today} /></label>
            <button className="btn" type="submit">Ver</button>
          </form>
        </div>
        <p className="rep-period noprint">{tipoInfo.label} · <b>{periodTitle}</b></p>
      </>) : <p className="rep-period noprint">{tipo === "sinstock" ? "Productos activos que hoy tienen stock 0. Para reponer, registra la compra en Compras o el conteo en Inventario." : "Inventario actual: productos activos con stock, valorizados a costo promedio. No depende de fechas."}</p>}

      {show.kpis && t && b && (<>
        <div className="kpis">
          <div className="tile"><p>Ventas</p><h3>{t.sales.toLocaleString("es-CL")}</h3><p className="small">ticket promedio {peso(t.sales ? Math.round(totalWithVat / t.sales) : 0)}</p></div>
          <div className="tile"><p>Vendido (con IVA)</p><h3>{peso(totalWithVat)}</h3><p className="small">neto {peso(t.netTotal)}</p></div>
          <div className="tile"><p>Costo de lo vendido</p><h3>{peso(t.costOfGoodsSold)}</h3></div>
          <div className="tile"><p>Ganancia bruta</p><h3>{peso(t.grossProfit)}</h3><p className="small">margen {pct(t.grossProfit, t.netTotal)}</p></div>
          <div className="tile"><p>Comisiones y cargos</p><h3>{peso(t.totalCharges)}</h3></div>
          <div className="tile tile-hero"><p>Ganancia real</p><h3>{peso(t.realProfit)}</h3><p className="small">margen {pct(t.realProfit, t.netTotal)}</p></div>
        </div>
        <p className="muted small">Solo ventas válidas{b.voided.count > 0 ? ` (${b.voided.count} anulada(s) por ${peso(b.voided.total)} no se cuentan)` : ""}. La ganancia es sobre el neto (sin IVA).{tipo === "general" ? " Los gastos del negocio se restan más abajo, en “Utilidad del negocio”." : ""}</p>
      </>)}

      {show.byDay && b && b.byDay.length > 0 && (
        <section className="formcard rep">
          <h2 className="sect" style={{ marginTop: 0 }}>Venta neta por día</h2>
          {b.byDay.length > 1 && (<>
            <div className="bars" role="img" aria-label="Gráfico de venta neta por día; los valores están en la tabla">
              {b.byDay.map((d) => <div className="bar" key={d.date} style={{ height: `${Math.max(2, (d.net / max) * 100)}%` }} data-tip={`${dm(d.date)} · ${peso(d.net)} neto · ${d.count} venta(s) · ganancia real ${peso(d.real)}`} tabIndex={0} />)}
            </div>
            <div className="bars-x"><span>{dm(b.byDay[0].date)}</span><span>{dm(b.byDay[b.byDay.length - 1].date)}</span></div>
          </>)}
          <details className="noprint" open={tipo === "ventas"}><summary className="small">Ver como tabla</summary><DayTable b={b} /></details>
          <div className="print-only"><DayTable b={b} /></div>
        </section>
      )}

      {show.products && b && (<>
        <h2 className="sect">Productos vendidos</h2>
        {b.byProduct.length === 0 ? <p className="muted">Sin ventas en el período.</p> : (
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Neto</th><th className="num hide-sm">Costo</th><th className="num">Ganancia</th><th className="num hide-sm">Margen</th></tr></thead>
            <tbody>{b.byProduct.map((p, k) => (
              <tr key={p.productId} className={tipo === "general" && k >= 50 ? "print-only-row" : undefined}><td><Link href={`/productos/${p.productId}`}>{p.name}</Link><div className="muted small">{p.sku}</div></td><td className="num">{qty(p.qty)}</td><td className="num">{peso(p.net)}</td><td className="num hide-sm">{peso(p.cost)}</td>
                <td className="num">{p.gross < 0 ? <span className="out">{peso(p.gross)}</span> : peso(p.gross)}</td><td className="num hide-sm">{pct(p.gross, p.net)}</td></tr>))}</tbody>
            <tfoot><tr><th>Total ({b.byProduct.length} productos)</th><th></th><th className="num">{peso(b.byProduct.reduce((s, p) => s + p.net, 0))}</th><th className="num hide-sm">{peso(b.byProduct.reduce((s, p) => s + p.cost, 0))}</th><th className="num">{peso(b.byProduct.reduce((s, p) => s + p.gross, 0))}</th><th className="num hide-sm">{pct(b.byProduct.reduce((s, p) => s + p.gross, 0), b.byProduct.reduce((s, p) => s + p.net, 0))}</th></tr></tfoot>
          </table></div>
        )}
        {tipo === "general" && b.byProduct.length > 50 && <p className="muted small noprint">En pantalla se muestran los 50 con más ganancia de {b.byProduct.length} (al imprimir salen todos). Para verlos todos elige “Productos vendidos”.</p>}
      </>)}

      {show.grid && b && (
        <div className="grid rep-grid">
          <section className="tile"><h3>Vendedores</h3>
            {b.bySeller.length === 0 ? <p className="muted small">Sin ventas.</p> : <table className="list mini"><tbody>{b.bySeller.map((s) => <tr key={s.userId}><td>{s.name}<div className="muted small">{s.count} venta(s)</div></td><td className="num">{peso(s.total)}<div className="muted small">ganancia {peso(s.real)}</div></td></tr>)}</tbody></table>}</section>
          <section className="tile"><h3>Canales</h3>
            {b.byChannel.length === 0 ? <p className="muted small">Sin ventas.</p> : <table className="list mini"><tbody>{b.byChannel.map((c) => <tr key={c.name}><td>{c.name}<div className="muted small">{c.count} venta(s)</div></td><td className="num">{peso(c.total)}<div className="muted small">cargos {peso(c.charges)}</div></td></tr>)}</tbody></table>}</section>
          <section className="tile"><h3>Medios de pago</h3>
            {b.byPayment.length === 0 ? <p className="muted small">Sin pagos.</p> : <table className="list mini"><tbody>{b.byPayment.map((m) => <tr key={m.name}><td>{m.name}<div className="muted small">{m.count} pago(s)</div></td><td className="num">{peso(m.amount)}</td></tr>)}</tbody></table>}</section>
          <section className="tile"><h3>Comisiones y cargos</h3>
            {b.charges.length === 0 ? <p className="muted small">Sin cargos en el período.</p> :
              <table className="list mini"><tbody>{b.charges.map((c) => <tr key={c.type}><td>{CHG[c.type] ?? c.type}<div className="muted small">{c.count} cargo(s)</div></td><td className="num">{peso(c.amount)}</td></tr>)}</tbody></table>}</section>
        </div>
      )}

      {show.result && r && t && (<>
        <h2 className="sect">Gastos y utilidad del negocio</h2>
        <div className="kpis">
          <div className="tile"><p>Ganancia real de las ventas</p><h3>{peso(t.realProfit)}</h3>{tipo === "gastos" && <p className="small">{t.sales} venta(s) · neto {peso(t.netTotal)}</p>}</div>
          <div className="tile"><p>Gastos del período</p><h3>{peso(r.expenses.resultCost)}</h3><p className="small">{r.expenses.total !== r.expenses.resultCost ? `pagado ${peso(r.expenses.total)} · facturas a neto` : <Link className="noprint" href="/gastos">ver gastos</Link>}</p></div>
          <div className="tile tile-hero"><p>Utilidad del negocio</p><h3>{r.businessProfit < 0 ? <span className="out">{peso(r.businessProfit)}</span> : peso(r.businessProfit)}</h3><p className="small">ganancia real − gastos</p></div>
        </div>
        {r.expenses.byCategory.length > 0 ? (
          <div className="tablewrap"><table className="list"><thead><tr><th>Categoría</th><th className="num">Gastos</th><th className="num">Pagado</th><th className="num">En el resultado</th></tr></thead>
            <tbody>{r.expenses.byCategory.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num">{c.count}</td><td className="num">{peso(c.total)}</td><td className="num">{peso(c.resultCost)}</td></tr>)}</tbody></table></div>
        ) : <p className="muted small">Sin gastos registrados en el período.</p>}
        {expenses && expenses.length > 0 && (<>
          <h2 className="sect">Detalle de gastos</h2>
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th className="hide-sm">Proveedor / doc.</th><th className="num">Total</th></tr></thead>
            <tbody>{[...expenses].sort((a, x) => a.expenseDate.localeCompare(x.expenseDate)).map((e) => (
              <tr key={e.id}><td>{dmy(e.expenseDate)}</td><td>{e.category}</td><td>{e.description}</td><td className="hide-sm">{e.supplier ?? "—"}{e.docType ? <div className="muted small">{DOC[e.docType]}{e.docNumber ? ` N° ${e.docNumber}` : ""}</div> : null}</td><td className="num">{peso(e.totalAmount)}</td></tr>))}</tbody>
            <tfoot><tr><th colSpan={4}>Total ({expenses.length} gasto(s))</th><th className="num">{peso(expenses.reduce((s, e) => s + e.totalAmount, 0))}</th></tr></tfoot>
          </table></div>
        </>)}
        <p className="muted small">La utilidad no incluye el impuesto a la renta. Las compras de mercadería no son gasto: entran al inventario y se descuentan como costo cuando se venden.</p>
      </>)}

      {purchases && (<>
        <div className="kpis">
          <div className="tile"><p>Compras</p><h3>{purchases.totals.count}</h3></div>
          <div className="tile"><p>Neto</p><h3>{peso(purchases.totals.net)}</h3></div>
          <div className="tile"><p>IVA</p><h3>{peso(purchases.totals.vat)}</h3></div>
          <div className="tile tile-hero"><p>Total</p><h3>{peso(purchases.totals.total)}</h3></div>
        </div>
        {purchases.rows.length === 0 ? <p className="muted">Sin compras en el período.</p> : (
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Fecha</th><th>Documento</th><th>Proveedor</th><th className="num hide-sm">Líneas</th><th className="num">Neto</th><th className="num hide-sm">IVA</th><th className="num">Total</th></tr></thead>
            <tbody>{[...purchases.rows].sort((a, x) => a.docDate.localeCompare(x.docDate)).map((p) => (
              <tr key={p.id} className={p.status === "VOIDED" ? "muted" : undefined}><td>{dmy(p.docDate)}</td><td><Link href={`/compras/${p.id}`}>{DOC[p.docType]}{p.docNumber ? ` N° ${p.docNumber}` : ""}</Link>{p.status === "VOIDED" && <span className="pill pill-warn" style={{ marginLeft: 6 }}>Anulada</span>}</td>
                <td>{p.supplier ?? "—"}</td><td className="num hide-sm">{p.items}</td><td className="num">{peso(p.netAmount)}</td><td className="num hide-sm">{peso(p.vatAmount)}</td><td className="num">{peso(p.totalAmount)}</td></tr>))}</tbody>
            <tfoot><tr><th colSpan={4}>Total ({purchases.totals.count} compra(s) válidas)</th><th className="num">{peso(purchases.totals.net)}</th><th className="num hide-sm">{peso(purchases.totals.vat)}</th><th className="num">{peso(purchases.totals.total)}</th></tr></tfoot>
          </table></div>
        )}
        <p className="muted small">Las compras anuladas aparecen en gris y no suman en los totales.</p>
      </>)}

      {inventory && (<>
        <div className="kpis">
          <div className="tile"><p>Productos con stock</p><h3>{inventory.length}</h3></div>
          <div className="tile tile-hero"><p>Valor del inventario (a costo)</p><h3>{peso(inventory.reduce((s, p) => s + (p.inventoryValue ?? 0), 0))}</h3></div>
          <div className="tile"><p>Valor a precio de venta</p><h3>{peso(Math.round(inventory.reduce((s, p) => s + Number(p.stock) * p.salePrice, 0)))}</h3><p className="small">con IVA, referencial</p></div>
        </div>
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Producto</th><th className="num">Stock</th><th className="num">Costo prom.</th><th className="num">Valor a costo</th><th className="num hide-sm">Precio venta</th></tr></thead>
          <tbody>{inventory.map((p) => (
            <tr key={p.id}><td>{p.name}<div className="muted small">{p.sku}{p.category ? ` · ${p.category}` : ""}</div></td><td className="num">{qty(p.stock ?? "0")} <span className="muted small">{p.unit.toLowerCase()}</span></td>
              <td className="num">{p.avgCost ? peso(Math.round(Number(p.avgCost))) : "—"}</td><td className="num">{peso(p.inventoryValue ?? 0)}</td><td className="num hide-sm">{peso(p.salePrice)}</td></tr>))}</tbody>
          <tfoot><tr><th colSpan={3}>Total ({inventory.length} productos)</th><th className="num">{peso(inventory.reduce((s, p) => s + (p.inventoryValue ?? 0), 0))}</th><th className="hide-sm"></th></tr></tfoot>
        </table></div>
      </>)}

      {noStock && (<>
        <div className="kpis"><div className="tile tile-hero"><p>Productos sin stock</p><h3>{noStock.length}</h3></div></div>
        {noStock.length === 0 ? <p className="muted">¡Todos los productos activos tienen stock!</p> : (
          <div className="tablewrap"><table className="list">
            <thead><tr><th>Producto</th><th>Categoría</th><th className="hide-sm">Marca</th><th className="num">Precio venta</th><th className="noprint"></th></tr></thead>
            <tbody>{noStock.map((p) => (
              <tr key={p.id}><td>{p.name}<div className="muted small">{p.sku}</div></td><td>{p.category ?? "—"}</td><td className="hide-sm">{p.brand ?? "—"}</td><td className="num">{peso(p.salePrice)}</td>
                <td className="noprint"><Link href={`/productos/${p.id}`}>Ver</Link></td></tr>))}</tbody>
            <tfoot><tr><th colSpan={4}>Total: {noStock.length} productos sin stock</th><th className="noprint"></th></tr></tfoot>
          </table></div>
        )}
      </>)}

      {show.invSummary && r && (<>
        <h2 className="sect">Inventario hoy <span className="muted small" style={{ fontWeight: 400 }}>(al momento de generar el reporte)</span></h2>
        <div className="kpis">
          <div className="tile"><p>Valor del inventario (a costo)</p><h3>{peso(r.inventory.inventoryValue)}</h3><p className="small noprint"><Link href={href({ tipo: "inventario" })}>Ver inventario valorizado</Link></p></div>
          <div className="tile"><p>Productos con stock</p><h3>{r.inventory.productsWithStock}</h3></div>
          <div className="tile"><p>Productos sin stock</p><h3>{r.inventory.productsWithoutStock}</h3><p className="small noprint"><Link href={href({ tipo: "sinstock" })}>Ver cuáles son</Link></p></div>
        </div>
        {r.inventory.lowStock.length > 0 && (<>
          <p className="muted small" style={{ marginBottom: 6 }}>Por agotarse (2 unidades o menos):</p>
          <div className="tablewrap"><table className="list"><tbody>{r.inventory.lowStock.map((l) => <tr key={l.id}><td><Link href={`/productos/${l.id}`}>{l.name}</Link></td><td className="muted small hide-sm">{l.sku}</td><td className="num">{qty(l.qty)}</td></tr>)}</tbody></table></div>
        </>)}
      </>)}
    </main>
  );
}

function DayTable({ b }: { b: { byDay: { date: string; count: number; total: number; net: number; cost: number; real: number }[] } }) {
  return (
    <div className="tablewrap"><table className="list"><thead><tr><th>Día</th><th className="num">Ventas</th><th className="num">Vendido</th><th className="num">Neto</th><th className="num">Costo</th><th className="num">Ganancia real</th></tr></thead>
      <tbody>{b.byDay.map((d) => <tr key={d.date}><td>{dmy(d.date)}</td><td className="num">{d.count}</td><td className="num">{peso(d.total)}</td><td className="num">{peso(d.net)}</td><td className="num">{peso(d.cost)}</td><td className="num">{peso(d.real)}</td></tr>)}</tbody>
      <tfoot><tr><th>Total</th><th className="num">{b.byDay.reduce((s, d) => s + d.count, 0)}</th><th className="num">{peso(b.byDay.reduce((s, d) => s + d.total, 0))}</th><th className="num">{peso(b.byDay.reduce((s, d) => s + d.net, 0))}</th><th className="num">{peso(b.byDay.reduce((s, d) => s + d.cost, 0))}</th><th className="num">{peso(b.byDay.reduce((s, d) => s + d.real, 0))}</th></tr></tfoot>
    </table></div>
  );
}
