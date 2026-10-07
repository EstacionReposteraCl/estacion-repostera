import { requireActor } from "@/lib/session";
import { services } from "@/server/container";
import { ProductForm } from "@/components/product-form";

export default async function NewProductPage() {
  const { actor } = await requireActor();
  const opts = await services.products.formOptions(actor);
  return (
    <main className="page">
      <div className="pagehead"><h1>Nuevo producto</h1></div>
      <ProductForm units={opts.units} categories={opts.categories} lockUnit={false}
        values={{ name: "", sku: "", brand: "", categoryId: "", unitCode: "UN", kind: "GOODS", salePrice: "", vatTreatment: "AFECTO", barcodes: "" }} />
    </main>
  );
}
