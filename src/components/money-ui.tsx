"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMoneyStartAction, addMoneyMoveAction, voidMoneyMoveAction, setPaidFromAction } from "@/actions/money.actions";
import { parseMoneyCents } from "@/core/money/parse-money";
import { ACCOUNTS, ACCOUNT_LABEL, PAID_FROM, PAID_FROM_LABEL, type Account, type AccountLine } from "@/domain/money/money";

const clp = (n: number) => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("es-CL");
/** Pesos enteros ("20.000" -> 20000); vacío -> null; inválido -> NaN. */
const pesos = (s: string) => { if (!s.trim()) return null; const c = parseMoneyCents(s); return c === null || c % 100 !== 0 ? NaN : c / 100; };
const HINT: Record<Account, string> = {
  CAJA: "Billetes y monedas en el local.",
  BANCO: "Saldo de la cuenta corriente / vista.",
  MP: "Disponible + por liberar.",
  TUU: "Ventas con tarjeta que TUU todavía no abona (abona ~5 a 7 días después).",
  RAPPI: "Ventas de Rappi que aún no depositan.",
};

/** Tabla por cuenta: lo que debería haber, y (opcional) lo que hay realmente para ver la diferencia. */
export function MoneyTable({ lines, unassigned, total }: { lines: AccountLine[]; unassigned: number; total: number }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [real, setReal] = useState<Record<Account, string>>({ CAJA: "", BANCO: "", MP: "", TUU: "", RAPPI: "" });
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const vals = Object.fromEntries(ACCOUNTS.map((a) => [a, pesos(real[a])])) as Record<Account, number | null>;
  const filled = ACCOUNTS.filter((a) => vals[a] !== null);
  const allOk = filled.length === ACCOUNTS.length && filled.every((a) => Number.isFinite(vals[a]));
  const realTotal = filled.reduce((s, a) => s + (Number.isFinite(vals[a]) ? (vals[a] as number) : 0), 0);
  function restart() {
    if (!allOk) return;
    if (!confirm("¿Usar estos montos como nuevo punto de partida? Desde ahora se suma todo a partir de ellos.")) return;
    setMsg({});
    start(async () => {
      const r = await setMoneyStartAction({ balances: vals as Record<string, number>, note: "Ajuste con saldos reales" });
      if (r.ok) { setMsg({ ok: "Nuevo punto de partida guardado." }); setReal({ CAJA: "", BANCO: "", MP: "", TUU: "", RAPPI: "" }); router.refresh(); } else setMsg({ err: r.error });
    });
  }
  return (
    <div className="formcard" style={{ maxWidth: 1100 }}>
      <div className="tablewrap"><table className="list money-table">
        <thead><tr><th>Cuenta</th><th className="num">Partida</th><th className="num">+ Ventas</th><th className="num">− Comisiones</th><th className="num">− Compras y gastos</th><th className="num">± Traspasos</th><th className="num">= Debería haber</th><th className="num">Tengo</th><th className="num">Diferencia</th></tr></thead>
        <tbody>{lines.map((l) => {
          const v = vals[l.account]; const d = v !== null && Number.isFinite(v) ? (v as number) - l.expected : null;
          return (
            <tr key={l.account}>
              <td><b>{ACCOUNT_LABEL[l.account]}</b><div className="muted small">{HINT[l.account]}</div></td>
              <td className="num">{clp(l.start)}</td><td className="num">{l.sales ? clp(l.sales) : "—"}</td><td className="num">{l.fees ? clp(-l.fees) : "—"}</td>
              <td className="num">{l.outflows ? clp(-l.outflows) : "—"}</td><td className="num">{l.movesIn - l.movesOut ? clp(l.movesIn - l.movesOut) : "—"}</td>
              <td className="num"><b>{clp(l.expected)}</b></td>
              <td className="num"><input className="money" value={real[l.account]} onChange={(e) => setReal({ ...real, [l.account]: e.target.value })} inputMode="numeric" placeholder="$" aria-label={`Lo que tengo en ${ACCOUNT_LABEL[l.account]}`} style={{ width: 110 }} />
                {v !== null && !Number.isFinite(v) && <div className="out small">monto inválido</div>}</td>
              <td className="num">{d === null ? "" : <span className={`pill ${d === 0 ? "pill-ok" : "pill-warn"}`}>{d === 0 ? "Cuadra" : d > 0 ? `Sobra ${clp(d)}` : `Falta ${clp(-d)}`}</span>}</td>
            </tr>);
        })}</tbody>
        <tfoot>
          {unassigned > 0 && <tr><td colSpan={6}>Compras y gastos <b>sin indicar con qué se pagaron</b> (se restan del total)</td><td className="num">{clp(-unassigned)}</td><td></td><td></td></tr>}
          <tr><td colSpan={6}><b>Total</b></td><td className="num"><b>{clp(total)}</b></td><td className="num">{filled.length > 0 ? <b>{clp(realTotal)}</b> : ""}</td>
            <td className="num">{allOk ? <span className={`pill ${realTotal - total === 0 ? "pill-ok" : "pill-warn"}`}>{realTotal === total ? "Cuadra" : realTotal > total ? `Sobra ${clp(realTotal - total)}` : `Falta ${clp(total - realTotal)}`}</span> : ""}</td></tr>
        </tfoot>
      </table></div>
      <div className="actions">
        <span className="muted small">Escribe cuánto tienes en cada lugar para comparar (no se guarda).</span>
        <button className="btn" type="button" onClick={restart} disabled={!allOk || pending} title="Completa las 5 cuentas">{pending ? "Guardando…" : "Usar lo que tengo como nuevo punto de partida"}</button>
      </div>
      {msg.ok && <p className="ok" role="status">{msg.ok}</p>}{msg.err && <p className="error" role="alert">{msg.err}</p>}
    </div>
  );
}

