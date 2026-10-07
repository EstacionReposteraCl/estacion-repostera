"use client";
import { useActionState } from "react";
import { changePasswordAction, type ChangePasswordState } from "@/actions/auth.actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePasswordAction, undefined);
  return (
    <form action={action}>
      <label htmlFor="currentPassword">Contraseña actual</label>
      <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      <label htmlFor="newPassword">Nueva contraseña (mínimo 10 caracteres)</label>
      <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={10} required />
      <label htmlFor="confirm">Repite la nueva contraseña</label>
      <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      <button className="primary" type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</button>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
    </form>
  );
}
