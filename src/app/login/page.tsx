import { redirect } from "next/navigation";
import { hasSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await hasSession()) redirect("/");
  return (
    <main className="center">
      <div className="card">
        <h1 className="brand">Estación <span>Repostera</span></h1>
        <p className="sub">Ingresa con tu correo y contraseña.</p>
        <LoginForm />
      </div>
    </main>
  );
}
