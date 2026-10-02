/**
 * Surgical purge of bad Katana Materials that block Phase 1 & 2 BOM import.
 *
 * DELETE /materials/{id} ONLY for:
 *   - SA-/ASM-/FIN-/CUT- materials that have a product twin AND are not on
 *     any remaining bom_row (ingredient_variant_id)
 *   - Blank-SKU twins of already-reminted RM-* (2x2 Tubing, Fabric, …)
 *   - Unused blank "Metal ring"
 *
 * NEVER deletes the six Hub remint blanks (Spacers, Flatbar, Foam, …) —
 * those belong to katana-post-missing-materials.ts (PATCH sku + uom).
 * NEVER DELETE /products, /variants, or /items.
 *
 * Dry-run is the default.
 *
 *   npm run ops:katana-purge-bad-materials
 *   npm run ops:katana-purge-bad-materials -- --dry-run
 *   npm run ops:katana-purge-bad-materials -- --confirm
 *   npm run ops:katana-purge-bad-materials -- --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import {
  classifyMaterialForPurge,
  normalizeSku,
  type PurgeAction,
  type PurgeReason,
} from "../../src/lib/katana-material-purge";
import { REQUEST_DELAY_MS, delay, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const explicitDryRun = process.argv.includes("--dry-run");
const confirm = process.argv.includes("--confirm") && !explicitDryRun;
const dryRun = !confirm;

function parseLimit(): number | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return null;
}

const limit = parseLimit();
const PAGE_SIZE = 250;
const MAX_PAGES = 200;

type KatanaVariant = {
  id: number;
  sku?: string | null;
  type?: string | null;
  product_id?: number | null;
  material_id?: number | null;
  deleted_at?: string | null;
  barcode?: string | null;
  config_attributes?: Array<{ key?: string; value?: string }> | null;
};

type KatanaMaterial = {
  id: number;
  name?: string | null;
  is_archived?: boolean | null;
  archived_at?: string | null;
  variants?: KatanaVariant[] | null;
};

type BomRow = {
  id: string;
  ingredientVariantId: number | null;
};

type PlanRow = {
  action: PurgeAction | "blocked" | "deleted" | "would_delete";
  reason: PurgeReason | string;
  material_id: number;
  variant_id: number;
  sku: string;
  name: string;
  barcode: string;
  product_twin_variant_id: string;
  bom_row_count: number;
  status: string;
};

async function paginate<T>(pathBase: string, label: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(
      `${pathBase}${sep}limit=${PAGE_SIZE}&page=${page}`,
    );
    const rows = unwrapList<T>(data);
    all.push(...rows);
    console.log(`  ${label} page ${page}: ${rows.length}`);
    if (rows.length < PAGE_SIZE) return all;
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(
    `Pagination hit ${MAX_PAGES} full pages for ${label} (${all.length} rows). Aborting so a partial list cannot be treated as complete.`,
  );
}

function isArchived(m: KatanaMaterial): boolean {
  if (m.is_archived === true) return true;
  if (m.archived_at != null && String(m.archived_at).trim() !== "") return true;
  return false;
}

function mapBomRow(row: Record<string, unknown>): BomRow | null {
  const id = row.id == null ? "" : String(row.id).trim();
  if (!id) return null;
  const ingredientVariantId = Number(row.ingredient_variant_id);
  return {
    id,
    ingredientVariantId: Number.isFinite(ingredientVariantId)
      ? ingredientVariantId
      : null,
  };
}

function barcodeOf(v: KatanaVariant): string {
  if (v.barcode != null && String(v.barcode).trim() !== "") {
    return String(v.barcode).trim();
  }
  const attrs = v.config_attributes ?? [];
  for (const a of attrs) {
    if ((a.key ?? "").toLowerCase() === "barcode" && a.value) {
      return String(a.value).trim();
    }
  }
  return "";
}

function writeCsv(path: string, headers: string[], rows: string[][]): void {
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    ),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

async function main(): Promise<void> {
  console.log("Katana surgical material purge");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("  verb: DELETE /materials/{id} only (never /products /variants)");
  console.log(
    "  targets: SA-/ASM-/FIN-/CUT- (twin or orphan, bom=0) + blank twins + Metal ring",
  );
  console.log("  protected: 6 Hub remint blanks (Phase B PATCH)");
  console.log("");

  console.log("→ Loading /materials + /variants + /bom_rows");
  const materials = await paginate<KatanaMaterial>(
    "/materials?include_deleted=false",
    "materials",
  );
  await delay(REQUEST_DELAY_MS);
  const variants = await paginate<KatanaVariant>("/variants", "variants");
  await delay(REQUEST_DELAY_MS);
  const bomPayload = await paginate<Record<string, unknown>>(
    "/bom_rows",
    "bom_rows",
  );

  // Product twins by SKU (variant with product_id, same SKU).
  const productVariantIdBySku = new Map<string, number>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(v.sku);
    if (!sku || !Number.isFinite(v.id)) continue;
    if (v.product_id != null && Number.isFinite(Number(v.product_id))) {
      if (!productVariantIdBySku.has(sku)) {
        productVariantIdBySku.set(sku, v.id);
      }
    }
  }

  // bom_rows that reference a material variant as ingredient.
  const bomCountByIngredientVariant = new Map<number, number>();
  const seenBom = new Set<string>();
  for (const raw of bomPayload) {
    const mapped = mapBomRow(raw);
    if (!mapped || seenBom.has(mapped.id)) continue;
    seenBom.add(mapped.id);
    if (mapped.ingredientVariantId == null) continue;
    bomCountByIngredientVariant.set(
      mapped.ingredientVariantId,
      (bomCountByIngredientVariant.get(mapped.ingredientVariantId) ?? 0) + 1,
    );
  }

  type WorkItem = {
    material: KatanaMaterial;
    variant: KatanaVariant;
    sku: string;
    name: string;
    reason: PurgeReason;
    productTwinVariantId: number | null;
    bomRowCount: number;
  };

  const wouldDelete: WorkItem[] = [];
  const skipped: PlanRow[] = [];

  for (const m of materials) {
    if (isArchived(m)) continue;
    const vars = Array.isArray(m.variants) ? m.variants : [];
    for (const v of vars) {
      if (!Number.isFinite(v.id)) continue;
      const sku = normalizeSku(v.sku);
      const name = (m.name ?? "").trim();
      const productTwinId = sku
        ? (productVariantIdBySku.get(sku) ?? null)
        : null;
      // Product twin must be a *different* variant (the product copy).
      const hasProductTwin =
        productTwinId != null && productTwinId !== v.id;
      const bomRowCount = bomCountByIngredientVariant.get(v.id) ?? 0;

      const verdict = classifyMaterialForPurge({
        sku: v.sku,
        name,
        hasProductTwin,
        bomRowCount,
      });

      if (verdict.action === "delete") {
        wouldDelete.push({
          material: m,
          variant: v,
          sku,
          name,
          reason: verdict.reason,
          productTwinVariantId: hasProductTwin ? productTwinId : null,
          bomRowCount,
        });
      } else if (verdict.action === "remint") {
        skipped.push({
          action: "skip",
          reason: verdict.reason,
          material_id: m.id,
          variant_id: v.id,
          sku,
          name,
          barcode: barcodeOf(v),
          product_twin_variant_id: "",
          bom_row_count: bomRowCount,
          status: "protected_for_phase_b_remint",
        });
      } else if (
        verdict.reason === "weldment_on_bom" ||
        verdict.reason === "blank_unknown"
      ) {
        skipped.push({
          action: "skip",
          reason: verdict.reason,
          material_id: m.id,
          variant_id: v.id,
          sku,
          name,
          barcode: barcodeOf(v),
          product_twin_variant_id:
            hasProductTwin && productTwinId != null
              ? String(productTwinId)
              : "",
          bom_row_count: bomRowCount,
          status: "skipped",
        });
      }
      // keep_catalog: omit from skip noise
    }
  }

  wouldDelete.sort((a, b) => {
    const bySku = a.sku.localeCompare(b.sku);
    if (bySku !== 0) return bySku;
    return a.material.id - b.material.id;
  });

  const work =
    limit != null ? wouldDelete.slice(0, limit) : wouldDelete;

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planPath = join(outDir, `katana-purge-bad-materials-${stamp}.csv`);

  const resultRows: PlanRow[] = [];

  console.log("");
  console.log(
    `→ ${dryRun ? "Would delete" : "Deleting"} ${work.length} materials` +
      (limit != null ? ` (limit=${limit}, candidates=${wouldDelete.length})` : ""),
  );

  for (const item of work) {
    const base: PlanRow = {
      action: dryRun ? "would_delete" : "deleted",
      reason: item.reason,
      material_id: item.material.id,
      variant_id: item.variant.id,
      sku: item.sku,
      name: item.name,
      barcode: barcodeOf(item.variant),
      product_twin_variant_id:
        item.productTwinVariantId != null
          ? String(item.productTwinVariantId)
          : "",
      bom_row_count: item.bomRowCount,
      status: dryRun ? "dry_run" : "pending",
    };

    if (dryRun) {
      base.status = "ok";
      resultRows.push(base);
      continue;
    }

    try {
      await katanaFetch(`/materials/${item.material.id}`, {
        method: "DELETE",
      });
      base.action = "deleted";
      base.status = "ok";
      resultRows.push(base);
      console.log(
        `  deleted material #${item.material.id} sku=${item.sku || "(blank)"} name=${item.name}`,
      );
    } catch (e) {
      const detail =
        e instanceof KatanaApiError
          ? `${e.message}${e.details ? ` details=${JSON.stringify(e.details)}` : ""}`
          : e instanceof Error
            ? e.message
            : String(e);
      base.action = "blocked";
      base.status = detail.slice(0, 500);
      resultRows.push(base);
      console.warn(
        `  blocked material #${item.material.id} sku=${item.sku || "(blank)"}: ${detail}`,
      );
    }
    await delay(REQUEST_DELAY_MS);
  }

  // Append skips that matter (remint-protect + weldment/bom/unknown blanks).
  for (const s of skipped) {
    resultRows.push(s);
  }

  writeCsv(
    planPath,
    [
      "action",
      "reason",
      "material_id",
      "variant_id",
      "sku",
      "name",
      "barcode",
      "product_twin_variant_id",
      "bom_row_count",
      "status",
    ],
    resultRows.map((r) => [
      r.action,
      r.reason,
      String(r.material_id),
      String(r.variant_id),
      r.sku,
      r.name,
      r.barcode,
      r.product_twin_variant_id,
      String(r.bom_row_count),
      r.status,
    ]),
  );

  const deleted = resultRows.filter(
    (r) => r.action === "deleted" || r.action === "would_delete",
  ).length;
  const blocked = resultRows.filter((r) => r.action === "blocked").length;
  const remintProtected = resultRows.filter(
    (r) => r.reason === "blank_hub_remint_target",
  ).length;
  const twinDeletes = work.filter(
    (w) =>
      w.reason === "blank_twin_of_reminted_rm" ||
      w.reason === "blank_unused_metal_ring",
  ).length;
  const weldTwinDeletes = work.filter(
    (w) => w.reason === "weldment_with_product_twin",
  ).length;
  const weldOrphanDeletes = work.filter(
    (w) => w.reason === "weldment_orphan_ghost",
  ).length;

  console.log("");
  console.log("Summary");
  console.log(`  candidates (pre-limit): ${wouldDelete.length}`);
  console.log(`  work rows:              ${work.length}`);
  console.log(`    weldment w/ twin:     ${weldTwinDeletes}`);
  console.log(`    weldment orphans:     ${weldOrphanDeletes}`);
  console.log(`    blank twins + ring:   ${twinDeletes}`);
  console.log(`  ${dryRun ? "would_delete" : "deleted"}: ${deleted}`);
  console.log(`  blocked:                ${blocked}`);
  console.log(`  remint-protected:       ${remintProtected}`);
  console.log(`  skip rows logged:       ${skipped.length}`);
  console.log(`  report: ${planPath}`);
  if (dryRun) {
    console.log("");
    console.log("Dry-run only. Re-run with --confirm to DELETE.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
