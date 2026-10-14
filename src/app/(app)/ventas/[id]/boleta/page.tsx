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
const MEDIO: Record<number, string> = { 1: "Efectivo", 2: "Pago electrónico", 3: "Transferencia", 4: "Cheque", 5: "Otro" };

export default async function BoletaPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor();
  const { id } = await params;
  let b;
  try { b = await services.dte.forSale(actor, id); } catch (e) { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; }
  if (!b) notFound();
  const e = b.emisor; const fac = b.tipo !== 39 ? b : null;
  const title = b.tipo === 39 ? "BOLETA ELECTRÓNICA" : b.tipo === 34 ? "FACTURA NO AFECTA O EXENTA ELECTRÓNICA" : "FACTURA ELECTRÓNICA";
  return (
    <main className="page">
      {b.env === "dev" && <p className="error noprint" role="alert">Documento de PRUEBA (ambiente de pruebas de Haulmer): no es válida ante el SII.</p>}
      <article className="receipt boleta">
        {b.env === "dev" && <div className="bo-box">DOCUMENTO DE PRUEBA · SIN VALIDEZ</div>}
        <div className="bo-box">
          <div>R.U.T.: {rutFmt(e.rut)}</div>
          <div>{title}</div>
          <div>N° {b.folio}</div>
        </div>
        <div className="bo-sii">S.I.I. - {e.direccionRegional || e.comuna}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-er-bn.png" alt="" className="rc-logo bo-logo" width={72} height={101} />
        <div className="bo-emisor">
          <b>{e.razonSocial}</b>
          <div>{e.giro}</div>
          <div>{e.direccion}, {e.comuna}</div>
        </div>
        {fac ? (
          <div className="bo-meta">Fecha emisión: {dmy(b.fecha)}<br />
            <b>Señor(es): {fac.receptor.razonSocial}</b><br />R.U.T.: {rutFmt(fac.receptor.rut.replace(/\./g, ""))}<br />Giro: {fac.receptor.giro}<br />
            Dirección: {fac.receptor.direccion}, {fac.receptor.comuna}<br />Forma de pago: {fac.fmaPago === 2 ? "Crédito" : "Contado"}<br />Venta interna N° {b.saleFolio}</div>
        ) : (
          <div className="bo-meta">Fecha emisión: {dmy(b.fecha)}{b.tipo === 39 && b.medioPago ? <><br />Medio de pago: {MEDIO[b.medioPago] ?? "Otro"}</> : null}<br />Venta interna N° {b.saleFolio}</div>
        )}
        {fac ? (
          <table><tbody>{fac.netLines.map((l, i) => (
            <tr key={i}><td>{l.name}{l.exempt ? " (exento)" : ""}<div className="rc-sub">{qtyFmt(l.qty)} x {peso(Math.round(l.price))}</div></td><td className="num">{peso(l.amount)}</td></tr>))}</tbody></table>
        ) : (
          <table><tbody>{b.lines.map((l, i) => (
            <tr key={i}><td>{l.name}<div className="rc-sub">{qtyFmt(l.qty)} x {peso(Math.round(l.lineTotal / (l.qty || 1)))}</div></td><td className="num">{peso(l.lineTotal)}</td></tr>))}</tbody></table>
        )}
        <dl>
          {(b.tipo !== 34 || b.neto > 0) && <div><dt>Monto neto</dt><dd>{peso(b.neto)}</dd></div>}
          {b.exento > 0 && <div><dt>Monto exento</dt><dd>{peso(b.exento)}</dd></div>}
          {b.tipo !== 34 && <div><dt>IVA 19%</dt><dd>{peso(b.iva)}</dd></div>}
          <div className="rc-total"><dt>TOTAL</dt><dd>{peso(b.total)}</dd></div>
        </dl>
        {b.tipo === 39 && <p className="bo-iva">El IVA de esta boleta es: {peso(b.iva)}</p>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {b.timbre && <img src={`data:image/png;base64,${b.timbre}`} alt="Timbre electrónico SII" className="bo-timbre" />}
        <footer>
          Timbre Electrónico SII<br />
          Res. N° {b.resolucion.numero} de {b.resolucion.fecha.slice(0, 4)}<br />
          Verifique documento: www.sii.cl
        </footer>
      </article>
      <div className="actions noprint" style={{ justifyContent: "center" }}><PrintButton label={b.tipo === 39 ? "Imprimir boleta" : "Imprimir factura"} /><Link className="btn" href={`/ventas/${id}`}>Volver a la venta</Link></div>
    </main>
  );
}
