import Link from "next/link";
import { requireActor } from "@/lib/session";
import { services } from "@/server/container";
import { Pos } from "@/components/pos";
import type { ProductPublicDTO } from "@/dto/product.dto";
import { quoteCode } from "@/domain/quotes/quote";

export default async function NewSalePage({ searchParams }: { searchParams: Promise<{ cot?: string }> }) {
  const { actor } = await requireActor();
  const cot = (await searchParams).cot;
  let initial: { quoteId: string; code: string; lines: { p: ProductPublicDTO; qty: string; price?: string }[]; discount: number; skipped: string[] } | null = null;
  if (cot) {
    const r = await services.quotes.get(actor, cot).catch(() => null);
    if (r && r.quote.status !== "VOID") {
      const q = r.quote; const isAdmin = actor.role === "ADMINISTRADOR";
      const prods = await services.products.publicByIds(actor, q.lines.map((l) => l.productId).filter((x): x is string => !!x));
      const ship = q.lines.some((l) => !l.productId) ? (await services.products.search(actor, "ENV-PRO-PIO", 1))[0] ?? null : null;
      const byId = new Map(prods.map((p) => [p.id, p])); const lines: { p: ProductPublicDTO; qty: string; price?: string }[] = []; const skipped: string[] = [];
      for (const l of q.lines) {
        const p = l.productId ? byId.get(l.productId) : /despacho|env[ií]o/i.test(l.name) ? ship : null;
        if (!p || (!isAdmin && l.unitPrice !== p.salePrice)) { skipped.push(l.name); continue; }
        lines.push({ p, qty: String(l.qty).replace(".", ","), ...(l.unitPrice !== p.salePrice ? { price: String(l.unitPrice) } : {}) });
      }
      initial = { quoteId: q.id, code: quoteCode(q.number), lines, discount: isAdmin ? q.discount : 0, skipped };
    }
  }
  const [opts, cash, auto, tuu] = await Promise.all([services.sales.posOptions(actor), services.cash.status(actor).catch(() => null), services.dte.autoBoleta(actor).catch(() => false), services.tuu.status(actor).catch(() => null)]);
  return (
    <main className="page page-wide">
      {cash && !cash.open && <p className="tile pos-open-hint">La caja no está abierta hoy. <Link href="/caja/cierre">Abrir caja</Link> <span className="muted small">(puedes vender igual)</span></p>}
      <Pos channels={opts.channels} methods={opts.methods} isAdmin={actor.role === "ADMINISTRADOR"} today={opts.today} autoBoleta={auto} tuu={!!tuu?.enabled} channelPrices={opts.channelPrices} initial={initial} />
    </main>
  );
}
