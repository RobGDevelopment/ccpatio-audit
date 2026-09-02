import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { BomPanel } from "../../BomPanel";
import Link from "next/link";

export default async function BomBuilderPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const resolvedParams = await params;
  const decodedSku = decodeURIComponent(resolvedParams.sku);


  const db = getDb();
  const mappingResult = await db.select({ item_type: sku_mappings.item_type })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, decodedSku))
    .limit(1);

  const mapping = mappingResult[0];

  if (!mapping) {
    return (
      <div className="flex h-screen w-full flex-col bg-zinc-950 font-sans text-zinc-300 p-8">
        <div>Parent SKU {decodedSku} not found in the database.</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col bg-zinc-950 font-sans text-zinc-300 overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-6 bg-zinc-950">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/dictionary"
            className="text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            &larr; Back to Dictionary
          </Link>
          <div className="h-4 w-px bg-zinc-800" />
          <h2 className="text-sm font-semibold tracking-wide text-zinc-100 uppercase">
            Build Recipe
          </h2>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        <BomPanel productSku={decodedSku} itemType={mapping.item_type} />
      </main>
    </div>
  );
}
