import Link from "next/link";
import Image from "next/image";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { signOutAction } from "@/actions/auth.actions";
import { MainNav } from "@/components/main-nav";
import { MENU_GROUPS } from "@/lib/menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor, name } = await requireActor();
  // Menú: Inicio + una sección desplegable por grupo (las mismas opciones del Inicio, según el rol).
  const groups = MENU_GROUPS.map((g) => ({ title: g.title, items: g.items.filter((m) => can(actor.role, m.perm)).map((m) => ({ href: m.href, title: m.href === "/ventas" && !can(actor.role, "sale.read.any") ? "Mis ventas" : m.title, text: m.text })) })).filter((g) => g.items.length);
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brandlink"><Image src="/logo-sm.png" alt="" width={29} height={40} priority /><span className="brandtext">Estación <em>Repostera</em></span></Link>
        <MainNav groups={groups} />
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
