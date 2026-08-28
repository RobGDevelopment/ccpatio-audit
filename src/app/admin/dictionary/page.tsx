import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  sku_mappings,
} from "@/server/db/schema";
import { SkuTable, type SkuMappingRow } from "./SkuTable";
import { calculateRowHealth } from "./pim-catalog-utils";
import { getPimSession } from "@/lib/pim-audit";
import Link from "next/link";
import { LogoutButton } from "../LogoutButton";

export const dynamic = "force-dynamic";

export default async function DictionaryPage() {
  const session = await getPimSession();
  const db = getDb();
  const rows = await db
    .select({
      mapping: sku_mappings,
      catalog: finished_goods_catalog,
      bomCount: sql<number>`coalesce((
        select count(*)::int from product_bom pb
        where pb.parent_sku = ${sku_mappings.global_sku}
      ), 0)`.mapWith(Number),
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
    )
    .orderBy(asc(sku_mappings.category), asc(sku_mappings.global_sku));

  const data: SkuMappingRow[] = rows.map(({ mapping, catalog, bomCount }) => ({
    globalSku: mapping.global_sku,
    category: mapping.category,
    itemType: mapping.item_type,
    originalName: mapping.original_name,
    sourceFile: mapping.source_file,
    isActive: mapping.is_active,
    uomPurchase: mapping.uom_purchase,
    uomConsume: mapping.uom_consume,
    baseCost: mapping.base_cost,
    katanaVariantId: mapping.katana_variant_id,
    katanaMaterialId: mapping.katana_material_id,
    wooAttributeSlug: mapping.woo_attribute_slug,
    ghlDropdownValue: mapping.ghl_dropdown_value,
    qboAccounts: mapping.qbo_accounts ?? {},
    attributes:
      mapping.attributes && typeof mapping.attributes === "object"
        ? (mapping.attributes as Record<string, unknown>)
        : {},
    version: mapping.version ?? 1,
    mappingUpdatedAt: mapping.updated_at?.toISOString?.() ?? null,
    mappingUpdatedBy: mapping.updated_by,
    bomComponentCount: Number(bomCount) || 0,
    catalog: catalog
      ? {
          msrp: catalog.msrp,
          cost: catalog.cost,
          length: catalog.length,
          depth: catalog.depth,
          height: catalog.height,
          armHeight: catalog.arm_height,
          sitHeight: catalog.sit_height,
          weight: catalog.weight,
          description: catalog.description,
          imageUrl: catalog.image_url,
          qboItemCode: catalog.qbo_item_code,
          naFields: Array.isArray(catalog.na_fields) ? catalog.na_fields : [],
          updatedAt: catalog.updated_at.toISOString(),
          updatedBy: catalog.updated_by,
        }
      : null,
  }));

  const missingData = data.filter((row) =>
    calculateRowHealth({
      category: row.category,
      itemType: row.itemType,
      originalName: row.originalName,
      globalSku: row.globalSku,
      attributes: row.attributes,
      catalog: row.catalog,
    }).hasMissingData,
  ).length;
  const discontinued = data.filter((row) => !row.isActive).length;
  const catalogCount = data.filter((row) => row.catalog !== null).length;
  const incomplete = missingData;

  return (
    <main className="pim-carbon-shell min-h-screen text-slate-50">
      <div className="w-full px-2 py-4 sm:px-3">
        <header className="pim-glass mb-4 rounded-lg px-4 py-5 sm:px-5">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">
            CC Patio · Enterprise PIM Terminal
          </p>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
                Global E2E SKU Dictionary
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
                Collaborative data terminal for catalog, BOM, and cross-platform
                targets (GHL · QBO · Woo). Inline edits autosave to
                Postgres; live sync across open browsers.
              </p>
              <p className="mt-3 flex flex-wrap items-center gap-4 text-xs">
                <Link
                  href="/"
                  className="text-emerald-400/90 transition hover:text-emerald-300"
                >
                  ← Back to Launchpad
                </Link>
                <a
                  href="/admin/raw-materials"
                  className="text-slate-400 transition hover:text-slate-200"
                >
                  Raw Materials Catalog →
                </a>
                <Link
                  href="/admin/audit"
                  className="text-slate-400 transition hover:text-slate-200"
                >
                  Change log →
                </Link>
                {session ? (
                  <span className="text-slate-500">
                    Signed in as{" "}
                    <span className="font-mono text-emerald-300/90">
                      {session.email}
                    </span>
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:items-end">
              <LogoutButton />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <Stat label="Total SKUs" value={String(data.length)} href="?filter=all" />
              <Stat
                label="PIM catalog"
                value={String(catalogCount)}
                tone={catalogCount > 0 ? "ok" : "warn"}
                href="?filter=catalog"
              />
              <Stat
                label="Missing data"
                value={String(incomplete)}
                tone={incomplete > 0 ? "warn" : "ok"}
                href="?filter=incomplete"
              />
              <Stat
                label="Discontinued"
                value={String(discontinued)}
                tone={discontinued > 0 ? "warn" : "ok"}
                href="?filter=discontinued"
              />
            </dl>
            </div>
          </div>
          <div
            aria-hidden
            className="relative mt-6 h-px w-full overflow-hidden bg-slate-800/80"
          >
            <div className="animate-beam-glide absolute top-0 left-0 h-full w-1/4 bg-linear-to-r from-transparent via-emerald-500/40 to-transparent" />
          </div>
        </header>

        <div className="pim-glass overflow-hidden rounded-lg">
          <SkuTable rows={data} operatorEmail={session?.email ?? null} />
        </div>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "danger" | "warn" | "ok";
  href?: string;
}) {
  const valueClass =
    tone === "danger"
      ? "text-rose-300"
      : tone === "warn"
        ? "text-amber-200"
        : tone === "ok"
          ? "text-emerald-300"
          : "text-slate-50";

  const content = (
    <>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd
        className={`mt-1 font-mono text-xl font-semibold tabular-nums ${valueClass}`}
      >
        {value}
      </dd>
    </>
  );

  const containerClass = "rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-2 transition hover:bg-slate-900/60 cursor-pointer";

  if (href) {
    return (
      <Link href={href} className={containerClass}>
        {content}
      </Link>
    );
  }

  return (
    <div className={containerClass}>
      {content}
    </div>
  );
}
