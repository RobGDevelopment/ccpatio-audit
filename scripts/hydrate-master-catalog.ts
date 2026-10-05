/**
 * Bulk-hydrate the Master Catalog from the product-information workbooks.
 *
 * Sources:
 *   data_migration/Pricing/E-Commerce - Website Product Info.xlsx
 *     Website Products, Website Products w Links,
 *     vividworks_phase1_products, vividworks_phase2_products
 *   data_migration/Pricing/Website Product Info.xlsx
 *     Website Products
 *   docs/data_sheets/Vividworks_Primeview E-Commerce Handoff.xlsx
 *     Phase 1 & 2 Products
 *
 * Fills blank hub arm height, sit height, length, depth, height, and weight,
 * and blank listing marketing copy / construction details. Size siblings
 * inherit copy and arm/sit height from the same product family. Length, depth,
 * height, and weight stay on the exact size row.
 * Sheet weight wins when the cell is present. The workbook Weight column is
 * currently empty, so blank weights fall through to logistics_profiles, then
 * recipe_estimates_draft, then the heuristic mass estimate.
 *
 * DFM hooks (src/lib/freight-utils.ts deriveDfmFreight):
 *   Packaged L/W/H fall back to hub length / depth / height.
 *   Dim weight = (L * W * H) / 139.
 *   Ship mode defaults to LTL when length > 90 or weight > 150
 *   and no ship mode is already stored.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/hydrate-master-catalog.ts
 *   npx dotenv -e .env.local -- tsx scripts/hydrate-master-catalog.ts --dry-run
 */
