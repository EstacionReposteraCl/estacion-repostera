import Link from "next/link";
import { requireActor } from "@/lib/session";
import { services } from "@/server/container";
import { Pos } from "@/components/pos";

export default async function NewSalePage() {
  const { actor } = await requireActor();
  const [opts, cash] = await Promise.all([services.sales.posOptions(actor), services.cash.status(actor).catch(() => null)]);
  return (
    <main className="page page-wide">
      {cash && !cash.open && <p className="tile pos-open-hint">La caja no está abierta hoy. <Link href="/caja/cierre">Abrir caja</Link> <span className="muted small">(puedes vender igual)</span></p>}
      <Pos channels={opts.channels} methods={opts.methods} isAdmin={actor.role === "ADMINISTRADOR"} today={opts.today} />
    </main>
  );
}
