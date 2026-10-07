"use client";
/** Abre el diálogo de impresión del navegador (ahí también se puede "Guardar como PDF"). */
export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return <button className="btn btn-primary noprint" type="button" onClick={() => window.print()}>🖨 {label}</button>;
}
