import { getPimSession } from "@/lib/pim-audit";
import { FactoryBomWorkbench } from "@/app/admin/factory-bom/FactoryBomWorkbench";
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
      <main className="flex h-full min-h-0 flex-1 items-center justify-center bg-zinc-950 px-6 text-sm text-zinc-400">
        Sign in to open the factory BOM builder.
      </main>
    );
  }

  const products = await listFactoryProducts();
  const initialSku = params.sku?.trim().toUpperCase() || undefined;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-zinc-950 font-sans text-zinc-300">
      <FactoryBomWorkbench products={products} initialSku={initialSku} embedded />
    </div>
  );
}
