import Link from "next/link";
import { getPimSession } from "@/lib/pim-audit";
import { listFactoryProducts } from "./actions";
import { FactoryBomWorkbench } from "./FactoryBomWorkbench";

export const dynamic = "force-dynamic";

export default async function FactoryBomPage() {
  const session = await getPimSession();
  const products = await listFactoryProducts();
  const pending = products.filter(
    (row) => row.reviewStatus === "draft_pending_review",
  ).length;
  const edited = products.filter((row) => row.reviewStatus === "edited").length;
  const approved = products.filter(
    (row) => row.reviewStatus === "factory_approved",
  ).length;

  return (
    <div className="flex h-screen w-full flex-col bg-zinc-950 font-sans text-zinc-300">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-6">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-sm font-medium text-zinc-400 hover:text-zinc-200"
          >
            ← Launchpad
          </Link>
          <div className="h-4 w-px bg-zinc-800" />
          <h1 className="text-sm font-semibold uppercase tracking-wide text-zinc-100">
            Factory BOM Builder
          </h1>
          <span className="text-xs text-zinc-500">
            Draft recipes only — live Katana explode path is untouched until Approve
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span>{products.length} hub SKUs</span>
          <span className="text-sky-300">{pending} auto</span>
          <span className="text-amber-200">{edited} edited</span>
          <span className="text-emerald-300">{approved} approved</span>
          {session ? (
            <span className="font-mono text-emerald-300/80">{session.email}</span>
          ) : null}
        </div>
      </header>
      <FactoryBomWorkbench products={products} />
    </div>
  );
}