import { loadEnvConfig } from "@next/env";
import { eq, inArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as xlsx from "xlsx";
import { familyKey, normalizeText } from "../src/lib/ecommerce-roster";
import {
  deriveDfmFreight,
  parseMeasure,
  type DfmFreight,
} from "../src/lib/freight-utils";
import { estimateHeuristicLogistics } from "../src/lib/heuristic-logistics";
import { closeDb, getDb } from "../src/server/db/client";
import {
  catalog_ship_profiles,
  ecommerce_listings,
  finished_goods_catalog,
  logistics_profiles,
  recipe_estimates_draft,
} from "../src/server/db/schema";

loadEnvConfig(process.cwd());

const DRY_RUN = process.argv.includes("--dry-run");
const UPDATED_BY = "hydrate-master-catalog";

const PRICING = path.resolve(process.cwd(), "data_migration/Pricing");
const ECOM_WB = path.join(PRICING, "E-Commerce - Website Product Info.xlsx");
const LEGACY_WB = path.join(PRICING, "Website Product Info.xlsx");
const HANDOFF_WB = path.resolve(
  process.cwd(),
  "docs/data_sheets/Vividworks_Primeview E-Commerce Handoff.xlsx",
);

type ProductFacts = {
  armHeight: string | null;
  sitHeight: string | null;
  length: string | null;
  depth: string | null;
  height: string | null;
  weight: string | null;
  description: string | null;
  details: string | null;
};

const EMPTY_FACTS: ProductFacts = {
  armHeight: null,
  sitHeight: null,
  length: null,
  depth: null,
  height: null,
  weight: null,
  description: null,
  details: null,
};

function requireFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing product information file: ${filePath}`);
  }
}

function isBlank(value: string | null | undefined): boolean {
  if (value == null) return true;
  const text = value.trim();
  return text.length === 0 || /^n\/?a$/i.test(text);
}

function blankToNull(value: string | undefined): string | null {
  if (isBlank(value)) return null;
  return value!.trim();
}

function catalogInches(raw: string | null): string | null {
  const n = parseMeasure(raw);
  if (n == null) return null;
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function longerText(current: string | null, next: string | null): string | null {
  if (!current) return next;
  if (!next) return current;
  return next.length > current.length ? next : current;
}

/**
 * Size rows often leave copy and arm/sit height on the first sibling.
 * Length, depth, height, and weight stay on the exact row — a 96" sofa
 * does not inherit a 72" sofa's weight.
 */
function familyFacts(rows: Map<string, ProductFacts>): Map<string, ProductFacts> {
  const families = new Map<string, ProductFacts>();
  for (const [memo, facts] of rows) {
    const fam = familyKey(memo);
    if (!fam) continue;
    const prev = families.get(fam) ?? EMPTY_FACTS;
    families.set(fam, {
      armHeight: prev.armHeight ?? facts.armHeight,
      sitHeight: prev.sitHeight ?? facts.sitHeight,
      length: null,
      depth: null,
      height: null,
      weight: null,
      description: longerText(prev.description, facts.description),
      details: longerText(prev.details, facts.details),
    });
  }
  return families;
}

function mergeFacts(base: ProductFacts, extra: ProductFacts): ProductFacts {
  return {
    armHeight: base.armHeight ?? extra.armHeight,
    sitHeight: base.sitHeight ?? extra.sitHeight,
    length: base.length ?? extra.length,
    depth: base.depth ?? extra.depth,
    height: base.height ?? extra.height,
    weight: base.weight ?? extra.weight,
    description: base.description ?? extra.description,
    details: base.details ?? extra.details,
  };
}

function readMemoSheet(filePath: string, sheetName: string): Map<string, ProductFacts> {
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found in ${path.basename(filePath)}`);
  const grid = xlsx.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const hIdx = grid.findIndex((row) =>
    row.some((cell) => String(cell).trim() === "Memo/Description"),
  );
  if (hIdx < 0) throw new Error(`No Memo/Description header in ${sheetName}`);
  const header = grid[hIdx].map((cell) => String(cell).trim());
  const col = (name: string) => header.indexOf(name);
  const memoCol = col("Memo/Description");
  const out = new Map<string, ProductFacts>();

  for (let r = hIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    const memo = String(row[memoCol] ?? "").trim();
    if (!memo) continue;
    const cells: Record<string, string> = {};
    header.forEach((name, i) => {
      if (name && !(name in cells)) cells[name] = String(row[i] ?? "").trim();
    });
    const facts: ProductFacts = {
      armHeight: catalogInches(blankToNull(cells["Arm Height"])),
      sitHeight: catalogInches(blankToNull(cells["Sit Height"])),
      length: catalogInches(blankToNull(cells.Length)),
      depth: catalogInches(blankToNull(cells.Depth)),
      height: catalogInches(blankToNull(cells.Height)),
      weight: catalogInches(blankToNull(cells.Weight)),
      description: blankToNull(cells.Description),
      details: blankToNull(cells.Details),
    };
    const key = normalizeText(memo);
    if (!key) continue;
    out.set(key, mergeFacts(out.get(key) ?? EMPTY_FACTS, facts));
  }
  return out;
}

function readVividworks(filePath: string): Map<string, ProductFacts> {
  const wb = xlsx.readFile(filePath);
  const out = new Map<string, ProductFacts>();
  for (const sheetName of ["vividworks_phase1_products", "vividworks_phase2_products"]) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    for (const row of rows) {
      const sku = String(row["Canonical SKU"] ?? "").trim();
      if (!sku) continue;
      const facts: ProductFacts = {
        armHeight: catalogInches(blankToNull(String(row["Arm Height"] ?? ""))),
        sitHeight: catalogInches(blankToNull(String(row["Sit Height"] ?? ""))),
        length: catalogInches(blankToNull(String(row.Length ?? ""))),
        depth: catalogInches(blankToNull(String(row.Depth ?? ""))),
        height: catalogInches(blankToNull(String(row.Height ?? ""))),
        weight: catalogInches(blankToNull(String(row["Base Weight"] ?? ""))),
        description: null,
        details: null,
      };
      out.set(sku, mergeFacts(out.get(sku) ?? EMPTY_FACTS, facts));
    }
  }
  return out;
}

function parseLwh(raw: string | null): Pick<ProductFacts, "length" | "depth" | "height"> {
  if (!raw) return { length: null, depth: null, height: null };
  const nums = [...raw.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]);
  if (nums.length < 3) return { length: null, depth: null, height: null };
  return {
    length: catalogInches(nums[0] ?? null),
    depth: catalogInches(nums[1] ?? null),
    height: catalogInches(nums[2] ?? null),
  };
}

