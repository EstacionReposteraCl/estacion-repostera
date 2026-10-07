import { requireActor } from "@/lib/session";
import { can, type Permission } from "@/core/permissions";
import { signOutAction } from "@/actions/auth.actions";

const MODULES: { perm: Permission; title: string; text: string }[] = [
  { perm: "sale.create", title: "Ventas", text: "Cerrar ventas en el local y por canal." },
  { perm: "product.read.public", title: "Productos", text: "Buscar por nombre o código de barras." },
  { perm: "inventory.adjust", title: "Inventario", text: "Saldos, conteos, mermas y correcciones." },
  { perm: "purchase.create", title: "Compras", text: "Facturas y boletas de proveedores." },
  { perm: "report.financial", title: "Reportes", text: "Resultado financiero y cargos." },
  { perm: "user.write", title: "Usuarios", text: "Crear, desactivar y asignar roles." },
];

export default async function HomePage() {
  const { actor, name } = await requireActor();
  const visible = MODULES.filter((m) => can(actor.role, m.perm));
  return (
    <>
      <header className="topbar">
        <strong>Estación Repostera</strong>
        <div className="who">
          {name} · <span className="badge">{actor.role}</span>
          <form action={signOutAction} style={{ display: "inline", marginLeft: 12 }}>
            <button className="link" type="submit">Cerrar sesión</button>
          </form>
        </div>
      </header>
      <main className="page">
        <h1 style={{ margin: 0 }}>Hola, {name}</h1>
        <p className="sub" style={{ marginTop: 4 }}>{actor.email} · <a href="/cambiar-clave">Cambiar contraseña</a></p>
        <div className="grid">
          {visible.map((m) => (
            <div className="tile" key={m.title}>
              <h3>{m.title}</h3>
              <p>{m.text}</p>
            </div>
          ))}
        </div>
        <p className="note">Primera versión: inicio de sesión y roles. Las pantallas de cada módulo se construyen en las siguientes etapas.</p>
      </main>
    </>
  );
}
