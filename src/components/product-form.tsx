"use client";
import { useActionState } from "react";
import Link from "next/link";
import { saveProductAction, type FormState } from "@/actions/products.actions";

export interface ProductFormValues { id?: string; name: string; sku: string; brand: string; categoryId: string; unitCode: string; kind: "GOODS" | "SERVICE"; salePrice: string; vatTreatment: "AFECTO" | "EXENTO"; barcodes: string }
interface Props { values: ProductFormValues; units: { code: string; name: string }[]; categories: { id: string; name: string }[]; lockUnit: boolean }

export function ProductForm({ values: initial, units, categories, lockUnit }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProductAction, undefined);
  const v = { ...initial, ...(state?.values ?? {}) } as ProductFormValues & { newCategory?: string };
  return (
    <form action={action} className="formcard" key={state?.at ?? 0}>
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="fields">
        <div className="full field"><label htmlFor="name">Nombre</label><input id="name" name="name" defaultValue={v.name} required maxLength={120} /></div>
        <div className="field"><label htmlFor="sku">SKU</label><input id="sku" name="sku" defaultValue={v.sku} required maxLength={40} /></div>
        <div className="field"><label htmlFor="brand">Marca</label><input id="brand" name="brand" defaultValue={v.brand} maxLength={60} /></div>
        <div className="field"><label htmlFor="salePrice">Precio de venta (con IVA)</label><input id="salePrice" name="salePrice" defaultValue={v.salePrice} inputMode="numeric" required /><p className="hint">En pesos, sin decimales. Por unidad de venta.</p></div>
        <div className="field"><label htmlFor="vatTreatment">IVA</label>
          <select id="vatTreatment" name="vatTreatment" defaultValue={v.vatTreatment}><option value="AFECTO">Afecto (19 %)</option><option value="EXENTO">Exento</option></select></div>
        <div className="field"><label htmlFor="categoryId">Categoría</label>
          <select id="categoryId" name="categoryId" defaultValue={v.categoryId}><option value="">Sin categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="newCategory">…o crear categoría nueva</label><input id="newCategory" name="newCategory" defaultValue={v.newCategory ?? ""} placeholder="Ej.: Decoración" maxLength={60} /></div>
        <div className="field"><label htmlFor="unitCode">Unidad de venta</label>
          <select id="unitCode" name="unitCode" defaultValue={v.unitCode} disabled={lockUnit}>{units.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</select>
          {lockUnit && <input type="hidden" name="unitCode" value={v.unitCode} />}
          <p className="hint">{lockUnit ? "No se puede cambiar: el producto ya tiene movimientos de stock." : "Unidad para productos envasados; Kilo/Litro para granel."}</p></div>
        <div className="field"><label htmlFor="kind">Tipo</label>
          <select id="kind" name="kind" defaultValue={v.kind} disabled={lockUnit}><option value="GOODS">Producto con stock</option><option value="SERVICE">Servicio (envío, despacho…)</option></select>
          {lockUnit && <input type="hidden" name="kind" value={v.kind} />}</div>
        <div className="full field"><label htmlFor="barcodes">Códigos de barras</label><input id="barcodes" name="barcodes" defaultValue={v.barcodes} placeholder="Escanea o escribe; varios separados por coma" /><p className="hint">Puedes escanear directamente en este campo.</p></div>
      </div>
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Guardando…" : v.id ? "Guardar cambios" : "Crear producto"}</button>
        <Link className="btn" href="/productos">Volver</Link>
      </div>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
    </form>
  );
}