function readHandoff(filePath: string): {
  bySku: Map<string, ProductFacts>;
  byMemo: Map<string, ProductFacts>;
} {
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets["Phase 1 & 2 Products"];
  if (!ws) throw new Error(`Sheet "Phase 1 & 2 Products" not found in ${path.basename(filePath)}`);
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, {
    range: 1,
    defval: "",
  });
  const bySku = new Map<string, ProductFacts>();
  const byMemo = new Map<string, ProductFacts>();
  for (const row of rows) {
    const dims = parseLwh(blankToNull(String(row["Dimensions (LxWxH)"] ?? "")));
    const facts: ProductFacts = {
      armHeight: null,
      sitHeight: null,
      length: dims.length,
      depth: dims.depth,
      height: dims.height,
      weight: catalogInches(blankToNull(String(row["Weight (lbs)"] ?? ""))),
      description: blankToNull(String(row["Marketing Description"] ?? "")),
      details: blankToNull(String(row.Details ?? "")),
    };
    const sku = String(row["Master SKU"] ?? "").trim();
    if (sku) bySku.set(sku, mergeFacts(bySku.get(sku) ?? EMPTY_FACTS, facts));
    const memo = normalizeText(String(row["Website Memo"] ?? ""));
    if (memo) byMemo.set(memo, mergeFacts(byMemo.get(memo) ?? EMPTY_FACTS, facts));
  }
  return { bySku, byMemo };
}

function sameMeasure(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): boolean {
  const a = parseMeasure(left);
  const b = parseMeasure(right);
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.001;
}

function shipUnchanged(
  existing: {
    length_in: string | null;
    width_in: string | null;
    height_in: string | null;
    weight_lb: string | null;
    dim_weight_lb: string | null;
    billable_weight_lb: string | null;
    ship_mode: string | null;
  } | undefined,
  dfm: DfmFreight,
): boolean {
  if (!existing) return false;
  return (
    sameMeasure(existing.length_in, dfm.lengthIn) &&
    sameMeasure(existing.width_in, dfm.widthIn) &&
    sameMeasure(existing.height_in, dfm.heightIn) &&
    sameMeasure(existing.weight_lb, dfm.weightLb) &&
    sameMeasure(existing.dim_weight_lb, dfm.dimWeightLb) &&
    sameMeasure(existing.billable_weight_lb, dfm.billableWeightLb) &&
    (existing.ship_mode || null) === (dfm.shipMode || null)
  );
}

