"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createUserAction, resetPasswordAction, setRoleAction, deactivateAction, reactivateAction, type UserResult } from "@/actions/users.actions";

export interface UserView { id: string; name: string; email: string; role: "ADMINISTRADOR" | "VENDEDOR"; banned: boolean; banReason: string | null; mustChangePassword: boolean; lastLogin: string | null; isMe: boolean }

function TempBox({ email, temp, onClose }: { email: string; temp: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="tempbox" role="status">
      <p style={{ margin: "0 0 6px" }}>Contraseña temporal para <strong>{email}</strong>. Entrégasela por un canal privado: <strong>no se volverá a mostrar</strong>. Al entrar deberá cambiarla.</p>
      <div className="inline"><code className="temp">{temp}</code>
        <button className="btn btn-small" type="button" onClick={async () => { try { await navigator.clipboard.writeText(temp); setCopied(true); } catch { /* sin portapapeles */ } }}>{copied ? "Copiada ✓" : "Copiar"}</button>
        <button className="link small" type="button" onClick={onClose}>Listo</button></div>
    </div>
  );
}

export function NewUserForm() {
  const router = useRouter(); const [pending, start] = useTransition();
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [role, setRole] = useState<"VENDEDOR" | "ADMINISTRADOR">("VENDEDOR");
  const [err, setErr] = useState<string | null>(null); const [created, setCreated] = useState<{ email: string; temp: string } | null>(null);
  return (
    <div className="formcard">
      {created ? <TempBox email={created.email} temp={created.temp} onClose={() => setCreated(null)} /> : (<>
        <div className="fields">
          <div className="field"><label htmlFor="un">Nombre</label><input id="un" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
          <div className="field"><label htmlFor="ue">Correo (con el que inicia sesión)</label><input id="ue" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="ur">Rol</label><select id="ur" value={role} onChange={(e) => setRole(e.target.value as typeof role)}><option value="VENDEDOR">Vendedor (caja y productos, sin costos)</option><option value="ADMINISTRADOR">Administrador (todo)</option></select></div>
        </div>
        <div className="actions"><button className="btn btn-primary" disabled={pending || name.trim().length < 2 || !email.includes("@")} onClick={() => start(async () => {
          setErr(null); const r = await createUserAction({ name, email, role });
          if (r.ok) { setCreated({ email: email.trim().toLowerCase(), temp: r.temp! }); setName(""); setEmail(""); setRole("VENDEDOR"); router.refresh(); } else setErr(r.error);
        })}>{pending ? "Creando…" : "Crear usuario"}</button></div>
        {err && <p className="error" role="alert">{err}</p>}
      </>)}
    </div>
  );
}

export function UserRowActions({ u }: { u: UserView }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [temp, setTemp] = useState<string | null>(null);
  const run = (fn: () => Promise<UserResult>) => start(async () => { setErr(null); setMsg(null); const r = await fn(); if (!r.ok) setErr(r.error); else { if (r.temp) setTemp(r.temp); if (r.msg) setMsg(r.msg); router.refresh(); } });
  return (
    <div>
      <div className="inline">
        {!u.banned && <select aria-label={`Rol de ${u.name}`} value={u.role} disabled={pending} onChange={(e) => { const r = e.target.value as UserView["role"]; if (confirm(`¿Cambiar el rol de ${u.name} a ${r}?`)) run(() => setRoleAction(u.id, r)); }}>
          <option value="VENDEDOR">Vendedor</option><option value="ADMINISTRADOR">Administrador</option></select>}
        {!u.banned && !u.isMe && <button className="btn btn-small" disabled={pending} onClick={() => { if (confirm(`¿Restablecer la contraseña de ${u.name}? Se cerrarán sus sesiones abiertas.`)) run(() => resetPasswordAction(u.id)); }}>Restablecer contraseña</button>}
        {!u.banned && !u.isMe && <button className="btn btn-small" disabled={pending} onClick={() => { const r = prompt(`Motivo para desactivar a ${u.name}:`); if (r?.trim()) run(() => deactivateAction(u.id, r)); }}>Desactivar</button>}
        {u.banned && <button className="btn btn-small" disabled={pending} onClick={() => run(() => reactivateAction(u.id))}>Reactivar</button>}
      </div>
      {temp && <TempBox email={u.email} temp={temp} onClose={() => setTemp(null)} />}
      {msg && <div className="small" style={{ color: "var(--accent)", marginTop: 4 }}>{msg}</div>}
      {err && <div className="out small" style={{ marginTop: 4 }}>{err}</div>}
    </div>
  );
}
