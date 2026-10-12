"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectJumpsellerAction } from "@/actions/shipping.actions";

export function JumpsellerConnectForm({ login }: { login: string | null }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [v, setV] = useState({ login: login ?? "", token: "" }); const [err, setErr] = useState<string | null>(null);
  return (
    <div className="formcard" style={{ maxWidth: 640 }}>
      <h2 className="sect" style={{ marginTop: 0 }}>Conectar Jumpseller</h2>
      <ol className="small" style={{ paddingLeft: 18, marginTop: 0 }}>
        <li>En el panel de Jumpseller entra a <b>Configuración → API</b> (o <b>Cuenta</b>, según tu panel).</li>
        <li>Copia el <b>Login</b> y el <b>Token</b> (Auth Token) y pégalos aquí.</li>
        <li>El token se guarda cifrado y solo se usa para leer tus pedidos.</li>
      </ol>
      <div className="fields">
        <div className="field"><label htmlFor="js-login">Login de la API</label><input id="js-login" value={v.login} onChange={(e) => setV({ ...v, login: e.target.value })} autoComplete="off" /></div>
        <div className="field"><label htmlFor="js-token">Token de la API</label><input id="js-token" type="password" value={v.token} onChange={(e) => setV({ ...v, token: e.target.value })} autoComplete="new-password" /></div>
      </div>
      <div className="actions"><button className="btn btn-primary" type="button" disabled={pending || !v.login.trim() || !v.token.trim()} onClick={() => start(async () => {
        setErr(null); const r = await connectJumpsellerAction(v.login, v.token); if (r.ok) { setV({ ...v, token: "" }); router.refresh(); } else setErr(r.error);
      })}>{pending ? "Comprobando…" : "Conectar"}</button></div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
