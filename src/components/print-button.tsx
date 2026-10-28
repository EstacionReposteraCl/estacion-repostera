"use client";
import { useEffect } from "react";
/** Abre el diálogo de impresión del navegador (ahí también se puede "Guardar como PDF"). */
export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return <button className="btn btn-primary noprint" type="button" onClick={() => window.print()}>🖨 {label}</button>;
}

/** Abre la impresión sola al cargar (después de cobrar con boleta automática). */
export function AutoPrint() {
  useEffect(() => { const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t); }, []);
  return null;
}
