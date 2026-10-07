"use client";
import { useState } from "react";
import Link from "next/link";
import { reprintAction } from "@/actions/sales.actions";

/** Primera impresión (venta recién cerrada) no se audita; las siguientes quedan como reimpresión en AuditLog. */
export function ReceiptActions({ saleId, fresh }: { saleId: string; fresh: boolean }) {
  const [printed, setPrinted] = useState(false);
  async function print() {
    if (!fresh || printed) await reprintAction(saleId);
    setPrinted(true); window.print();
  }
  return (
    <div className="actions noprint">
      <button className="btn btn-primary" type="button" onClick={print}>{fresh && !printed ? "Imprimir comprobante" : "Reimprimir"}</button>
      <Link className="btn" href="/ventas/nueva">Nueva venta</Link>
      <Link className="btn" href="/ventas">Ver ventas</Link>
    </div>
  );
}
