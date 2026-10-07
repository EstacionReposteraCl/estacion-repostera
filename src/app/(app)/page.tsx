import Link from "next/link";
import { requireActor } from "@/lib/session";
import { can, type Permission } from "@/core/permissions";

const MODULES: { perm: Permission; title: string; text: string; href?: string }[] = [
  { perm: "product.read.public", title: "Productos", text: "Catálogo, precios, códigos de barras y categorías.", href: "/productos" },
  { perm: "inventory.adjust", title: "Inventario", text: "Stock inicial y ajustes por conteo físico.", href: "/inventario" },
  { perm: "sale.create", title: "Ventas", text: "Caja: buscar o escanear, cobrar y comprobante." },
  { perm: "purchase.create", title: "Compras", text: "Facturas y boletas de proveedores." },
  { perm: "report.financial", title: "Reportes", text: "Resultado financiero y cargos." },
  { perm: "user.write", title: "Usuarios", text: "Crear, desactivar y asignar roles." },
];

export default async function HomePage() {
  const { actor, name } = await requireActor();
  const visible = MODULES.filter((m) => can(actor.role, m.perm));
  return (
    <main className="page">
      <h1 style={{ margin: 0 }}>Hola, {name}</h1>
      <p className="sub" style={{ marginTop: 4 }}>{actor.email} · <Link href="/cambiar-clave">Cambiar contraseña</Link></p>
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
