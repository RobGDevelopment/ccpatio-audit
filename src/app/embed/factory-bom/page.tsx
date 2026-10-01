import { getPimSession } from "@/lib/pim-audit";
import { FactoryBomWorkbench } from "@/app/admin/factory-bom/FactoryBomWorkbench";
import { canvas } from "@/app/admin/factory-bom/factory-bom-ui";
import { listFactoryProducts } from "@/server/factory-bom/list-factory-products";

export const dynamic = "force-dynamic";

export default async function EmbedFactoryBomPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string }>;
}) {
  const session = await getPimSession();
  const params = await searchParams;
  if (!session) {
    return (
      <main className={`flex h-full min-h-0 flex-1 items-center justify-center px-6 text-sm text-slate-500 ${canvas}`}>
        This embed link is missing a valid access key.
      </main>
    );
  }

  const products = await listFactoryProducts();
  const initialSku = params.sku?.trim().toUpperCase() || undefined;

  return (
    <div className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden font-sans ${canvas}`}>
      <FactoryBomWorkbench products={products} initialSku={initialSku} embedded />
    </div>
  );
}
