import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { BomPanel } from "../../BomPanel";
import Link from "next/link";

export default async function BomBuilderPage({
  params,
}: {
  params: { sku: string };
}) {
  const decodedSku = decodeURIComponent(params.sku);

  const db = getDb();
  const mapping = await db.query.sku_mappings.findFirst({
    where: eq(sku_mappings.global_sku, decodedSku),
    columns: { item_type: true },
  });

  if (!mapping) {
    notFound();
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
