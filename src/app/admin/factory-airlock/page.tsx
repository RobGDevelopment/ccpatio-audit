import Link from "next/link";
import { connection } from "next/server";
import { canvas } from "@/app/admin/factory-bom/factory-bom-ui";
import { listPendingAirlockBuilds } from "@/server/factory-bom/airlock-actions";
import { loadChildMeta } from "@/server/factory-bom/intake/child-meta";
import { loadIntakeSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import { AirlockQueue } from "./AirlockQueue";

export const dynamic = "force-dynamic";

export default async function FactoryAirlockPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string }>;
}) {
  await connection();
  const pending = await listPendingAirlockBuilds();

  if (!pending.ok && pending.error === "not_authorized") {
    return (
      <main className={`flex min-h-screen items-center justify-center px-6 ${canvas}`}>
        <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">401 Unauthorized</p>
          <h1 className="mt-2 text-lg font-semibold text-slate-900">Factory Manager session required</h1>
          <p className="mt-2 text-sm text-slate-600">
            Approve and reject are limited to a signed-in Ops Manager or SuperAdmin. The GoHighLevel
            embed key is not that session.
          </p>
        </div>
      </main>
    );
  }

  const builds = pending.ok ? pending.builds : [];
  const schemaPending = !pending.ok && pending.error === "airlock_schema_pending";
  const params = await searchParams;
  const selectedSku = params.sku?.trim().toUpperCase() || "";
  const selected = builds.find((build) => build.rootSku === selectedSku) ?? null;

  let snapshot = null;
  let products: Awaited<ReturnType<typeof loadChildMeta>> = [];
  if (selected) {
    snapshot = await loadIntakeSnapshot(selected.rootSku);
    const skus = Array.from(
      new Set([
        snapshot.rootSku,
        ...snapshot.lines.map((line) => line.child_sku),
        ...snapshot.lines.map((line) => line.parent_sku),
      ]),
    );
    products = await loadChildMeta(skus);
  }

  return (
    <div className={`flex min-h-screen flex-col font-sans ${canvas}`}>
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-6">
        <Link href="/" className="text-sm font-medium text-slate-500 hover:text-slate-800">
          ← Launchpad
        </Link>
        <div className="h-4 w-px bg-slate-200" />
        <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-800">
          Factory Airlock
        </h1>
        <span className="text-xs text-slate-500">{builds.length} waiting for review</span>
      </header>
      <AirlockQueue
        builds={builds}
        schemaPending={schemaPending}
        selected={selected}
        snapshot={snapshot}
        products={products}
      />
    </div>
  );
}
