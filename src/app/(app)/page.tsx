import Link from "next/link";
import { requireActor } from "@/lib/session";
import { can, type Permission, type Actor } from "@/core/permissions";
import { services } from "@/server/container";
import { peso } from "@/lib/format";
import { Icon, type IconName } from "@/components/icons";

type Mod = { perm: Permission; title: string; text: string; href: string; icon: IconName };
const GROUPS: { title: string; items: Mod[] }[] = [
  { title: "Vender", items: [
    { perm: "sale.create", title: "Caja", text: "Buscar o escanear y cobrar", href: "/ventas/nueva", icon: "cart" },
    { perm: "sale.read.own_today", title: "Ventas", text: "Comprobantes, anulaciones y cargos", href: "/ventas", icon: "list" },
    { perm: "cash.close", title: "Cierre de caja", text: "Abrir, contar y cerrar el turno", href: "/caja/cierre", icon: "lock" },
    { perm: "shipping.labels", title: "Despacho", text: "Etiquetas de pedidos web", href: "/despacho", icon: "truck" },
  ] },
  { title: "Productos", items: [
    { perm: "product.read.public", title: "Productos", text: "Catálogo, precios y códigos", href: "/productos", icon: "box" },
    { perm: "inventory.adjust", title: "Inventario", text: "Stock y conteo físico", href: "/inventario", icon: "clipboard" },
    { perm: "purchase.create", title: "Compras", text: "Facturas de proveedores", href: "/compras", icon: "bag" },
  ] },
  { title: "Dinero", items: [
    { perm: "expense.write", title: "Gastos", text: "Arriendo, servicios, sueldos…", href: "/gastos", icon: "wallet" },
    { perm: "money.manage", title: "Dinero disponible", text: "Caja, banco, Mercado Pago, TUU, Rappi", href: "/dinero", icon: "coins" },
    { perm: "report.financial", title: "Reportes", text: "Ventas, costo y ganancia real", href: "/reportes", icon: "chart" },
  ] },
  { title: "Configuración", items: [
    { perm: "user.write", title: "Usuarios", text: "Accesos, roles y contraseñas", href: "/usuarios", icon: "users" },
    { perm: "settings.write", title: "Boleta electrónica", text: "Conexión con Haulmer", href: "/boletas", icon: "file" },
    { perm: "settings.write", title: "Configuración", text: "Comprobante, comisiones y medios de pago", href: "/configuracion", icon: "sliders" },
  ] },
];

