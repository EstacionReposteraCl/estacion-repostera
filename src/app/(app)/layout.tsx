import Link from "next/link";
import Image from "next/image";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { signOutAction } from "@/actions/auth.actions";
import { MainNav } from "@/components/main-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor, name } = await requireActor();
  const nav = [
    { href: "/", label: "Inicio", show: true },
    { href: "/ventas/nueva", label: "Caja", show: can(actor.role, "sale.create") },
    { href: "/ventas", label: can(actor.role, "sale.read.any") ? "Ventas" : "Mis ventas", show: can(actor.role, "sale.read.own_today") },
    { href: "/caja/cierre", label: "Cierre", show: can(actor.role, "cash.close") },
    { href: "/productos", label: "Productos", show: can(actor.role, "product.read.public") },
    { href: "/inventario", label: "Inventario", show: can(actor.role, "inventory.adjust") },
    { href: "/compras", label: "Compras", show: can(actor.role, "purchase.read") },
    { href: "/gastos", label: "Gastos", show: can(actor.role, "expense.write") },
    { href: "/reportes", label: "Reportes", show: can(actor.role, "report.financial") },
    { href: "/usuarios", label: "Usuarios", show: can(actor.role, "user.write") },
    { href: "/configuracion", label: "Configuración", show: can(actor.role, "settings.write") },
  ].filter((n) => n.show);
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brandlink"><Image src="/logo-sm.png" alt="" width={29} height={40} priority /><span className="brandtext">Estación <em>Repostera</em></span></Link>
        <MainNav items={nav.map(({ href, label }) => ({ href, label }))} />
        <div className="who">
          <span className="whoname">{name}</span> <span className="badge">{actor.role}</span>
          <form action={signOutAction} style={{ display: "inline", marginLeft: 10 }}>
            <button className="link" type="submit">Salir</button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
