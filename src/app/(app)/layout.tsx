import Link from "next/link";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { signOutAction } from "@/actions/auth.actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor, name } = await requireActor();
  const nav = [
    { href: "/", label: "Inicio", show: true },
    { href: "/productos", label: "Productos", show: can(actor.role, "product.read.public") },
    { href: "/inventario", label: "Inventario", show: can(actor.role, "inventory.adjust") },
  ].filter((n) => n.show);
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brandlink">Estación <span>Repostera</span></Link>
        <nav className="mainnav">{nav.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}</nav>
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
