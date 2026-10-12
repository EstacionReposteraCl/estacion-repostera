import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { peso } from "@/lib/format";
import { PriceSimulator, type SimChannel, type SimProduct } from "@/components/price-simulator";

type SP = Promise<{ q?: string; id?: string }>;
const minus = (date: string, n: number) => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const pct = (milli: number) => Math.round(milli) / 1000;

export default async function PricesPage({ searchParams }: { searchParams: SP }) {
  const { actor } = await requireActor();
  if (!can(actor.role, "report.financial") || !can(actor.role, "settings.write")) redirect("/");
  const sp = await searchParams; const q = (sp.q ?? "").trim();

  const [list, product] = await Promise.all([
    q ? services.products.listAdmin(actor, { q, status: "active", pageSize: 15 }) : null,
    sp.id ? services.products.getAdmin(actor, sp.id).catch(() => null) : null,
  ]);

  let sim: { product: SimProduct; channels: SimChannel[] } | null = null;
  if (product) {
    const today = await services.reports.today(actor);
    const [settings, overview, info] = await Promise.all([
      services.settings.overview(actor), services.reports.overview(actor, { from: minus(today, 90), to: today }), services.products.stockSetupInfo(actor, [product.id]),
    ]);
    const rule = (code: string) => settings.feeRules.find((r) => r.targetCode === code && r.isActive && !r.isManualPerSale);
    const tuu = rule("DEBIT"); const rappi = rule("RAPPI");
    const ml = overview.breakdown.byChannel.find((c) => /mercado\s*libre/i.test(c.name));
    const mlPct = ml && ml.total > 0 ? Math.round((ml.charges / ml.total) * 1000) / 10 : 25;
    const avg = product.avgCost ? Math.round(Number(product.avgCost)) : null; const ref = info.referenceCosts.get(product.id) ?? null;
    sim = {
      product: { id: product.id, name: product.name, sku: product.sku, price: product.salePrice, exempt: product.vatTreatment === "EXENTO",
        cost: avg ?? ref, costNote: avg ? "costo promedio del inventario" : ref ? "costo de referencia de tu planilla" : "sin costo registrado" },
      channels: [
        { key: "local", name: "Tienda · efectivo o transferencia", fee: { percent: 0, fixed: 0 }, note: "sin comisión" },
        { key: "tuu", name: "Tienda · tarjeta (TUU)", fee: { percent: tuu ? pct(tuu.percentMilli) : 0.71, fixed: tuu?.fixedAmount ?? 65 }, note: "comisión de tu configuración" },
        { key: "web", name: "Página web", fee: { percent: 0, fixed: 0 }, note: "ajusta si pagas comisión de pago" },
        { key: "ml", name: "Mercado Libre", fee: { percent: mlPct, fixed: 0 }, note: ml && ml.total > 0 ? `promedio real de tus ventas ML (90 días): ${mlPct}%` : "estimado; ajústalo" },
        { key: "rappi", name: "Rappi", fee: { percent: rappi ? pct(rappi.percentMilli) : 17.85, fixed: rappi?.fixedAmount ?? 0 }, note: "comisión de tu configuración" },
      ],
    };
  }

  return (
    <main className="page page-wide">
      <div className="pagehead"><h1>Simulador de precios</h1></div>
      <p className="muted" style={{ marginTop: -6, maxWidth: 820 }}>Prueba precios y descuentos por canal y mira cuánto te queda de verdad después del IVA, la comisión y el costo. No cambia ningún precio del sistema.</p>
      <form className="filters" role="search">
        <input type="search" name="q" defaultValue={q} placeholder="Busca un producto por nombre, SKU o código de barras" autoFocus={!sim} />
        <button className="btn" type="submit">Buscar</button>
      </form>
      {list && (list.rows.length === 0 ? <p className="muted">No encontré productos con “{q}”.</p> : (
        <div className="tablewrap" style={{ maxWidth: 900, marginBottom: 16 }}><table className="list">
          <thead><tr><th>Producto</th><th>SKU</th><th className="num">Precio</th><th></th></tr></thead>
          <tbody>{list.rows.map((r) => (
            <tr key={r.id}><td>{r.name}</td><td className="small">{r.sku}</td><td className="num">{peso(r.salePrice)}</td><td><Link className="btn btn-small" href={`/precios?id=${r.id}`}>Simular</Link></td></tr>
          ))}</tbody>
        </table></div>
      ))}
      {sp.id && !product && <p className="error">No encontré ese producto.</p>}
      {sim && <PriceSimulator key={sim.product.id} product={sim.product} channels={sim.channels} />}
    </main>
  );
}
