import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { product_intake, sku_mappings } from "@/server/db/schema";
import { getPimSession } from "@/lib/pim-audit";
import {
  flattenDraftBom,
  parseDraftProduct,
} from "@/server/sketchup/draft-bom";
import {
  QuarantineClient,
  type QuarantineDetail,
  type QuarantineListItem,
} from "./QuarantineClient";

export const dynamic = "force-dynamic";

function productNameFromPayload(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const product = (raw as { product?: unknown }).product;
  if (!product || typeof product !== "object") return null;
  const name = (product as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export default async function QuarantinePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getPimSession();
  const params = await searchParams;
  const db = getDb();

  const rows = await db
    .select()
    .from(product_intake)
    .where(eq(product_intake.status, "quarantined"))
    .orderBy(desc(product_intake.created_at));

  const items: QuarantineListItem[] = rows.map((row) => ({
    exportId: row.export_id,
    proposedSku: row.proposed_sku,
    createdBy: row.created_by,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    productName: productNameFromPayload(row.raw_payload),
  }));

  const selectedId =
    params.id?.trim() || (items.length > 0 ? items[0].exportId : null);

  let selected: QuarantineDetail | null = null;
  if (selectedId) {
    const row = rows.find((r) => r.export_id === selectedId);
    if (row) {
      const hubRows = await db
        .select({ sku: sku_mappings.global_sku })
        .from(sku_mappings);
      const hubSkus = new Set(hubRows.map((r) => r.sku));
      const draft = parseDraftProduct(row.raw_payload, hubSkus);
      const missingSkuCount = draft
        ? flattenDraftBom(draft.subassemblies).filter((n) => !n.existsInHub)
            .length
        : 0;

      selected = {
        exportId: row.export_id,
        proposedSku: row.proposed_sku,
        createdBy: row.created_by,
        version: row.version,
        createdAt: row.created_at.toISOString(),
        productName: productNameFromPayload(row.raw_payload),
        rawPayload: row.raw_payload,
        draft,
        missingSkuCount,
      };
    }
  }

  return (
    <main className="pim-carbon-shell min-h-screen text-zinc-50">
      <div className="w-full px-2 py-4 sm:px-3">
        <header className="pim-glass mb-4 rounded-lg px-4 py-5 sm:px-5">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-500">
            CC Patio · MDM Quarantine
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
            Product Intake Quarantine
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Review SketchUp exports, set MSRP/SEO, then Approve to mint hub SKUs
            and enqueue <code className="text-zinc-300">product.approved</code>.
            No Katana/Woo/Clover calls happen on Approve.
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <Link
              href="/"
              className="text-emerald-400/90 transition hover:text-emerald-300"
            >
              ← Back to Launchpad
            </Link>
            <Link
              href="/admin/dictionary"
              className="text-zinc-400 transition hover:text-zinc-200"
            >
              SKU Dictionary →
            </Link>
            {session ? (
              <span className="text-zinc-500">
                Signed in as{" "}
                <span className="font-mono text-emerald-300/90">
                  {session.email}
                </span>
              </span>
            ) : null}
          </p>
        </header>

        <QuarantineClient items={items} selected={selected} />
      </div>
    </main>
  );
}