const TZ = "America/Santiago";
const hhmm = (d: Date) => new Intl.DateTimeFormat("es-CL", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
const longDate = (d: Date) => { const s = new Intl.DateTimeFormat("es-CL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d); return s.charAt(0).toUpperCase() + s.slice(1); };
const greeting = (d: Date) => { const h = Number(new Intl.DateTimeFormat("es-CL", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(d)); return h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches"; };
const safe = async <T,>(p: Promise<T>, ms = 4000): Promise<T | null> => { try { return await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]); } catch { return null; } };
const daysAgo = (date: string, n: number) => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

type Alert = { text: string; href: string; tone?: "warn" };

async function adminData(actor: Actor) {
  const date = await services.reports.today(actor);
  const [list, fin, snap, cash, money, orders, voided, dte] = await Promise.all([
    safe(services.sales.listAdmin(actor, {})), safe(services.reports.financial(actor, { from: date, to: date })), safe(services.reports.overview(actor, { from: date, to: date }).then((o) => o.inventory)),
    safe(services.cash.status(actor)), can(actor.role, "money.manage") ? safe(services.money.status(actor)) : null,
    safe(services.shipping.recent(actor), 3500), safe(services.sales.listAdmin(actor, { from: daysAgo(date, 7), to: date, status: "VOIDED" })), safe(services.dte.status(actor)),
  ]);
  const by = { cash: 0, card: 0, other: 0 };
  for (const r of list?.rows ?? []) if (r.status === "COMPLETED") for (const p of r.payments) {
    if (/efectivo/i.test(p.method)) by.cash += p.amount; else if (/d[eé]bito|cr[eé]dito|tarjeta/i.test(p.method)) by.card += p.amount; else by.other += p.amount;
  }
  const alerts: Alert[] = [];
  if (snap?.lowStock.length) alerts.push({ text: `${snap.lowStock.length >= 30 ? "30 o más" : snap.lowStock.length} producto(s) con stock bajo (${snap.lowStock.slice(0, 3).map((l) => l.name).join(", ")}${snap.lowStock.length > 3 ? "…" : ""})`, href: "/inventario?stock=bajo", tone: "warn" });
  if (snap?.productsWithoutStock) alerts.push({ text: `${snap.productsWithoutStock} producto(s) sin stock`, href: "/inventario?stock=sin" });
  const paid = (orders ?? []).filter((o) => o.status === "Paid" && o.createdAt && Date.now() - new Date(o.createdAt).getTime() < 3 * 86400e3);
  if (paid.length) alerts.push({ text: `${paid.length} pedido(s) web pagado(s) en los últimos 3 días: revisa las etiquetas`, href: "/despacho" });
  const unassigned = money?.outflows.filter((o) => o.paidFrom === null).length ?? 0;
  if (unassigned) alerts.push({ text: `${unassigned} compra(s) o gasto(s) sin indicar con qué se pagaron`, href: "/dinero" });
  if (dte?.configured && voided?.rows.length) {
    const pend = (await Promise.all(voided.rows.slice(0, 20).map(async (r) => ((await safe(services.dte.forSale(actor, r.id))) && !(await safe(services.dte.creditNoteFor(actor, r.id))) ? r : null)))).filter(Boolean);
    for (const r of pend) alerts.push({ text: `Venta N° ${r!.folio} anulada: su boleta electrónica sigue vigente en Haulmer`, href: `/ventas/${r!.id}`, tone: "warn" });
  }
  return { total: list?.totals.total ?? 0, count: list?.totals.count ?? 0, by, profit: fin?.realProfit ?? null, cash, alerts };
}

export default async function HomePage() {
  const { actor, name } = await requireActor();
  const now = new Date(); const admin = can(actor.role, "sale.read.any") && can(actor.role, "report.financial");
  const a = admin ? await adminData(actor) : null;
  const seller = admin ? null : await safe(services.reports.sellerToday(actor));
  const cash = a ? a.cash : can(actor.role, "cash.close") ? await safe(services.cash.status(actor)) : null;
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((m) => can(actor.role, m.perm)) })).filter((g) => g.items.length);
  const actions: { href: string; label: string; sub: string; icon: IconName; primary?: boolean }[] = [];
  if (can(actor.role, "sale.create")) actions.push({ href: "/ventas/nueva", label: "Vender", sub: "Abrir la caja de cobro", icon: "cart", primary: true });
  if (can(actor.role, "cash.close")) actions.push({ href: "/caja/cierre", label: cash?.open ? "Cerrar caja" : "Abrir caja", sub: cash?.open ? "Cuadrar el turno" : "Fondo inicial del día", icon: "lock" });
  if (can(actor.role, "shipping.labels")) actions.push({ href: "/despacho", label: "Despacho", sub: "Etiquetas de pedidos web", icon: "truck" });
  if (can(actor.role, "purchase.create")) actions.push({ href: "/compras/nueva", label: "Registrar compra", sub: "Factura de proveedor", icon: "bag" });
  else if (can(actor.role, "sale.read.own_today")) actions.push({ href: "/ventas", label: "Mis ventas", sub: "Ventas de hoy", icon: "list" });

  return (
    <main className="page home">
      <section className="home-hero">
        <div>
          <p className="home-date">{longDate(now)}</p>
          <h1>{greeting(now)}, {name}</h1>
        </div>
        {cash && (cash.open
          ? <Link href="/caja/cierre" className="home-pill home-pill-ok"><span className="dot" />Caja abierta desde las {hhmm(cash.open.at)}{admin ? ` · fondo ${peso(cash.open.float)}` : ""}</Link>
          : <Link href="/caja/cierre" className="home-pill home-pill-off"><span className="dot" />Caja sin abrir · Abrir caja</Link>)}
      </section>

      {a ? (
        <div className="home-kpis">
          <div className="home-kpi home-kpi-main"><span className="lbl">Ventas de hoy</span><strong>{peso(a.total)}</strong><span className="sub">{a.count} venta{a.count === 1 ? "" : "s"}</span></div>
          <div className="home-kpi"><Icon name="cash" /><span className="lbl">Efectivo</span><strong>{peso(a.by.cash)}</strong></div>
          <div className="home-kpi"><Icon name="card" /><span className="lbl">Tarjetas</span><strong>{peso(a.by.card)}</strong><span className="sub">débito y crédito</span></div>
          <div className="home-kpi"><Icon name="phone" /><span className="lbl">Plataformas y otros</span><strong>{peso(a.by.other)}</strong><span className="sub">ML, Rappi, Mercado Pago, transf.</span></div>
          {a.profit !== null && <div className="home-kpi home-kpi-sun"><Icon name="trend" /><span className="lbl">Ganancia real del día</span><strong>{peso(a.profit)}</strong><span className="sub">después de costo y comisiones</span></div>}
        </div>
      ) : (
        <div className="home-kpis">
          <div className="home-kpi home-kpi-main"><span className="lbl">Tus ventas de hoy</span><strong>{peso(seller?.total ?? 0)}</strong><span className="sub">{seller?.count ?? 0} venta{seller?.count === 1 ? "" : "s"}</span></div>
          {cash && <div className="home-kpi"><Icon name="receipt" /><span className="lbl">Ventas en este turno</span><strong>{cash.salesCount}</strong></div>}
        </div>
      )}

      <nav className="home-actions" aria-label="Acciones rápidas">
        {actions.map((x) => (
          <Link key={x.href} href={x.href} className={`home-action${x.primary ? " home-action-primary" : ""}`}>
            <span className="ico"><Icon name={x.icon} size={26} /></span><span className="txt"><b>{x.label}</b><small>{x.sub}</small></span>
          </Link>
        ))}
      </nav>

      {a && (
        <section className="home-panel">
          <h2><Icon name={a.alerts.length ? "alert" : "check"} size={18} /> {a.alerts.length ? "Para revisar" : "Todo al día"}</h2>
          {a.alerts.length ? (
            <ul className="home-alerts">{a.alerts.map((x, i) => (
              <li key={i} className={x.tone === "warn" ? "warn" : undefined}><Link href={x.href}><span>{x.text}</span><Icon name="chevron" size={16} /></Link></li>
            ))}</ul>
          ) : <p className="muted small" style={{ margin: 0 }}>No hay stock bajo, pedidos pendientes ni pagos sin indicar.</p>}
        </section>
      )}

      <div className="home-groups">
        {groups.map((g) => (
          <section key={g.title} className="home-group">
            <h2>{g.title}</h2>
            <ul>{g.items.map((m) => (
              <li key={m.title}><Link href={m.href}><span className="ico"><Icon name={m.icon} /></span><span className="txt"><b>{m.title}</b><small>{m.text}</small></span></Link></li>
            ))}</ul>
          </section>
        ))}
      </div>

      <p className="home-foot">{actor.email} · <Link href="/cambiar-clave">Cambiar contraseña</Link></p>
    </main>
  );
}
