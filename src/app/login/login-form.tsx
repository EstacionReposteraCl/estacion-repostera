"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

function messageFor(status: number | undefined, code: string | undefined) {
  if (status === 429) return "Demasiados intentos. Espera un minuto y vuelve a intentar.";
  if (code === "BANNED_USER" || status === 403) return "Tu usuario está desactivado. Habla con el administrador.";
  return "Correo o contraseña incorrectos.";
}

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true); setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim().toLowerCase(),
      password: String(form.get("password") ?? ""),
    });
    if (error) { setError(messageFor(error.status, error.code)); setPending(false); return; }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="email">Correo</label>
      <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      <label htmlFor="password">Contraseña</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      <button className="primary" type="submit" disabled={pending}>{pending ? "Ingresando…" : "Ingresar"}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
