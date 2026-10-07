import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { ExpenseForm, VoidExpense, ExpenseCategories } from "@/components/expenses-ui";
import { peso } from "@/lib/format";

const DOC: Record<string, string> = { FACTURA: "Factura", BOLETA: "Boleta", OTRO: "Otro" };
const dmy = (s: string) => s.split("-").reverse().join("-");

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; cat?: string; estado?: string }> }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "expense.write")) redirect("/");
  const sp = await searchParams; const today = await services.expenses.today(actor);
  const from = sp.desde || today.slice(0, 8) + "01"; const to = sp.hasta || today;
  const [rows, cats, allCats, sups] = await Promise.all([
    services.expenses.list(actor, { from, to, categoryId: sp.cat || undefined, status: sp.estado === "anulados" ? "VOIDED" : sp.estado === "todos" ? undefined : "CONFIRMED" }),
    services.expenses.categories(actor), services.expenses.categories(actor, true), services.purchases.suppliers(actor),
  ]);
  const valid = rows.filter((r) => r.status === "CONFIRMED");
  const byCat = new Map<string, { total: number; cost: number }>();
  for (const r of valid) { const x = byCat.get(r.category) ?? { total: 0, cost: 0 }; x.total += r.totalAmount; x.cost += r.vatRecoverable ? r.netAmount : r.totalAmount; byCat.set(r.category, x); }
  const total = valid.reduce((a, r) => a + r.totalAmount, 0); const cost = valid.reduce((a, r) => a + (r.vatRecoverable ? r.netAmount : r.totalAmount), 0);
  return (
    <main className="page page-wide">
      <div className="pagehead"><h1>Gastos</h1></div>
      <p className="muted" style={{ marginTop: -6 }}>Arriendo, servicios, sueldos, publicidad y todo lo que no es mercadería para vender (la mercadería va en Compras). Se restan de la ganancia en Reportes.</p>
      <h2 className="sect" style={{ marginTop: 8 }}>Registrar gasto</h2>
      {cats.length === 0 ? <p className="muted">Primero crea una categoría (abajo).</p> : <ExpenseForm categories={cats.map((c) => ({ id: c.id, name: c.name }))} suppliers={sups.map((s) => ({ id: s.id, name: s.name }))} today={today} />}

      <h2 className="sect">Gastos del período</h2>
      <form className="filters">
        <label className="inline small">Desde <input type="date" name="desde" defaultValue={from} max={today} /></label>
        <label className="inline small">Hasta <input type="date" name="hasta" defaultValue={to} max={today} /></label>
        <select name="cat" defaultValue={sp.cat ?? ""} aria-label="Categoría"><option value="">Todas las categorías</option>{allCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="estado" defaultValue={sp.estado ?? ""} aria-label="Estado"><option value="">Vigentes</option><option value="anulados">Anulados</option><option value="todos">Todos</option></select>
        <button className="btn" type="submit">Ver</button>
      </form>
      <div className="kpis">
        <div className="tile"><p>Total pagado</p><h3>{peso(total)}</h3><p className="small">{valid.length} gasto(s)</p></div>
        <div className="tile tile-hero"><p>Cuenta en el resultado</p><h3>{peso(cost)}</h3><p className="small">facturas a valor neto</p></div>
        {[...byCat].sort((a, b) => b[1].cost - a[1].cost).slice(0, 4).map(([c, v]) => <div className="tile" key={c}><p>{c}</p><h3>{peso(v.total)}</h3></div>)}
      </div>
      {rows.length === 0 ? <p className="muted">No hay gastos en ese período.</p> : (
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Fecha</th><th>Descripción</th><th className="hide-sm">Categoría</th><th className="hide-sm">Documento</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} style={r.status === "VOIDED" ? { opacity: 0.6 } : undefined}>
              <td>{dmy(r.expenseDate)}</td>
              <td>{r.description}{r.supplier && <div className="muted small">{r.supplier}</div>}{r.status === "VOIDED" && <div className="small out">Anulado: {r.voidReason}</div>}</td>
              <td className="hide-sm">{r.category}</td>
              <td className="hide-sm">{r.docType ? `${DOC[r.docType]}${r.docNumber ? " N° " + r.docNumber : ""}` : <span className="muted">—</span>}</td>
              <td className="num">{r.status === "VOIDED" ? <s>{peso(r.totalAmount)}</s> : peso(r.totalAmount)}{r.vatRecoverable && r.status !== "VOIDED" && <div className="muted small">neto {peso(r.netAmount)}</div>}</td>
              <td>{r.status === "CONFIRMED" && <VoidExpense id={r.id} label={r.description} />}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <h2 className="sect">Categorías de gasto</h2>
      <ExpenseCategories items={allCats} />
    </main>
  );
}
