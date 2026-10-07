import { requireActor } from "@/lib/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const { name, mustChangePassword } = await requireActor({ allowPendingPasswordChange: true });
  return (
    <main className="center">
      <div className="card">
        <h1 className="brand">Cambiar contraseña</h1>
        <p className="sub">
          {mustChangePassword ? `Hola, ${name}. Antes de continuar debes elegir una contraseña nueva.` : "Elige una contraseña nueva."}
        </p>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