async function main(): Promise<void> {
  for (const filePath of [ECOM_WB, LEGACY_WB, HANDOFF_WB]) requireFile(filePath);
  console.log(`[hydrate] dryRun=${DRY_RUN}`);

  const ecomProducts = readMemoSheet(ECOM_WB, "Website Products");
  const ecomLinks = readMemoSheet(ECOM_WB, "Website Products w Links");
  const legacyProducts = readMemoSheet(LEGACY_WB, "Website Products");
  const vividworks = readVividworks(ECOM_WB);
  const handoff = readHandoff(HANDOFF_WB);

  console.log("[hydrate] workbook rows", {
    ecomProducts: ecomProducts.size,
    ecomLinks: ecomLinks.size,
    legacyProducts: legacyProducts.size,
    vividworks: vividworks.size,
    handoffSkus: handoff.bySku.size,
    handoffMemos: handoff.byMemo.size,
  });

  const ecomFamily = familyFacts(ecomProducts);
  const legacyFamily = familyFacts(legacyProducts);
  const linkFamily = familyFacts(ecomLinks);
  const handoffFamily = familyFacts(handoff.byMemo);

  const db = getDb();
  const listings = await db
    .select({
      id: ecommerce_listings.id,
      globalSku: ecommerce_listings.global_sku,
      productName: ecommerce_listings.product_name,
      marketing: ecommerce_listings.marketing_description,
      details: ecommerce_listings.construction_details,
    })
    .from(ecommerce_listings);

  const skus = [...new Set(listings.map((row) => row.globalSku))];
  if (skus.length === 0) {
    console.log("[hydrate] no ecommerce listings — nothing to update");
    return;
  }

  const [catalogRows, shipRows, logisticsRows, estimateRows] = await Promise.all([
    db
      .select({
        globalSku: finished_goods_catalog.global_sku,
        length: finished_goods_catalog.length,
        depth: finished_goods_catalog.depth,
        height: finished_goods_catalog.height,
        armHeight: finished_goods_catalog.arm_height,
        sitHeight: finished_goods_catalog.sit_height,
        weight: finished_goods_catalog.weight,
      })
      .from(finished_goods_catalog)
      .where(inArray(finished_goods_catalog.global_sku, skus)),
    db
      .select({
        globalSku: catalog_ship_profiles.global_sku,
        length_in: catalog_ship_profiles.length_in,
        width_in: catalog_ship_profiles.width_in,
        height_in: catalog_ship_profiles.height_in,
        weight_lb: catalog_ship_profiles.weight_lb,
        dim_weight_lb: catalog_ship_profiles.dim_weight_lb,
        billable_weight_lb: catalog_ship_profiles.billable_weight_lb,
        ship_mode: catalog_ship_profiles.ship_mode,
      })
      .from(catalog_ship_profiles)
      .where(inArray(catalog_ship_profiles.global_sku, skus)),
    db
      .select({
        sku: logistics_profiles.variant_sku,
        weight: logistics_profiles.weight_lb,
      })
      .from(logistics_profiles)
      .where(inArray(logistics_profiles.variant_sku, skus)),
    db
      .select({
        sku: recipe_estimates_draft.root_sku,
        weight: recipe_estimates_draft.est_weight_lbs,
      })
      .from(recipe_estimates_draft)
      .where(inArray(recipe_estimates_draft.root_sku, skus)),
  ]);

  const catalogBySku = new Map(catalogRows.map((row) => [row.globalSku, row]));
  const shipBySku = new Map(shipRows.map((row) => [row.globalSku, row]));
  const logisticsWeight = new Map(
    logisticsRows.map((row) => [row.sku, catalogInches(row.weight)]),
  );
  const estimateWeight = new Map(
    estimateRows.map((row) => [row.sku, catalogInches(row.weight)]),
  );

  const factsBySku = new Map<string, ProductFacts>();
  const listingPatches: {
    id: string;
    marketing: string | null;
    details: string | null;
  }[] = [];
  let marketingFilled = 0;
  let detailsFilled = 0;
  let unmatchedListings = 0;

  for (const listing of listings) {
    const key = normalizeText(listing.productName);
    const fromMemo = mergeFacts(
      mergeFacts(
        mergeFacts(ecomProducts.get(key) ?? EMPTY_FACTS, legacyProducts.get(key) ?? EMPTY_FACTS),
        ecomLinks.get(key) ?? EMPTY_FACTS,
      ),
      handoff.byMemo.get(key) ?? EMPTY_FACTS,
    );
    const fam = familyKey(listing.productName);
    const fromFamily = fam
      ? mergeFacts(
          mergeFacts(
            mergeFacts(ecomFamily.get(fam) ?? EMPTY_FACTS, legacyFamily.get(fam) ?? EMPTY_FACTS),
            linkFamily.get(fam) ?? EMPTY_FACTS,
          ),
          handoffFamily.get(fam) ?? EMPTY_FACTS,
        )
      : EMPTY_FACTS;
    const fromSku = mergeFacts(
      vividworks.get(listing.globalSku) ?? EMPTY_FACTS,
      handoff.bySku.get(listing.globalSku) ?? EMPTY_FACTS,
    );
    const facts = mergeFacts(mergeFacts(fromMemo, fromFamily), fromSku);
    const hasAny =
      facts.armHeight ||
      facts.sitHeight ||
      facts.length ||
      facts.depth ||
      facts.height ||
      facts.weight ||
      facts.description ||
      facts.details;
    if (!hasAny) unmatchedListings += 1;

    factsBySku.set(listing.globalSku, mergeFacts(factsBySku.get(listing.globalSku) ?? EMPTY_FACTS, facts));

    const marketing = isBlank(listing.marketing) ? facts.description : null;
    const details = isBlank(listing.details) ? facts.details : null;
    if (marketing) marketingFilled += 1;
    if (details) detailsFilled += 1;
    if (marketing || details) {
      listingPatches.push({ id: listing.id, marketing, details });
    }
  }

  type HubPatch = {
    sku: string;
    exists: boolean;
    length?: string;
    depth?: string;
    height?: string;
    armHeight?: string;
    sitHeight?: string;
    weight?: string;
    weightSource: "sheet" | "logistics" | "estimate" | "heuristic" | "unchanged" | "missing";
  };

  const hubPatches: HubPatch[] = [];
  const shipPatches: { sku: string; dfm: DfmFreight; insert: boolean }[] = [];
  const weightCounts = {
    sheet: 0,
    logistics: 0,
    estimate: 0,
    heuristic: 0,
    unchanged: 0,
    missing: 0,
  };
  let armFilled = 0;
  let sitFilled = 0;
  let hubDimsFilled = 0;
  let packagedFromHub = 0;
  let dimWeightWritten = 0;
  let ltlDefaulted = 0;
  const missingWeightSkus: string[] = [];
  const noFreightSkus: string[] = [];

  for (const sku of skus) {
    const existing = catalogBySku.get(sku);
    const facts = factsBySku.get(sku) ?? EMPTY_FACTS;
    const patch: HubPatch = { sku, exists: Boolean(existing), weightSource: "unchanged" };

    if (isBlank(existing?.length) && facts.length) {
      patch.length = facts.length;
      hubDimsFilled += 1;
    }
    if (isBlank(existing?.depth) && facts.depth) patch.depth = facts.depth;
    if (isBlank(existing?.height) && facts.height) patch.height = facts.height;
    if (isBlank(existing?.armHeight) && facts.armHeight) {
      patch.armHeight = facts.armHeight;
      armFilled += 1;
    }
    if (isBlank(existing?.sitHeight) && facts.sitHeight) {
      patch.sitHeight = facts.sitHeight;
      sitFilled += 1;
    }

    let weight = isBlank(existing?.weight) ? null : existing!.weight;
    if (isBlank(weight) && facts.weight) {
      weight = facts.weight;
      patch.weight = facts.weight;
      patch.weightSource = "sheet";
    } else if (isBlank(weight) && logisticsWeight.get(sku)) {
      weight = logisticsWeight.get(sku)!;
      patch.weight = weight;
      patch.weightSource = "logistics";
    } else if (isBlank(weight) && estimateWeight.get(sku)) {
      weight = estimateWeight.get(sku)!;
      patch.weight = weight;
      patch.weightSource = "estimate";
    } else if (isBlank(weight)) {
      const heuristic = estimateHeuristicLogistics(sku);
      if (heuristic.status === "ready") {
        weight = catalogInches(String(heuristic.estimate.weightLb));
        if (weight) {
          patch.weight = weight;
          patch.weightSource = "heuristic";
        }
      }
    }
    if (patch.weight) weightCounts[patch.weightSource as "sheet" | "logistics" | "estimate" | "heuristic"] += 1;
    else if (isBlank(weight)) {
      patch.weightSource = "missing";
      weightCounts.missing += 1;
      missingWeightSkus.push(sku);
    } else {
      weightCounts.unchanged += 1;
    }

    const hubChanged = Boolean(
      patch.length || patch.depth || patch.height || patch.armHeight || patch.sitHeight || patch.weight,
    );
    if (hubChanged) hubPatches.push(patch);

    const hubLength = patch.length ?? existing?.length ?? facts.length;
    const hubDepth = patch.depth ?? existing?.depth ?? facts.depth;
    const hubHeight = patch.height ?? existing?.height ?? facts.height;
    const hubWeight = weight ?? facts.weight;
    const ship = shipBySku.get(sku);
    const dfm = deriveDfmFreight({
      hubLength,
      hubDepth,
      hubHeight,
      hubWeight,
      packagedLength: ship?.length_in,
      packagedWidth: ship?.width_in,
      packagedHeight: ship?.height_in,
      packagedWeight: ship?.weight_lb,
      shipMode: ship?.ship_mode,
    });
    if (shipUnchanged(ship, dfm)) continue;
    if (!dfm.lengthIn && !dfm.widthIn && !dfm.heightIn && !dfm.weightLb && !dfm.shipMode) {
      noFreightSkus.push(sku);
      continue;
    }
    if (dfm.packagedFromHub) packagedFromHub += 1;
    if (dfm.dimWeightLb) dimWeightWritten += 1;
    if (dfm.shipModeDefaultedLtl) ltlDefaulted += 1;
    shipPatches.push({ sku, dfm, insert: !ship });
  }

  const summary = {
    listings: listings.length,
    hubSkus: skus.length,
    unmatchedListings,
    marketingFilled,
    detailsFilled,
    armFilled,
    sitFilled,
    hubDimsFilled,
    weights: weightCounts,
    hubRowsWritten: hubPatches.length,
    shipRowsWritten: shipPatches.length,
    packagedFromHub,
    dimWeightWritten,
    ltlDefaulted,
    missingWeightSkus,
    noFreightSkus,
  };
  console.log("[hydrate] plan", summary);

  if (DRY_RUN) {
    console.log("[hydrate] dry run — nothing written");
    return;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const row of listingPatches) {
      const set: {
        marketing_description?: string;
        construction_details?: string;
        updated_at: Date;
      } = { updated_at: now };
      if (row.marketing) set.marketing_description = row.marketing;
      if (row.details) set.construction_details = row.details;
      await tx.update(ecommerce_listings).set(set).where(eq(ecommerce_listings.id, row.id));
    }

    for (const row of hubPatches) {
      const values = {
        ...(row.length ? { length: row.length } : {}),
        ...(row.depth ? { depth: row.depth } : {}),
        ...(row.height ? { height: row.height } : {}),
        ...(row.armHeight ? { arm_height: row.armHeight } : {}),
        ...(row.sitHeight ? { sit_height: row.sitHeight } : {}),
        ...(row.weight ? { weight: row.weight } : {}),
        updated_by: UPDATED_BY,
        updated_at: now,
      };
      if (!row.exists) {
        await tx.insert(finished_goods_catalog).values({
          global_sku: row.sku,
          ...values,
        });
        continue;
      }
      await tx
        .update(finished_goods_catalog)
        .set(values)
        .where(eq(finished_goods_catalog.global_sku, row.sku));
    }

    for (const row of shipPatches) {
      const values = {
        global_sku: row.sku,
        length_in: row.dfm.lengthIn,
        width_in: row.dfm.widthIn,
        height_in: row.dfm.heightIn,
        weight_lb: row.dfm.weightLb,
        dim_weight_lb: row.dfm.dimWeightLb,
        billable_weight_lb: row.dfm.billableWeightLb,
        ship_mode: (row.dfm.shipMode || null) as
          | "ltl"
          | "parcel"
          | "white_glove_only"
          | "not_shipped"
          | null,
        updated_at: now,
      };
      await tx
        .insert(catalog_ship_profiles)
        .values(values)
        .onConflictDoUpdate({
          target: catalog_ship_profiles.global_sku,
          set: {
            length_in: values.length_in,
            width_in: values.width_in,
            height_in: values.height_in,
            weight_lb: values.weight_lb,
            dim_weight_lb: values.dim_weight_lb,
            billable_weight_lb: values.billable_weight_lb,
            ship_mode: values.ship_mode,
            updated_at: now,
          },
        });
    }
  });

  console.log("[hydrate] wrote", {
    listings: listingPatches.length,
    hubs: hubPatches.length,
    shipProfiles: shipPatches.length,
  });
}

main()
  .catch((err: unknown) => {
    console.error("[hydrate] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
