import Link from "next/link";
import { asc } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { raw_materials_catalog } from "@/server/db/schema";
import { RawMaterialsTable } from "./RawMaterialsTable";

export const dynamic = "force-dynamic";

export default async function RawMaterialsPage() {
  const db = getDb();
  const rows = await db
    .select()
    .from(raw_materials_catalog)
    .orderBy(asc(raw_materials_catalog.category), asc(raw_materials_catalog.sku));

  const data = rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    unitOfMeasure: row.unit_of_measure,
    costPerUnit: row.cost_per_unit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const categories = new Set(data.map((row) => row.category));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="w-full px-4 py-10 sm:px-8 xl:px-12">
        <header className="mb-8 pb-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
            CC Patio · Middleware Admin · PIM
          </p>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
                Raw Materials Catalog
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
                Manage fabrics, aluminum, powder coat, and sub-assemblies used in
                Bill of Materials linkage.
              </p>
              <p className="mt-3 text-xs text-zinc-600">
                <Link
                  href="/admin/dictionary"
                  className="text-emerald-400/90 transition hover:text-emerald-300"
                >
                  ← Back to SKU Dictionary
                </Link>
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              <Stat label="Materials" value={String(data.length)} />
              <Stat label="Categories" value={String(categories.size)} />
              <Stat
                label="With cost"
                value={String(data.filter((row) => row.costPerUnit).length)}
              />
            </dl>
          </div>
        </header>

        <RawMaterialsTable rows={data} />
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-1 py-1 sm:px-2">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-xl font-semibold tabular-nums text-zinc-50">
        {value}
      </dd>
    </div>
  );
}
