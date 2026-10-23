// Enlace público para compartir una boleta/factura electrónica (WhatsApp, correo). El enlace va firmado: solo sirve para esa venta.
import { services } from "@/server/container";

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  try {
    const r = await services.dte.publicPdf(ref);
    if (!r) return new Response("Documento no encontrado.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new Response(new Uint8Array(r.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${r.filename}"`, "Cache-Control": "private, max-age=3600", "X-Robots-Tag": "noindex" } });
  } catch {
    return new Response("No se pudo obtener el documento. Intenta de nuevo en unos minutos.", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
