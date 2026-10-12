import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { services } from "@/server/container";
import { AppError } from "@/core/errors";
import { peso } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

const rutFmt = (r: string) => { const [n, dv] = r.split("-"); return n ? `${Number(n).toLocaleString("es-CL")}-${dv ?? ""}` : r; };
const dmy = (s: string) => s.split("-").reverse().join("-");
const qtyFmt = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString("es-CL", { maximumFractionDigits: 3 }));

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor();
  const { id } = await params;
  let n;
  try { n = await services.dte.creditNoteFor(actor, id); } catch (e) { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; }
  if (!n) notFound();
  const e = n.emisor;
  return (
    <main className="page">
      {n.env === "dev" && <p className="error noprint" role="alert">Documento de PRUEBA (ambiente de pruebas de Haulmer): no es válido ante el SII.</p>}
      <article className="receipt boleta">
        {n.env === "dev" && <div className="bo-box">DOCUMENTO DE PRUEBA · SIN VALIDEZ</div>}
        <div className="bo-box">
          <div>R.U.T.: {rutFmt(e.rut)}</div>
          <div>NOTA DE CRÉDITO ELECTRÓNICA</div>
          <div>N° {n.folio}</div>
        </div>
        <div className="bo-sii">S.I.I. - {e.direccionRegional || e.comuna}</div>
        <div className="bo-emisor">
          <b>{e.razonSocial}</b>
          <div>{e.giro}</div>
          <div>{e.direccion}, {e.comuna}</div>
        </div>
        <div className="bo-meta">Fecha emisión: {dmy(n.fecha)}<br />Referencia: anula Boleta Electrónica N° {n.refFolio} del {dmy(n.refFecha)}<br />Motivo: {n.reason}</div>
        <table><tbody>{n.lines.map((l, i) => (
          <tr key={i}><td>{l.name}<div className="rc-sub">{qtyFmt(l.qty)} x {peso(Math.round(l.lineTotal / (l.qty || 1)))}</div></td><td className="num">{peso(l.lineTotal)}</td></tr>))}</tbody></table>
        <dl>
          <div><dt>Monto neto</dt><dd>{peso(n.neto)}</dd></div>
          {n.exento > 0 && <div><dt>Monto exento</dt><dd>{peso(n.exento)}</dd></div>}
          <div><dt>IVA 19%</dt><dd>{peso(n.iva)}</dd></div>
          <div className="rc-total"><dt>TOTAL</dt><dd>{peso(n.total)}</dd></div>
        </dl>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {n.timbre && <img src={`data:image/png;base64,${n.timbre}`} alt="Timbre electrónico SII" className="bo-timbre" />}
        <footer>
          Timbre Electrónico SII<br />
          Res. N° {n.resolucion.numero} de {n.resolucion.fecha.slice(0, 4)}<br />
          Verifique documento: www.sii.cl
        </footer>
      </article>
      <div className="actions noprint" style={{ justifyContent: "center" }}><PrintButton label="Imprimir nota de crédito" /><Link className="btn" href={`/ventas/${id}`}>Volver a la venta</Link></div>
    </main>
  );
}
