import { requireActor } from "@/lib/session";
import { services } from "@/server/container";
import { Pos } from "@/components/pos";

export default async function NewSalePage() {
  const { actor } = await requireActor();
  const opts = await services.sales.posOptions(actor);
  return (
    <main className="page page-wide">
      <Pos channels={opts.channels} methods={opts.methods} isAdmin={actor.role === "ADMINISTRADOR"} />
    </main>
  );
}
