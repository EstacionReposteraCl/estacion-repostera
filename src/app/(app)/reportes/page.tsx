import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { peso, qty } from "@/lib/format";

const CHG: Record<string, string> = { PAYMENT_FEE: "Comisiones de medios de pago", CHANNEL_COMMISSION: "Comisiones de canales", CHANNEL_FIXED_FEE: "Cargos fijos de canales", SHIPPING_COST: "Envíos asumidos", OTHER: "Otros cargos" };
const pct = (a: number, b: number) => (b ? `${(Math.round((a / b) * 1000) / 10).toLocaleString("es-CL")} %` : "—");
const dm = (s: string) => { const [, m, d] = s.split("-"); return `${d}/${m}`; };
const shift = (iso: string, days: number) => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "report.financial")) redirect("/");
  const sp = await searchParams; const today = await services.reports.today(actor);
  const monthStart = today.slice(0, 8) + "01";
  const from = sp.desde || monthStart; const to = sp.hasta || today;
  const r = await services.reports.overview(actor, { from, to });
  const t = r.totals; const b = r.breakdown;
  const gross = t.netTotal + 0; const totalWithVat = b.byDay.reduce((a, d) => a + d.total, 0);
  const prevMonthEnd = shift(monthStart, -1); const prevMonthStart = prevMonthEnd.slice(0, 8) + "01";
  const dow = new Date(today + "T12:00:00Z").getUTCDay(); const weekStart = shift(today, -((dow + 6) % 7));
  const quick = [["Hoy", today, today], ["Ayer", shift(today, -1), shift(today, -1)], ["Esta semana", weekStart, today], ["Este mes", monthStart, today], ["Mes anterior", prevMonthStart, prevMonthEnd], ["Últimos 30 días", shift(today, -29), today]] as const;
  const max = Math.max(1, ...b.byDay.map((d) => d.net));
  return (
    <main className="page page-wide">
      <div className="pagehead"><h1>Reportes</h1></div>
      <div className="chips">{quick.map(([l, f, h]) => <Link key={l} className={`chip ${f === from && h === to ? "on" : ""}`} href={`/reportes?desde=${f}&hasta=${h}`}>{l}</Link>)}</div>
      <form className="filters">
        <label className="inline small">Desde <input type="date" name="desde" defaultValue={from} max={today} /></label>
        <label className="inline small">Hasta <input type="date" name="hasta" defaultValue={to} max={today} /></label>
        <button className="btn" type="submit">Ver</button>
      </form>

      <div className="kpis">
        <div className="tile"><p>Ventas</p><h3>{t.sales.toLocaleString("es-CL")}</h3><p className="small">ticket promedio {peso(t.sales ? Math.round(totalWithVat / t.sales) : 0)}</p></div>
        <div className="tile"><p>Vendido (con IVA)</p><h3>{peso(totalWithVat)}</h3><p className="small">neto {peso(gross)}</p></div>
        <div className="tile"><p>Costo de lo vendido</p><h3>{peso(t.costOfGoodsSold)}</h3></div>
        <div className="tile"><p>Ganancia bruta</p><h3>{peso(t.grossProfit)}</h3><p className="small">margen {pct(t.grossProfit, t.netTotal)}</p></div>
        <div className="tile"><p>Comisiones y cargos</p><h3>{peso(t.totalCharges)}</h3></div>
        <div className="tile tile-hero"><p>Ganancia real</p><h3>{peso(t.realProfit)}</h3><p className="small">margen {pct(t.realProfit, t.netTotal)}</p></div>
      </div>
      <p className="muted small">Solo ventas válidas{b.voided.count > 0 ? ` (${b.voided.count} anulada(s) por ${peso(b.voided.total)} no se cuentan)` : ""}. La ganancia es sobre el neto (sin IVA). Los gastos del negocio se restan más abajo, en “Utilidad del negocio”.</p>

      {b.byDay.length > 1 && (
        <section className="formcard rep">
          <h2 className="sect" style={{ marginTop: 0 }}>Venta neta por día</h2>
          <div className="bars" role="img" aria-label="Gráfico de venta neta por día; los valores están en la tabla de abajo">
            {b.byDay.map((d) => (
              <div className="bar" key={d.date} style={{ height: `${Math.max(2, (d.net / max) * 100)}%` }} data-tip={`${dm(d.date)} · ${peso(d.net)} neto · ${d.count} venta(s) · ganancia real ${peso(d.real)}`} tabIndex={0} />
            ))}
          </div>
          <div className="bars-x"><span>{dm(b.byDay[0].date)}</span><span>{dm(b.byDay[b.byDay.length - 1].date)}</span></div>
          <details><summary className="small">Ver como tabla</summary>
            <div className="tablewrap"><table className="list"><thead><tr><th>Día</th><th className="num">Ventas</th><th className="num">Neto</th><th className="num">Costo</th><th className="num">Ganancia real</th></tr></thead>
              <tbody>{b.byDay.map((d) => <tr key={d.date}><td>{dm(d.date)}</td><td className="num">{d.count}</td><td className="num">{peso(d.net)}</td><td className="num">{peso(d.cost)}</td><td className="num">{peso(d.real)}</td></tr>)}</tbody></table></div>
          </details>
        </section>
      )}

      <h2 className="sect">Productos</h2>
      {b.byProduct.length === 0 ? <p className="muted">Sin ventas en el período.</p> : (
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Neto</th><th className="num hide-sm">Costo</th><th className="num">Ganancia</th><th className="num hide-sm">Margen</th></tr></thead>
          <tbody>{b.byProduct.slice(0, 50).map((p) => (
            <tr key={p.productId}><td><Link href={`/productos/${p.productId}`}>{p.name}</Link><div className="muted small">{p.sku}</div></td><td className="num">{qty(p.qty)}</td><td className="num">{peso(p.net)}</td><td className="num hide-sm">{peso(p.cost)}</td>
              <td className="num">{p.gross < 0 ? <span className="out">{peso(p.gross)}</span> : peso(p.gross)}</td><td className="num hide-sm">{pct(p.gross, p.net)}</td></tr>))}</tbody>
        </table></div>
      )}
      {b.byProduct.length > 50 && <p className="muted small">Se muestran los 50 con más ganancia de {b.byProduct.length}.</p>}

      <div className="grid rep-grid">
        <section className="tile"><h3>Vendedores</h3>
          <table className="list mini"><tbody>{b.bySeller.map((s) => <tr key={s.userId}><td>{s.name}<div className="muted small">{s.count} venta(s)</div></td><td className="num">{peso(s.total)}<div className="muted small">ganancia {peso(s.real)}</div></td></tr>)}</tbody></table></section>
        <section className="tile"><h3>Canales</h3>
          <table className="list mini"><tbody>{b.byChannel.map((c) => <tr key={c.name}><td>{c.name}<div className="muted small">{c.count} venta(s)</div></td><td className="num">{peso(c.total)}<div className="muted small">cargos {peso(c.charges)}</div></td></tr>)}</tbody></table></section>
        <section className="tile"><h3>Medios de pago</h3>
          <table className="list mini"><tbody>{b.byPayment.map((m) => <tr key={m.name}><td>{m.name}<div className="muted small">{m.count} pago(s)</div></td><td className="num">{peso(m.amount)}</td></tr>)}</tbody></table></section>
        <section className="tile"><h3>Comisiones y cargos</h3>
          {b.charges.length === 0 ? <p className="muted small">Sin cargos en el período. Configura las comisiones en <Link href="/configuracion">Configuración</Link>.</p> :
            <table className="list mini"><tbody>{b.charges.map((c) => <tr key={c.type}><td>{CHG[c.type] ?? c.type}<div className="muted small">{c.count} cargo(s)</div></td><td className="num">{peso(c.amount)}</td></tr>)}</tbody></table>}</section>
      </div>

      <h2 className="sect">Gastos y utilidad del negocio</h2>
      <div className="kpis">
        <div className="tile"><p>Ganancia real de las ventas</p><h3>{peso(t.realProfit)}</h3></div>
        <div className="tile"><p>Gastos del período</p><h3>{peso(r.expenses.resultCost)}</h3><p className="small">{r.expenses.total !== r.expenses.resultCost ? `pagado ${peso(r.expenses.total)} · facturas a neto` : <Link href="/gastos">ver gastos</Link>}</p></div>
        <div className="tile tile-hero"><p>Utilidad del negocio</p><h3>{r.businessProfit < 0 ? <span className="out">{peso(r.businessProfit)}</span> : peso(r.businessProfit)}</h3><p className="small">ganancia real − gastos</p></div>
      </div>
      {r.expenses.byCategory.length > 0 ? (
        <div className="tablewrap"><table className="list"><thead><tr><th>Categoría</th><th className="num">Gastos</th><th className="num">Pagado</th><th className="num">En el resultado</th></tr></thead>
          <tbody>{r.expenses.byCategory.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num">{c.count}</td><td className="num">{peso(c.total)}</td><td className="num">{peso(c.resultCost)}</td></tr>)}</tbody></table></div>
      ) : <p className="muted small">Sin gastos registrados en el período. Regístralos en <Link href="/gastos">Gastos</Link> para ver la utilidad real del negocio.</p>}
      <p className="muted small">La utilidad no incluye el impuesto a la renta. Las compras de mercadería no son gasto: entran al inventario y se descuentan como costo cuando se venden.</p>

      <h2 className="sect">Inventario hoy</h2>
      <div className="kpis">
        <div className="tile"><p>Valor del inventario (a costo)</p><h3>{peso(r.inventory.inventoryValue)}</h3></div>
        <div className="tile"><p>Productos con stock</p><h3>{r.inventory.productsWithStock}</h3></div>
        <div className="tile"><p>Productos sin stock</p><h3>{r.inventory.productsWithoutStock}</h3><p className="small"><Link href="/inventario">Ir a inventario</Link></p></div>
      </div>
      {r.inventory.lowStock.length > 0 && (<>
        <p className="muted small" style={{ marginBottom: 6 }}>Por agotarse (2 unidades o menos):</p>
        <div className="tablewrap"><table className="list"><tbody>{r.inventory.lowStock.map((l) => <tr key={l.id}><td><Link href={`/productos/${l.id}`}>{l.name}</Link></td><td className="muted small hide-sm">{l.sku}</td><td className="num">{qty(l.qty)}</td></tr>)}</tbody></table></div>
      </>)}
    </main>
  );
}
