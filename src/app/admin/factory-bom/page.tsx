import { connection } from "next/server";
import Link from "next/link";
import { getPimSession } from "@/lib/pim-audit";
import { listFactoryProducts } from "@/server/factory-bom/list-factory-products";
import { resolveLinkedFinishedGood } from "@/server/factory-bom/resolve-linked-sku";
import { FactoryBomWorkbench } from "./FactoryBomWorkbench";
import { canvas } from "./factory-bom-ui";

export const dynamic = "force-dynamic";

export default async function FactoryBomPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string }>;
}) {
  await connection();
  const session = await getPimSession();
  const params = await searchParams;
  const products = await listFactoryProducts();
  const pending = products.filter(
    (row) => row.reviewStatus === "draft_pending_review",
  ).length;
  const edited = products.filter((row) => row.reviewStatus === "edited").length;
  const approved = products.filter(
    (row) => row.reviewStatus === "factory_approved",
  ).length;
  const initialSku = params.sku?.trim().toUpperCase() || undefined;
  const linkedProduct =
    initialSku && !products.some((row) => row.sku === initialSku)
      ? await resolveLinkedFinishedGood(initialSku)
      : null;

  return (
    <div className={`flex h-screen w-full flex-col font-sans ${canvas}`}>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-100 px-6">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            ← Launchpad
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <h1
            data-testid="factory-bom-title"
            className="text-sm font-semibold uppercase tracking-wide text-slate-800"
          >
            Factory BOM Builder
          </h1>
          <span className="text-xs text-slate-500">
            Draft recipes only — live Katana explode path is untouched until Approve
          </span>
        </div>
        <div
          data-testid="factory-bom-status-banner"
          className="flex items-center gap-4 text-xs text-slate-500"
        >
          <span>{products.length} hub SKUs</span>
          <span className="text-sky-700">{pending} auto</span>
          <span className="text-amber-700">{edited} edited</span>
          <span className="text-emerald-700">{approved} approved</span>
          {session ? (
            <span className="font-mono text-emerald-700">{session.email}</span>
          ) : null}
        </div>
      </header>
      <FactoryBomWorkbench
        products={products}
        initialSku={initialSku}
        linkedProduct={linkedProduct}
      />
    </div>
  );
}
