import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { services } from "@/server/container";
import { peso } from "@/lib/format";
import { CashCloseForm, CashOpenForm } from "@/components/cash-close-form";
import { PrintButton } from "@/components/print-button";
import type { CashCloseRecord } from "@/repositories/ports";
import type { BlindClose } from "@/services/cash.service";

const dmy = (s: string) => s.split("-").reverse().join("-");
const hm = (d: Date) => new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" }).format(d);
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + peso(Math.abs(n));
const isFull = (r: CashCloseRecord | BlindClose): r is CashCloseRecord => "diff" in r;
function DiffPill({ diff }: { diff: number }) {
  return <span className={`pill ${diff === 0 ? "pill-ok" : "pill-warn"}`}>{diff === 0 ? "Cuadra" : diff > 0 ? `Sobra ${peso(diff)}` : `Falta ${peso(-diff)}`}</span>;
}

export default async function CashClosePage({ searchParams }: { searchParams: Promise<{ ver?: string; fecha?: string; desde?: string; hasta?: string }> }) {
  const { actor } = await requireActor();
  const sp = await searchParams;
  const today = await services.cash.today(actor);
  const iso = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined);

  // --- comprobante de un cierre (para imprimir) ---
  if (sp.ver) {
    const day = iso(sp.fecha) ?? today;
    const h = await services.cash.history(actor, { from: day, to: day });
    const r = (h.rows as (CashCloseRecord | BlindClose)[]).find((x) => x.id === sp.ver); if (!r) notFound();
    const business = await services.cash.issuer(actor);
    return (
      <main className="page">
        <p className="ok noprint" role="status">Cierre N° {r.seq} del {dmy(r.date)} registrado.</p>
        <article className="receipt">
          <header>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-empresa-bn.png" alt="" className="rc-logo" width={108} height={90} />
            <strong>{business.legalName}</strong>
            {business.taxId && <div>RUT {business.taxId}</div>}
            <div className="rc-doc">CIERRE DE CAJA N° {r.seq}</div>
            <div>{dmy(r.date)} · {hm(r.at)}</div>
            <div>Cerrado por: {r.userName}</div>
            {isFull(r) && <div>Desde: {r.periodFrom ? `cierre anterior (${hm(new Date(r.periodFrom))})` : "inicio del día"}</div>}
            {isFull(r) && (r.openedBy ? <div>Abrió: {r.openedBy}{r.openedAt ? ` · ${hm(new Date(r.openedAt))}` : ""}</div> : <div>(sin apertura registrada)</div>)}
          </header>
          {isFull(r) && (<>
            <table><tbody>
              {r.byMethod.length === 0 ? <tr><td>Sin ventas</td><td className="num">$0</td></tr> : r.byMethod.map((m) => <tr key={m.code}><td>{m.name}<div className="rc-sub">{m.count} venta(s)</div></td><td className="num">{peso(m.amount)}</td></tr>)}
            </tbody></table>
            <dl><div className="rc-total"><dt>VENTAS ({r.salesCount})</dt><dd>{peso(r.total)}</dd></div>{r.voidedCount > 0 && <div><dt>Anuladas</dt><dd>{r.voidedCount}</dd></div>}</dl>
          </>)}
          <dl style={{ borderTop: "1px dashed #999", paddingTop: 6 }}>
            <div><dt>Fondo inicial</dt><dd>{peso(r.float)}</dd></div>
            {isFull(r) && <div><dt>+ Ventas efectivo</dt><dd>{peso(r.byMethod.filter((m) => m.code === "CASH").reduce((a, m) => a + m.amount, 0))}</dd></div>}
            <div><dt>− Retiros/pagos</dt><dd>{peso(r.withdrawals)}</dd></div>
            {isFull(r) && <div><dt>= Esperado</dt><dd>{peso(r.expectedCash)}</dd></div>}
            <div className="rc-total"><dt>CONTADO</dt><dd>{peso(r.counted)}</dd></div>
            {isFull(r) && <div className="rc-total"><dt>{r.diff === 0 ? "CUADRA" : r.diff > 0 ? "SOBRANTE" : "FALTANTE"}</dt><dd>{signed(r.diff)}</dd></div>}
            {!isFull(r) && <div><dt>Ventas del turno</dt><dd>{r.salesCount}</dd></div>}
          </dl>
          {r.note && <p style={{ margin: "6px 0" }}>Nota: {r.note}</p>}
          <footer>Control interno.<br /><br />Firma: ____________________</footer>
        </article>
        <div className="actions noprint" style={{ justifyContent: "center" }}><PrintButton label="Imprimir cierre" /><Link className="btn" href="/caja/cierre">Volver</Link></div>
      </main>
    );
  }

  // --- formulario + historial ---
  const st = await services.cash.status(actor);
  const from = st.review ? (iso(sp.desde) ?? today) : today; const to = st.review ? (iso(sp.hasta) ?? today) : today;
  const h = await services.cash.history(actor, st.review ? { from: from <= to ? from : to, to: from <= to ? to : from } : undefined);
  return (
    <main className="page">
      <div className="pagehead"><h1>Cierre de caja</h1></div>
      <p className="muted" style={{ marginTop: -6 }}>{dmy(st.date)} · {st.since ? `Turno desde el último cierre (${hm(st.since)})` : "Desde el inicio del día"}{st.closesToday > 0 ? ` · ${st.closesToday} cierre(s) hoy` : ""}</p>

      {st.review && st.summary ? (
        <div className="kpis">
          <div className="tile"><p>Ventas del turno</p><h3>{st.summary.salesCount}</h3><p className="small">{st.summary.voidedCount > 0 ? `${st.summary.voidedCount} anulada(s) no cuentan` : "válidas"}</p></div>
          <div className="tile"><p>Total vendido</p><h3>{peso(st.summary.total)}</h3></div>
          <div className="tile tile-hero"><p>Ventas en efectivo</p><h3>{peso(st.summary.cash)}</h3></div>
          {st.summary.byMethod.filter((m) => m.code !== "CASH").map((m) => <div className="tile" key={m.code}><p>{m.name}</p><h3>{peso(m.amount)}</h3><p className="small">{m.count} venta(s)</p></div>)}
        </div>
      ) : <p className="tile" style={{ maxWidth: 640 }}>Ventas registradas en este turno: <b>{st.salesCount}</b></p>}

      {st.open ? (
        <p className="ok" role="status" style={{ maxWidth: 640 }}>Caja abierta por <b>{st.open.userName}</b> a las {hm(st.open.at)} con un fondo de <b>{peso(st.open.float)}</b>.</p>
      ) : (<>
        <CashOpenForm suggestedFloat={st.suggestedFloat} />
        <p className="muted small" style={{ maxWidth: 640 }}>⚠ La caja no está abierta. Puedes vender igual; al abrir, las ventas de hoy quedan en este turno. Si cierras sin abrir, el fondo inicial lo escribes al cerrar.</p>
      </>)}
      <CashCloseForm key={st.open?.id ?? "sin-apertura"} review={st.review} suggestedFloat={st.suggestedFloat} cashSales={st.summary?.cash ?? null} openFloat={st.open?.float ?? null} />

      <h2 className="sect">{st.review ? "Cierres registrados" : "Mis cierres de hoy"}</h2>
      {st.review && (
        <form className="filters">
          <label className="inline small">Desde <input type="date" name="desde" defaultValue={from} max={today} /></label>
          <label className="inline small">Hasta <input type="date" name="hasta" defaultValue={to} max={today} /></label>
          <button className="btn" type="submit">Ver</button>
        </form>
      )}
      {h.rows.length === 0 ? <p className="muted">Sin cierres en el período.</p> : (
        <div className="tablewrap"><table className="list">
          <thead><tr><th>Fecha</th><th>Cerró</th><th className="num">Ventas</th>{h.review && <th className="num">Esperado</th>}<th className="num">Contado</th>{h.review && <th>Resultado</th>}<th></th></tr></thead>
          <tbody>{(h.rows as (CashCloseRecord | BlindClose)[]).map((r) => (
            <tr key={r.id}><td>{dmy(r.date)} {hm(r.at)}<div className="muted small">N° {r.seq}</div></td><td>{r.userName}{isFull(r) && r.role === "VENDEDOR" && <div className="muted small">vendedor</div>}</td>
              <td className="num">{r.salesCount}</td>{isFull(r) && <td className="num">{peso(r.expectedCash)}</td>}<td className="num">{peso(r.counted)}</td>
              {isFull(r) && <td><DiffPill diff={r.diff} />{r.withoutOpen === false && r.openedBy ? <div className="muted small">abrió {r.openedBy}</div> : null}{r.note && <div className="muted small">{r.note}</div>}</td>}
              <td><Link href={`/caja/cierre?ver=${encodeURIComponent(r.id)}&fecha=${r.date}`}>Ver / imprimir</Link></td></tr>))}</tbody>
        </table></div>
      )}
    </main>
  );
}
