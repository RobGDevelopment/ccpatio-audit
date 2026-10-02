/**
 * Bulk-update Katana material purchase prices from historical Cost 2025 baselines.
 *
 * Fetches active Materials (GET /materials), matches SKU rules, then
 * PATCH /variants/{id} { purchase_price } — Katana stores purchase price on the
 * variant, not on PATCH /materials/{id} (which rejects purchase_price).
 *
 * Dry-run default. Live: --confirm
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/update-katana-material-costs.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/update-katana-material-costs.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { katanaFetch } from "../../src/lib/katana";
import { resolveCost2025Price } from "../../src/lib/katana-material-cost";
import { REQUEST_DELAY_MS, delay, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");

type PriceRule = {
  rule: string;
  price: number;
  unitNote: string;
};

type MaterialRow = {
  id: number;
  name?: string | null;
  is_archived?: boolean | null;
  archived_at?: string | null;
  variants?: VariantRow[] | null;
};

type VariantRow = {
  id: number;
  sku?: string | null;
  purchase_price?: number | null;
  type?: string | null;
};

type PlanRow = {
  materialId: number;
  materialName: string;
  variantId: number;
  sku: string;
  oldPrice: number | null;
  newPrice: number;
  rule: string;
  unitNote: string;
  action: "would_update" | "updated" | "unchanged" | "failed" | "skipped";
  detail: string;
};

function resolvePrice(skuRaw: string): PriceRule | null {
  return resolveCost2025Price(skuRaw);
}

function isArchived(m: MaterialRow): boolean {
  if (m.is_archived === true) return true;
  if (m.archived_at != null && String(m.archived_at).trim() !== "") return true;
  return false;
}

function pricesEqual(a: number | null, b: number): boolean {
  if (a == null || !Number.isFinite(a)) return false;
  return Math.abs(a - b) < 0.005;
}

async function fetchAllMaterials(): Promise<MaterialRow[]> {
  const all: MaterialRow[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data } = await katanaFetch(
      `/materials?limit=100&page=${page}&include_deleted=false`,
    );
    const rows = unwrapList<MaterialRow>(data);
    all.push(...rows);
    console.log(`  materials page ${page}: ${rows.length}`);
    if (rows.length < 100) break;
    await delay(REQUEST_DELAY_MS);
  }
  return all;
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function writeReport(rows: PlanRow[]): string {
  const dir = join(process.cwd(), "tmp");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "katana-material-cost-updates.csv");
  const header =
    "sku,material_id,variant_id,old_price,new_price,rule,unit,action,detail";
  const lines = [header];
  for (const r of rows) {
    lines.push(
      [
        r.sku,
        r.materialId,
        r.variantId,
        r.oldPrice ?? "",
        r.newPrice,
        csvEscape(r.rule),
        r.unitNote,
        r.action,
        csvEscape(r.detail),
      ].join(","),
    );
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

async function main(): Promise<void> {
  console.log("Katana material cost update (Cost 2025 baselines)");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);
  console.log(
    "  note: purchase_price is patched on /variants/{id} (Katana API)",
  );
  console.log("");

  console.log("→ Fetching materials…");
  const materials = await fetchAllMaterials();
  const active = materials.filter((m) => !isArchived(m));
  console.log(`  active materials: ${active.length} (of ${materials.length})`);

  const plans: PlanRow[] = [];
  let skippedNoVariant = 0;
  let skippedNoRule = 0;
  let matchedVariants = 0;

  for (const mat of active) {
    const variants = Array.isArray(mat.variants) ? mat.variants : [];
    if (variants.length === 0) {
      skippedNoVariant += 1;
      continue;
    }
    for (const v of variants) {
      const sku = String(v.sku ?? "").trim().toUpperCase();
      if (!sku) {
        skippedNoRule += 1;
        continue;
      }
      const hit = resolvePrice(sku);
      if (!hit) {
        skippedNoRule += 1;
        continue;
      }
      matchedVariants += 1;
      const oldPrice =
        v.purchase_price == null ? null : Number(v.purchase_price);
      const unchanged = pricesEqual(oldPrice, hit.price);
      plans.push({
        materialId: mat.id,
        materialName: mat.name ?? "",
        variantId: v.id,
        sku,
        oldPrice: Number.isFinite(oldPrice as number) ? oldPrice : null,
        newPrice: hit.price,
        rule: hit.rule,
        unitNote: hit.unitNote,
        action: unchanged ? "unchanged" : confirm ? "updated" : "would_update",
        detail: unchanged
          ? "already at target price"
          : confirm
            ? "pending"
            : `would PATCH /variants/${v.id} purchase_price=${hit.price}`,
      });
    }
  }

  console.log("");
  console.log(`  matched rule: ${matchedVariants}`);
  console.log(`  skipped (no rule): ${skippedNoRule}`);
  console.log(`  materials w/o variants: ${skippedNoVariant}`);

  const toWrite = plans.filter((p) => p.action !== "unchanged");
  const unchanged = plans.filter((p) => p.action === "unchanged");

  console.log("");
  console.log("→ Planned updates:");
  for (const p of toWrite) {
    console.log(
      `  ${p.sku}  ${p.oldPrice ?? "null"} → ${p.newPrice.toFixed(2)} ${p.unitNote}  [${p.rule}]`,
    );
  }
  if (toWrite.length === 0) {
    console.log("  (none — all matched SKUs already at target prices)");
  }

  if (!confirm) {
    console.log("");
    console.log("========================================");
    console.log("  MATERIAL COST UPDATE SUMMARY (DRY-RUN)");
    console.log("========================================");
    console.log(`  Would update: ${toWrite.length}`);
    console.log(`  Already correct: ${unchanged.length}`);
    console.log(`  Skipped (no matching rule): ${skippedNoRule}`);
    console.log("  Pass --confirm to PATCH purchase_price on variants.");
    console.log("========================================");
    writeReport(plans);
    return;
  }

  console.log("");
  console.log(`→ Applying ${toWrite.length} PATCH(es)…`);
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < toWrite.length; i += 1) {
    const p = toWrite[i]!;
    process.stdout.write(
      `  [${i + 1}/${toWrite.length}] ${p.sku} → ${p.newPrice}… `,
    );
    try {
      await katanaFetch(`/variants/${p.variantId}`, {
        method: "PATCH",
        body: { purchase_price: p.newPrice },
      });
      p.action = "updated";
      p.detail = `PATCH /variants/${p.variantId} purchase_price=${p.newPrice}`;
      updated += 1;
      console.log("OK");
    } catch (e) {
      p.action = "failed";
      p.detail = e instanceof Error ? e.message : String(e);
      failed += 1;
      console.log(`FAIL ${p.detail}`);
    }
    await delay(REQUEST_DELAY_MS);
  }

  const reportPath = writeReport([...toWrite, ...unchanged]);

  console.log("");
  console.log("========================================");
  console.log("  MATERIAL COST UPDATE SUMMARY");
  console.log("========================================");
  console.log(`  Updated: ${updated}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Already correct (skipped write): ${unchanged.length}`);
  console.log(`  No rule (skipped): ${skippedNoRule}`);
  console.log(`  CSV → ${reportPath}`);
  console.log("========================================");

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
