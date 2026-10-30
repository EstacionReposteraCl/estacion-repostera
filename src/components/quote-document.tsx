// Documento de cotización (tamaño carta). Lo usan la vista interna y el enlace público para el cliente.
import { QUOTE_PAY, QUOTE_PAY_LABEL, QUOTE_STATUS_LABEL, quoteCode, type QuoteDoc, type QuoteShownStatus } from "@/domain/quotes/quote";

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const dmy = (s: string) => s.split("-").reverse().join("-");
const qtyFmt = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString("es-CL", { maximumFractionDigits: 3 }));
const Box = ({ on }: { on: boolean }) => <span className="qd-box" aria-hidden="true">{on ? "✓" : ""}</span>;

export function QuoteDocument({ q, status }: { q: QuoteDoc; status: QuoteShownStatus }) {
  const p = q.provider; const b = p.bank;
  const row = (label: string, value: string | null | undefined) => <tr><th>{label}</th><td>{value || "—"}</td></tr>;
  return (
    <article className="quote-doc">
      {status !== "PENDING" && status !== "ACCEPTED" && <div className={`qd-stamp qd-${status.toLowerCase()}`}>{QUOTE_STATUS_LABEL[status]}</div>}
      <header className="qd-head">
        <div className="qd-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-sm.png" alt="" width={46} height={64} />
          <div><b>{p.tradeName || p.legalName}</b>{p.tradeName && <span>{p.legalName}</span>}<span>RUT {p.rut}</span><span>{p.address}</span><span>{[p.phone, p.email].filter(Boolean).join(" · ")}</span></div>
        </div>
        <div className="qd-title">
          <div className="qd-t">COTIZACIÓN</div>
          <div className="qd-n">N° {quoteCode(q.number)}</div>
          <table><tbody>
            <tr><th>Fecha</th><td>{dmy(q.date)}</td></tr>
            <tr><th>Válida hasta</th><td><b>{dmy(q.validUntil)}</b> ({q.validDays} días)</td></tr>
          </tbody></table>
        </div>
      </header>

      <div className="qd-grid">
        <section>
          <h3>Datos del proveedor</h3>
          <table className="qd-kv"><tbody>
            {row("Nombre o empresa", p.legalName)}
            {row("RUT", p.rut)}
            {row("Dirección", p.address)}
            {row("Correo electrónico", p.email)}
            {row("Teléfono", p.phone)}
          </tbody></table>
        </section>
        <section>
          <h3>Datos del cliente / beneficiario</h3>
          <table className="qd-kv"><tbody>
            {row("Nombre", q.customer.name)}
            {row("RUT", q.customer.rut)}
            {row("Teléfono", q.customer.phone)}
            {row("Correo electrónico", q.customer.email)}
          </tbody></table>
        </section>
      </div>

      <section>
        <h3>Condiciones de pago</h3>
        <div className="qd-pays"><span>Forma de pago:</span>{QUOTE_PAY.map((m) => <span key={m}><Box on={q.payMethods.includes(m)} /> {QUOTE_PAY_LABEL[m]}</span>)}</div>
        {q.payMethods.includes("TRANSFER") && (
          <table className="qd-kv qd-bank"><tbody>
            {row("Nombre del banco", b.bank)}
            {row("Tipo de cuenta", b.accountType)}
            {row("Número de cuenta", b.accountNumber)}
            {row("Nombre del titular", b.holder)}
            {row("RUT titular", b.rut)}
            {row("Correo para envío de comprobante", b.email)}
          </tbody></table>
        )}
      </section>

      <section>
        <h3>Detalle de productos / servicios</h3>
        <table className="qd-lines">
          <thead><tr><th>N°</th><th>Nombre del producto o servicio</th><th className="num">Cantidad</th><th className="num">Valor unitario</th><th className="num">Valor total</th></tr></thead>
          <tbody>
            {q.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.name}</td><td className="num">{qtyFmt(l.qty)}</td><td className="num">{clp(l.unitPrice)}</td><td className="num">{clp(l.total)}</td></tr>)}
          </tbody>
          <tfoot>
            {q.discount > 0 && <><tr><td colSpan={4}>Subtotal</td><td className="num">{clp(q.subtotal)}</td></tr><tr><td colSpan={4}>Descuento</td><td className="num">−{clp(q.discount)}</td></tr></>}
            <tr><td colSpan={4}>Neto</td><td className="num">{clp(q.net)}</td></tr>
            <tr><td colSpan={4}>IVA 19%</td><td className="num">{clp(q.vat)}</td></tr>
            <tr className="qd-total"><td colSpan={4}>TOTAL</td><td className="num">{clp(q.total)}</td></tr>
          </tfoot>
        </table>
        <p className="qd-note">Precios en pesos chilenos, <b>IVA incluido</b>.{q.lines.some((l) => /despacho|env[ií]o/i.test(l.name)) ? " El total incluye el despacho." : ""}</p>
      </section>

      <section className="qd-cond">
        <div><b>Vigencia del precio:</b> {q.validDays} días, hasta el {dmy(q.validUntil)}.</div>
        <div><b>Documento a emitir:</b> <span><Box on={q.docType !== "FACTURA"} /> Boleta</span> <span><Box on={q.docType !== "BOLETA"} /> Factura</span></div>
        {q.notes && <div><b>Notas:</b> {q.notes}</div>}
        {p.footer && <div className="qd-footer">{p.footer}</div>}
      </section>

      <footer className="qd-sign">
        <div><span />Firma y timbre del proveedor</div>
        <div className="qd-meta">Emitida por {q.createdBy} · {quoteCode(q.number)}</div>
      </footer>
    </article>
  );
}
