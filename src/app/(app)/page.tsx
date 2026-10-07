import Link from "next/link";
import { requireActor } from "@/lib/session";
import { can, type Permission } from "@/core/permissions";
import { services } from "@/server/container";
import { peso } from "@/lib/format";

const MODULES: { perm: Permission; title: string; text: string; href?: string }[] = [
  { perm: "product.read.public", title: "Productos", text: "Catálogo, precios, códigos de barras y categorías.", href: "/productos" },
  { perm: "inventory.adjust", title: "Inventario", text: "Stock inicial y ajustes por conteo físico.", href: "/inventario" },
  { perm: "sale.create", title: "Caja", text: "Buscar o escanear, cobrar y emitir comprobante.", href: "/ventas/nueva" },
  { perm: "sale.read.own_today", title: "Ventas", text: "Ventas del día, comprobantes, anulaciones y cargos.", href: "/ventas" },
  { perm: "purchase.create", title: "Compras", text: "Facturas y boletas de proveedores; actualizan stock y costo.", href: "/compras" },
  { perm: "report.financial", title: "Reportes", text: "Resultado financiero y cargos." },
  { perm: "user.write", title: "Usuarios", text: "Crear, desactivar, roles y contraseñas temporales.", href: "/usuarios" },
  { perm: "settings.write", title: "Configuración", text: "Datos del comprobante, comisiones, canales y medios de pago.", href: "/configuracion" },
];

export default async function HomePage() {
  const { actor, name } = await requireActor();
  const visible = MODULES.filter((m) => can(actor.role, m.perm));
  const today = can(actor.role, "sale.read.any") ? (await services.sales.listAdmin(actor, {})).totals : await services.reports.sellerToday(actor);
  return (
    <main className="page">
      <h1 style={{ margin: 0 }}>Hola, {name}</h1>
      <p className="sub" style={{ marginTop: 4 }}>{actor.email} · <Link href="/cambiar-clave">Cambiar contraseña</Link></p>
      <p style={{ margin: "0 0 4px" }}>{can(actor.role, "sale.read.any") ? "Ventas de hoy" : "Tus ventas de hoy"}: <strong>{today.count}</strong> · <strong>{peso(today.total)}</strong></p>
      <div className="grid">
        {visible.map((m) => m.href ? (
          <Link className="tile tile-link" key={m.title} href={m.href}><h3>{m.title}</h3><p>{m.text}</p></Link>
        ) : (
          <div className="tile tile-soon" key={m.title}><h3>{m.title} <span className="soon">Próximamente</span></h3><p>{m.text}</p></div>
        ))}
      </div>
    </main>
  );
}
