import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/core/permissions";
import { services } from "@/server/container";
import { NewUserForm, UserRowActions } from "@/components/users-admin";

const when = (d: Date | null) => (d ? d.toLocaleString("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" }) : null);

export default async function UsersPage() {
  const { actor } = await requireActor();
  if (!can(actor.role, "user.write")) redirect("/");
  const users = await services.users.list(actor);
  return (
    <main className="page">
      <div className="pagehead"><h1>Usuarios</h1></div>
      <h2 className="sect" style={{ marginTop: 0 }}>Nuevo usuario</h2>
      <NewUserForm />
      <h2 className="sect">Usuarios ({users.length})</h2>
      <div className="tablewrap"><table className="list">
        <thead><tr><th>Usuario</th><th className="hide-sm">Último ingreso</th><th>Acciones</th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id} style={u.banned ? { opacity: 0.7 } : undefined}>
            <td><strong>{u.name}</strong>{u.id === actor.userId && <span className="muted small"> (tú)</span>}<div className="muted small">{u.email}</div>
              <span className="badge" style={{ fontSize: "0.65rem" }}>{u.role}</span>{" "}
              {u.banned && <span className="pill pill-warn">Desactivado{u.banReason ? `: ${u.banReason}` : ""}</span>}
              {!u.banned && u.mustChangePassword && <span className="pill">Debe cambiar su contraseña</span>}</td>
            <td className="hide-sm">{when(u.lastLoginAt) ?? <span className="muted">nunca</span>}</td>
            <td><UserRowActions u={{ id: u.id, name: u.name, email: u.email, role: u.role, banned: u.banned, banReason: u.banReason, mustChangePassword: u.mustChangePassword, lastLogin: when(u.lastLoginAt), isMe: u.id === actor.userId }} /></td>
          </tr>))}</tbody>
      </table></div>
      <p className="muted small" style={{ marginTop: 12 }}>No hay registro público: solo un administrador crea cuentas. Desactivar cierra las sesiones y bloquea el ingreso sin borrar el historial. Siempre debe quedar al menos un administrador activo.</p>
    </main>
  );
}