/** Primer punto de partida (o uno nuevo): saldos reales contados ahora. */
export function MoneyStartForm() {
  const router = useRouter(); const [pending, start] = useTransition(); const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState<Record<Account, string>>({ CAJA: "", BANCO: "", MP: "", TUU: "", RAPPI: "" }); const [note, setNote] = useState("");
  const vals = Object.fromEntries(ACCOUNTS.map((a) => [a, pesos(v[a]) ?? 0])) as Record<Account, number>;
  const ok = ACCOUNTS.every((a) => Number.isFinite(vals[a]));
  function submit() {
    setErr(null);
    start(async () => { const r = await setMoneyStartAction({ balances: vals, note }); if (r.ok) router.refresh(); else setErr(r.error); });
  }
  return (
    <div className="formcard" style={{ maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>Punto de partida</h2>
      <p className="muted small">Escribe cuánto dinero tienes <b>ahora</b> en cada lugar. Desde este momento el sistema suma ventas y resta compras, gastos y comisiones.</p>
      <div className="fields">
        {ACCOUNTS.map((a) => <div className="field" key={a}><label htmlFor={`ms-${a}`}>{ACCOUNT_LABEL[a]}</label><input id={`ms-${a}`} value={v[a]} onChange={(e) => setV({ ...v, [a]: e.target.value })} inputMode="numeric" placeholder="$0" />
          <p className="hint" style={{ marginTop: 4 }}>{HINT[a]}</p>{!Number.isFinite(vals[a]) && <span className="out small">monto inválido</span>}</div>)}
        <div className="field"><label htmlFor="ms-note">Nota (opcional)</label><input id="ms-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
      </div>
      <div className="actions"><button className="btn btn-primary" type="button" onClick={submit} disabled={!ok || pending}>{pending ? "Guardando…" : `Guardar punto de partida (${clp(ACCOUNTS.reduce((s, a) => s + (Number.isFinite(vals[a]) ? vals[a] : 0), 0))})`}</button></div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

const ENDS: { v: string; l: string }[] = [...ACCOUNTS.map((a) => ({ v: a, l: ACCOUNT_LABEL[a] })), { v: "EXTERNO", l: "Fuera del negocio (personal)" }];
const PRESETS: { l: string; from: string; to: string }[] = [
  { l: "TUU abonó al banco", from: "TUU", to: "BANCO" },
  { l: "Rappi depositó", from: "RAPPI", to: "BANCO" },
  { l: "Retiré de Mercado Pago al banco", from: "MP", to: "BANCO" },
  { l: "Deposité efectivo en el banco", from: "CAJA", to: "BANCO" },
  { l: "Retiro personal (de la caja)", from: "CAJA", to: "EXTERNO" },
  { l: "Retiro personal (del banco)", from: "BANCO", to: "EXTERNO" },
  { l: "Aporte de capital al banco", from: "EXTERNO", to: "BANCO" },
];

export function MoneyMoveForm({ today }: { today: string }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [f, setF] = useState({ preset: "0", from: "TUU", to: "BANCO", amount: "", date: today, note: "" });
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const amount = pesos(f.amount);
  const ok = amount !== null && Number.isFinite(amount) && (amount as number) > 0 && f.from !== f.to;
  function pick(i: string) { const p = PRESETS[Number(i)]; setF({ ...f, preset: i, ...(p ? { from: p.from, to: p.to } : {}) }); }
  function submit() {
    setMsg({});
    start(async () => {
      const r = await addMoneyMoveAction({ date: f.date, from: f.from, to: f.to, amount: amount as number, note: f.note });
      if (r.ok) { setMsg({ ok: "Movimiento registrado." }); setF({ ...f, amount: "", note: "" }); router.refresh(); } else setMsg({ err: r.error });
    });
  }
  return (
    <div className="formcard" style={{ maxWidth: 1000 }}>
      <div className="fields">
        <div className="field"><label htmlFor="mv-p">¿Qué pasó?</label><select id="mv-p" value={f.preset} onChange={(e) => pick(e.target.value)}>{PRESETS.map((p, i) => <option key={i} value={i}>{p.l}</option>)}<option value="x">Otro (elijo origen y destino)</option></select></div>
        <div className="field"><label htmlFor="mv-f">Sale de</label><select id="mv-f" value={f.from} onChange={(e) => setF({ ...f, preset: "x", from: e.target.value })}>{ENDS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></div>
        <div className="field"><label htmlFor="mv-t">Llega a</label><select id="mv-t" value={f.to} onChange={(e) => setF({ ...f, preset: "x", to: e.target.value })}>{ENDS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></div>
        <div className="field"><label htmlFor="mv-a">Monto</label><input id="mv-a" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="numeric" placeholder="$" />{amount !== null && !Number.isFinite(amount) && <span className="out small">monto inválido</span>}</div>
        <div className="field"><label htmlFor="mv-d">Fecha</label><input id="mv-d" type="date" value={f.date} max={today} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div className="field"><label htmlFor="mv-n">Nota (opcional)</label><input id="mv-n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} placeholder="Ej.: abono TUU ID 19202587" /></div>
      </div>
      {f.from === f.to && <p className="out small">El origen y el destino deben ser distintos.</p>}
      <div className="actions"><button className="btn btn-primary" type="button" onClick={submit} disabled={!ok || pending}>{pending ? "Guardando…" : `Registrar${ok ? " " + clp(amount as number) : ""}`}</button></div>
      {msg.ok && <p className="ok" role="status">{msg.ok}</p>}{msg.err && <p className="error" role="alert">{msg.err}</p>}
    </div>
  );
}

export function MoneyMoveVoid({ id }: { id: string }) {
  const router = useRouter(); const [pending, start] = useTransition();
  function go() {
    const reason = prompt("Motivo de la anulación:"); if (!reason) return;
    start(async () => { const r = await voidMoneyMoveAction(id, reason); if (r.ok) router.refresh(); else alert(r.error); });
  }
  return <button className="btn btn-small" type="button" onClick={go} disabled={pending}>{pending ? "…" : "Anular"}</button>;
}

/** Con qué se pagó una compra/gasto (se puede corregir; queda en la bitácora). */
export function PaidFromSelect({ kind, id, value }: { kind: "PURCHASE" | "EXPENSE"; id: string; value: string | null }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [v, setV] = useState(value ?? "");
  function change(nv: string) {
    if (!nv) return; const prev = v; setV(nv);
    start(async () => { const r = await setPaidFromAction(kind, id, nv); if (r.ok) router.refresh(); else { setV(prev); alert(r.error); } });
  }
  return (
    <select value={v} onChange={(e) => change(e.target.value)} disabled={pending} aria-invalid={!v} aria-label="Pagado con" style={{ maxWidth: 260 }}>
      {!v && <option value="">⚠ Sin indicar…</option>}
      {PAID_FROM.map((k) => <option key={k} value={k}>{PAID_FROM_LABEL[k]}</option>)}
    </select>
  );
}
