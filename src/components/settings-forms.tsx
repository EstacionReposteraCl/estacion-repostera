"use client";
import { useActionState } from "react";
import { saveBusinessAction, saveFeeRuleAction, saveEntryAction, type SettingsState } from "@/actions/settings.actions";
import type { BusinessSettingsRow, FeeRuleRow, CatalogEntryRow } from "@/repositories/ports";

const Msg = ({ st }: { st: SettingsState }) => st?.error ? <p className="error" role="alert">{st.error}</p> : st?.ok ? <p className="ok" role="status" style={{ marginTop: 10 }}>{st.ok}</p> : null;
const pct = (m: number) => { const i = Math.floor(m / 1000), f = String(m % 1000).padStart(3, "0").replace(/0+$/, ""); return f ? `${i},${f}` : String(i); };

export function BusinessForm({ b: saved }: { b: BusinessSettingsRow }) {
  const [st, action, pending] = useActionState<SettingsState, FormData>(saveBusinessAction, undefined);
  const b = { ...saved, ...(st?.error ? st.values : {}) } as BusinessSettingsRow;
  return (
    <form action={action} className="formcard" key={st?.at ?? 0}>
      <div className="fields">
        <div className="field"><label htmlFor="legalName">Nombre o razón social</label><input id="legalName" name="legalName" defaultValue={b.legalName} required maxLength={120} /></div>
        <div className="field"><label htmlFor="taxId">RUT</label><input id="taxId" name="taxId" defaultValue={b.taxId ?? ""} placeholder="12.345.678-9" /></div>
        <div className="full field"><label htmlFor="address">Dirección</label><input id="address" name="address" defaultValue={b.address ?? ""} maxLength={160} /></div>
        <div className="field"><label htmlFor="phone">Teléfono</label><input id="phone" name="phone" defaultValue={b.phone ?? ""} maxLength={40} /></div>
        <div className="field"><label htmlFor="email">Correo</label><input id="email" name="email" type="email" defaultValue={b.email ?? ""} maxLength={120} /></div>
        <div className="full field"><label htmlFor="receiptFooter">Mensaje al pie del comprobante</label><input id="receiptFooter" name="receiptFooter" defaultValue={b.receiptFooter ?? ""} maxLength={200} placeholder="Ej.: Cambios dentro de 7 días con este comprobante" /></div>
      </div>
      <p className="hint">IVA {b.vatRate} % · Zona horaria {b.timezone}. Los comprobantes ya emitidos conservan los datos con que se emitieron.</p>
      <div className="actions"><button className="btn btn-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar datos del negocio"}</button></div>
      <Msg st={st} />
    </form>
  );
}

function FeeRow({ r }: { r: FeeRuleRow }) {
  const [st, action, pending] = useActionState<SettingsState, FormData>(saveFeeRuleAction, undefined);
  const kept = st?.error ? st.values : undefined;
  const mode = kept?.mode ?? (!r.isActive ? "off" : r.isManualPerSale ? "manual" : "auto");
  return (
    <tr>
      <td><strong>{r.targetName}</strong>{st?.error && <div className="out small">{st.error}</div>}{st?.ok && <div className="small" style={{ color: "var(--accent)" }}>Guardado ✓</div>}</td>
      <td colSpan={4}>
        <form action={action} className="inline" key={st?.at ?? 0}>
          <input type="hidden" name="target" value={r.target} /><input type="hidden" name="targetId" value={r.targetId} /><input type="hidden" name="targetName" value={r.targetName} />
          <input className="qty" name="percent" defaultValue={kept?.percent ?? pct(r.percentMilli)} inputMode="decimal" aria-label={`Porcentaje ${r.targetName}`} /> <span className="muted">%</span>
          <span className="muted">+ $</span><input className="qty" name="fixedAmount" defaultValue={kept?.fixedAmount ?? (r.fixedAmount || "")} inputMode="numeric" placeholder="0" aria-label={`Cargo fijo ${r.targetName}`} />
          <select name="mode" defaultValue={mode} aria-label={`Modo ${r.targetName}`}>
            <option value="auto">Automática al cobrar</option><option value="manual">Manual (la agrego después)</option><option value="off">Sin comisión</option>
          </select>
          <button className="btn btn-small" disabled={pending}>Guardar</button>
        </form>
      </td>
    </tr>
  );
}
export function FeeRulesTable({ rules }: { rules: FeeRuleRow[] }) {
  const group = (t: FeeRuleRow["target"], title: string) => (
    <>
      <tr><th colSpan={5} style={{ background: "var(--surface)" }}>{title}</th></tr>
      {rules.filter((r) => r.target === t).map((r) => <FeeRow key={r.targetId} r={r} />)}
    </>
  );
  return <div className="tablewrap"><table className="list"><tbody>{group("PAYMENT_METHOD", "Medios de pago (se calcula sobre lo pagado con ese medio)")}{group("CHANNEL", "Canales de venta (se calcula sobre el total de la venta)")}</tbody></table></div>;
}

function EntryRow({ e, kind }: { e: CatalogEntryRow; kind: "channel" | "paymentMethod" }) {
  const [st, action, pending] = useActionState<SettingsState, FormData>(saveEntryAction, undefined);
  return (
    <li>
      <form action={action} className="inline" key={st?.at ?? 0}>
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={e.id} />
        <input name="name" defaultValue={st?.error ? st.values?.name : e.name} aria-label={`Nombre de ${e.name}`} style={{ width: 180 }} />
        <label className="inline small" style={{ margin: 0, fontWeight: 400 }}><input type="checkbox" name="isActive" defaultChecked={e.isActive} style={{ width: "auto" }} /> Activo</label>
        <button className="btn btn-small" disabled={pending}>Guardar</button>
        {st?.error && <span className="out small">{st.error}</span>}{st?.ok && <span className="small" style={{ color: "var(--accent)" }}>✓</span>}
      </form>
    </li>
  );
}
export function EntriesList({ items, kind }: { items: CatalogEntryRow[]; kind: "channel" | "paymentMethod" }) {
  return <ul className="entries">{items.map((e) => <EntryRow key={e.id} e={e} kind={kind} />)}</ul>;
}
