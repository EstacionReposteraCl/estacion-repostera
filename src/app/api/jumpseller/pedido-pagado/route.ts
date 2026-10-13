// Aviso de Jumpseller "pedido pagado" (webhook). Solo se confía en el N° de pedido: el pedido se vuelve a leer desde la API
// de Jumpseller con nuestras credenciales. La clave ?k= identifica el aviso; si no calza no se hace nada.
import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("k") ?? "";
  let id = 0;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const o = (b && typeof b.order === "object" && b.order ? b.order : b) as Record<string, unknown>;
    id = Number(o.id ?? b.id ?? 0);
  } catch { /* cuerpo vacío o no JSON */ }
  try { if (key && id > 0) await services.webOrders.webhook(key, id); } catch (e) { console.error("webhook jumpseller", id, e instanceof Error ? e.message : e); }
  return NextResponse.json({ ok: true });
}
