import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@/core/permissions";
import { requireActor } from "@/lib/session";
import { services } from "@/server/container";
import { peso } from "@/lib/format";
import { ACCOUNT_LABEL, PAID_FROM_LABEL, type MoveEnd } from "@/domain/money/money";
import { MoneyTable, MoneyStartForm, MoneyMoveForm, MoneyMoveVoid, PaidFromSelect } from "@/components/money-ui";

const dmy = (s: string) => s.split("-").reverse().join("-");
const when = (d: Date) => new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
const endLabel = (e: MoveEnd) => (e === "EXTERNO" ? "Fuera del negocio" : ACCOUNT_LABEL[e]);

export default async function MoneyPage() {
  const { actor } = await requireActor();
  if (!can(actor.role, "money.manage")) redirect("/");
  const st = await services.money.status(actor);

  if (!st.start || !st.result) {
    return (
      <main className="page">
        <div className="pagehead"><h1>Dinero disponible</h1></div>
        <p className="muted" style={{ maxWidth: 760 }}>Muestra cuánto dinero deberías tener y dónde: caja, banco, Mercado Pago, y lo que TUU y Rappi aún te deben. Para empezar, cuenta lo que tienes hoy.</p>
        <MoneyStartForm />
      </main>
    );
  }
  const r = st.result; const unassigned = st.outflows.filter((o) => o.paidFrom === null);
  return (
    <main className="page page-wide">
      <div className="pagehead"><h1>Dinero disponible</h1></div>
      <p className="muted" style={{ marginTop: -6 }}>Desde el punto de partida del <b>{when(st.start.at)}</b> ({st.start.userName}){st.start.note ? ` · ${st.start.note}` : ""} · {st.salesCount} venta(s) registradas desde entonces.</p>

      <div className="kpis">
        <div className="tile tile-hero"><p>Deberías tener en total</p><h3>{peso(r.total)}</h3><p className="small">disponible + por cobrar</p></div>
        <div className="tile"><p>Disponible ya</p><h3>{peso(r.available)}</h3><p className="small">caja + banco + Mercado Pago</p></div>
        <div className="tile"><p>Por cobrar</p><h3>{peso(r.receivable)}</h3><p className="small">TUU + Rappi</p></div>
        {r.unassigned > 0 && <div className="tile"><p>Sin indicar con qué se pagó</p><h3>{peso(-r.unassigned)}</h3><p className="small">{unassigned.length} compra(s)/gasto(s) · ver abajo</p></div>}
      </div>

      <MoneyTable lines={r.lines} unassigned={r.unassigned} total={r.total} />

      <h2 className="sect">Traspasos, retiros y aportes</h2>
      <p className="muted small" style={{ maxWidth: 900 }}>Cuando TUU te abone (llega ~5 a 7 días después de la venta) registra <b>“TUU abonó al banco”</b> por el <b>total abonado</b>; igual con Rappi, o si pasas plata de Mercado Pago al banco. Los retiros para uso personal también van aquí.</p>
      <MoneyMoveForm today={st.today} />
      {st.moves.length > 0 && (
        <div className="tablewrap" style={{ maxWidth: 1000 }}><table className="list">
          <thead><tr><th>Fecha</th><th>Movimiento</th><th className="num">Monto</th><th>Nota</th><th></th></tr></thead>
          <tbody>{st.moves.map((m) => (
            <tr key={m.id} style={m.voided ? { opacity: 0.55 } : undefined}>
              <td>{dmy(m.date)}<div className="muted small">{m.userName}</div></td>
              <td>{endLabel(m.from)} → {endLabel(m.to)}{m.voided && <div className="out small">Anulado{m.voidReason ? `: ${m.voidReason}` : ""}</div>}</td>
              <td className="num">{m.voided ? <s>{peso(m.amount)}</s> : peso(m.amount)}</td><td className="small">{m.note ?? ""}</td>
              <td>{!m.voided && <MoneyMoveVoid id={m.id} />}</td>
            </tr>))}</tbody>
        </table></div>
      )}

      <h2 className="sect">Compras y gastos desde el punto de partida</h2>
      <p className="muted small" style={{ maxWidth: 900 }}>Indica con qué se pagó cada uno. “{PAID_FROM_LABEL.NONE}” no se descuenta. Las compras y gastos con fecha anterior al punto de partida no se cuentan aquí (ya estaban pagados en tus saldos de partida).</p>
      {st.outflows.length === 0 ? <p className="muted">Sin compras ni gastos registrados desde el punto de partida.</p> : (
        <div className="tablewrap" style={{ maxWidth: 1100 }}><table className="list">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th className="num">Monto</th><th>Pagado con</th></tr></thead>
          <tbody>{st.outflows.map((o) => (
            <tr key={o.kind + o.id}>
              <td>{dmy(o.date)}</td><td>{o.kind === "PURCHASE" ? <Link href={`/compras/${o.id}`}>Compra</Link> : "Gasto"}</td><td>{o.label}</td>
              <td className="num">{peso(o.amount)}</td><td><PaidFromSelect kind={o.kind} id={o.id} value={o.paidFrom} /></td>
            </tr>))}</tbody>
        </table></div>
      )}

      <details style={{ marginTop: 24, maxWidth: 900 }}>
        <summary>¿Cómo se calcula?</summary>
        <ul className="small">
          <li>Cada cuenta parte del saldo que contaste. Se suman las ventas registradas después de ese momento según el medio de pago: efectivo → caja; débito/crédito → TUU por cobrar; transferencia → banco; Mercado Pago → Mercado Pago; Rappi → Rappi por cobrar.</li>
          <li>Se restan las comisiones de cada venta en la cuenta que las descuenta (Mercado Libre en Mercado Pago, Rappi en Rappi, TUU con IVA incluido).</li>
          <li>Se restan las compras y gastos según “Pagado con”, y se aplican los traspasos, retiros y aportes.</li>
          <li>Si los montos reales no cuadran por algo que no se registró, puedes fijar un nuevo punto de partida con lo que tienes.</li>
        </ul>
      </details>
    </main>
  );
}
