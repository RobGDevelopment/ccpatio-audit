/**
 * Master sync: force Katana material purchase_price + uom to Hub truth.
 *
 * Source of Truth (priority):
 *   1. sku_mappings.base_cost / uom_purchase / uom_consume  (Hub DB)
 *   2. Cost 2025 rate-card fallback via resolveCost2025Price
 *      (FAB $20/yd, PWD $8.64/lb, tubing LF tokens, RM-DKT $8/sqft)
 *   3. KATANA_BULK_MATERIALS seed for the 13 factory placeholders
 *   4. inferMaterialUom for UoM when Hub has no uom columns
 *
 * STN-* colorways: never invent Cost 2025 $8 — that is a $/sqft rate and
 * was the Dekton pricing bug. Only patch price when Hub base_cost is set
 * (e.g. STN-DKT-BC1.2 = $395). Still patch UoM to slab when mismatched.
 *
 * Katana API (verified in this tenant):
 *   PATCH /materials/{id}  { uom }            — never purchase_price
 *   PATCH /variants/{id}   { purchase_price }
 *
 * Dry-run default.
 *
 *   npm run ops:katana-master-sync
 *   npm run ops:katana-master-sync -- --dry-run
 *   npm run ops:katana-master-sync -- --confirm
 *   npm run ops:katana-master-sync -- --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import { KATANA_BULK_MATERIALS } from "../../src/lib/katana-bulk-materials";
import { resolveCost2025Price } from "../../src/lib/katana-material-cost";
import {
  inferMaterialUom,
  toKatanaMaterialUom,
} from "../../src/lib/katana-material-uom";
import { closeDb, getDb } from "../../src/server/db/client";
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
const PRICE_EPS = 0.005;

type HubTruth = {
  sku: string;
  name: string;
  price: number | null;
  priceSource: string;
  uom: string;
  uomSource: string;
};

type KatanaVariant = {
  id: number;
  sku?: string | null;
  purchase_price?: number | null;
  deleted_at?: string | null;
};

type KatanaMaterial = {
  id: number;
  name?: string | null;
  uom?: string | null;
  is_archived?: boolean | null;
  archived_at?: string | null;
  variants?: KatanaVariant[] | null;
};

type SyncAction =
  | "would_patch"
  | "patched"
  | "unchanged"
  | "skipped_no_hub"
  | "failed";

type PlanRow = {
  action: SyncAction;
  sku: string;
  name: string;
  material_id: number;
  variant_id: number;
  kat_price: string;
  hub_price: string;
  price_source: string;
  kat_uom: string;
  hub_uom: string;
  uom_source: string;
  patch_price: boolean;
  patch_uom: boolean;
  status: string;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function isMaterialFamilySku(sku: string): boolean {
  return /^(RM-|MET-|FAB-|PWD-|STN-|DKT-|HRD-|PRM-)/.test(sku);
}

function pricesEqual(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < PRICE_EPS;
}

function uomsEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isArchived(m: KatanaMaterial): boolean {
  if (m.is_archived === true) return true;
  if (m.archived_at != null && String(m.archived_at).trim() !== "") return true;
  return false;
}

async function paginateMaterials(): Promise<KatanaMaterial[]> {
  const all: KatanaMaterial[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await katanaFetch(
      `/materials?limit=${PAGE_SIZE}&page=${page}&include_deleted=false`,
    );
    const rows = unwrapList<KatanaMaterial>(data);
    all.push(...rows);
    console.log(`  materials page ${page}: ${rows.length}`);
    if (rows.length < PAGE_SIZE) return all;
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(
    `Pagination hit ${MAX_PAGES} full pages for materials (${all.length} rows).`,
  );
}

async function loadHubTruth(): Promise<Map<string, HubTruth>> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      global_sku,
      COALESCE(original_name, '') AS name,
      base_cost,
      uom_purchase,
      uom_consume
    FROM sku_mappings
    WHERE item_type = 'raw_material'
       OR global_sku ~ '^(RM-|MET-|FAB-|PWD-|STN-|DKT-|HRD-|PRM-)'
  `);
  const raw = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);

  const map = new Map<string, HubTruth>();

  for (const row of raw) {
    const r = row as Record<string, unknown>;
    const sku = normalizeSku(String(r.global_sku ?? ""));
    if (!sku || !isMaterialFamilySku(sku)) continue;

    const baseCostRaw = r.base_cost;
    let price: number | null = null;
    let priceSource = "none";
    if (baseCostRaw != null && String(baseCostRaw).trim() !== "") {
      const n = Number(baseCostRaw);
      if (Number.isFinite(n)) {
        price = n;
        priceSource = "sku_mappings.base_cost";
      }
    }

    const purchase = String(r.uom_purchase ?? "").trim();
    const consume = String(r.uom_consume ?? "").trim();
    let uomHub = purchase || consume;
    let uomSource = purchase
      ? "sku_mappings.uom_purchase"
      : consume
        ? "sku_mappings.uom_consume"
        : "";

    if (!uomHub) {
      const inferred = inferMaterialUom(sku);
      uomHub = inferred.uom;
      uomSource = `infer:${inferred.rule}`;
    }

    map.set(sku, {
      sku,
      name: String(r.name ?? ""),
      price,
      priceSource,
      uom: toKatanaMaterialUom(uomHub),
      uomSource,
    });
  }

  // Cost 2025 fallback for price gaps (never STN-*)
  for (const [sku, truth] of map) {
    if (truth.price != null) continue;
    if (sku.startsWith("STN-")) continue;
    const rule = resolveCost2025Price(sku);
    if (!rule) continue;
    truth.price = rule.price;
    truth.priceSource = rule.rule;
  }

  // Bulk placeholder seed (only fills still-null fields)
  for (const seed of KATANA_BULK_MATERIALS) {
    const sku = normalizeSku(seed.globalSku);
    const existing = map.get(sku);
    const seedPrice =
      seed.baseCost != null && seed.baseCost.trim() !== ""
        ? Number(seed.baseCost)
        : null;
    if (existing) {
      if (existing.price == null && seedPrice != null && Number.isFinite(seedPrice)) {
        existing.price = seedPrice;
        existing.priceSource = "katana-bulk-materials.baseCost";
      }
      continue;
    }
    map.set(sku, {
      sku,
      name: seed.name,
      price: seedPrice != null && Number.isFinite(seedPrice) ? seedPrice : null,
      priceSource:
        seedPrice != null ? "katana-bulk-materials.baseCost" : "none",
      uom: toKatanaMaterialUom(seed.uomConsume || seed.katanaUom),
      uomSource: "katana-bulk-materials",
    });
  }

  // Ensure Cost 2025 can invent rows for live Katana SKUs not in Hub
  // (filled later when we see live SKUs missing from map).

  return map;
}

function resolveTruthForSku(
  sku: string,
  name: string,
  hub: Map<string, HubTruth>,
): HubTruth {
  const existing = hub.get(sku);
  if (existing) return existing;

  const inferred = inferMaterialUom(sku);
  const rule =
    sku.startsWith("STN-") ? null : resolveCost2025Price(sku);
  const bulk = KATANA_BULK_MATERIALS.find(
    (b) => normalizeSku(b.globalSku) === sku,
  );
  let price: number | null = null;
  let priceSource = "none";
  if (bulk?.baseCost) {
    const n = Number(bulk.baseCost);
    if (Number.isFinite(n)) {
      price = n;
      priceSource = "katana-bulk-materials.baseCost";
    }
  }
  if (price == null && rule) {
    price = rule.price;
    priceSource = rule.rule;
  }

  return {
    sku,
    name: name || bulk?.name || "",
    price,
    priceSource,
    uom: toKatanaMaterialUom(
      bulk ? bulk.uomConsume || bulk.katanaUom : inferred.uom,
    ),
    uomSource: bulk
      ? "katana-bulk-materials"
      : `infer:${inferred.rule}`,
  };
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
  console.log("Katana master material sync (price + UoM)");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("  SoT: sku_mappings → Cost2025 fallback → bulk materials");
  console.log("  PATCH: /materials/{id} uom  |  /variants/{id} purchase_price");
  console.log("  STN-*: price only when Hub base_cost set (no $8 invention)");
  console.log("");

  console.log("→ Loading Hub SoT from sku_mappings");
  const hub = await loadHubTruth();
  console.log(`  hub material SKUs: ${hub.size}`);

  console.log("→ Fetching Katana /materials");
  const materials = await paginateMaterials();

  const plan: PlanRow[] = [];
  const mismatches: PlanRow[] = [];

  for (const m of materials) {
    if (isArchived(m)) continue;
    const vars = Array.isArray(m.variants) ? m.variants : [];
    for (const v of vars) {
      if (!Number.isFinite(v.id)) continue;
      const sku = normalizeSku(v.sku ?? "");
      if (!sku || !isMaterialFamilySku(sku)) continue;

      const truth = resolveTruthForSku(sku, m.name ?? "", hub);
      const katPrice =
        v.purchase_price == null || !Number.isFinite(Number(v.purchase_price))
          ? null
          : Number(v.purchase_price);
      const katUom = (m.uom ?? "").trim();

      const patchUom =
        Boolean(truth.uom) && !uomsEqual(katUom, truth.uom);
      const hasHubPrice = truth.price != null && Number.isFinite(truth.price);
      const patchPrice =
        hasHubPrice && !pricesEqual(katPrice, truth.price);

      if (!patchPrice && !patchUom) {
        if (!hasHubPrice && !truth.uom) {
          plan.push({
            action: "skipped_no_hub",
            sku,
            name: (m.name ?? truth.name).trim(),
            material_id: m.id,
            variant_id: v.id,
            kat_price: katPrice == null ? "" : String(katPrice),
            hub_price: "",
            price_source: truth.priceSource,
            kat_uom: katUom,
            hub_uom: truth.uom,
            uom_source: truth.uomSource,
            patch_price: false,
            patch_uom: false,
            status: "no hub price/uom to compare",
          });
        }
        continue;
      }

      const row: PlanRow = {
        action: dryRun ? "would_patch" : "patched",
        sku,
        name: (m.name ?? truth.name).trim(),
        material_id: m.id,
        variant_id: v.id,
        kat_price: katPrice == null ? "" : String(katPrice),
        hub_price: hasHubPrice ? String(truth.price) : "",
        price_source: truth.priceSource,
        kat_uom: katUom,
        hub_uom: truth.uom,
        uom_source: truth.uomSource,
        patch_price: patchPrice,
        patch_uom: patchUom,
        status: dryRun ? "dry_run" : "pending",
      };
      mismatches.push(row);
    }
  }

  mismatches.sort((a, b) => a.sku.localeCompare(b.sku));
  const work = limit != null ? mismatches.slice(0, limit) : mismatches;

  console.log("");
  console.log(
    `→ ${dryRun ? "Would patch" : "Patching"} ${work.length} mismatch(es)` +
      (limit != null
        ? ` (limit=${limit}, mismatches=${mismatches.length})`
        : ""),
  );

  for (const row of work) {
    if (dryRun) {
      row.status = "dry_run";
      plan.push(row);
      continue;
    }

    try {
      if (row.patch_uom) {
        await katanaFetch(`/materials/${row.material_id}`, {
          method: "PATCH",
          body: { uom: row.hub_uom },
        });
        await delay(REQUEST_DELAY_MS);
      }
      if (row.patch_price) {
        await katanaFetch(`/variants/${row.variant_id}`, {
          method: "PATCH",
          body: { purchase_price: Number(row.hub_price) },
        });
        await delay(REQUEST_DELAY_MS);
      }
      row.action = "patched";
      row.status = "ok";
      plan.push(row);
      console.log(
        `  patched ${row.sku}` +
          (row.patch_uom ? ` uom ${row.kat_uom}→${row.hub_uom}` : "") +
          (row.patch_price
            ? ` price ${row.kat_price || "(null)"}→${row.hub_price}`
            : ""),
      );
    } catch (e) {
      const detail =
        e instanceof KatanaApiError
          ? `${e.message}${e.details ? ` details=${JSON.stringify(e.details)}` : ""}`
          : e instanceof Error
            ? e.message
            : String(e);
      row.action = "failed";
      row.status = detail.slice(0, 500);
      plan.push(row);
      console.warn(`  failed ${row.sku}: ${detail}`);
      await delay(REQUEST_DELAY_MS);
    }
  }

  // Include unchanged mismatches not in work when limited? Only work + failures.
  plan.sort((a, b) => a.sku.localeCompare(b.sku));

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(outDir, `katana-master-sync-${stamp}.csv`);

  writeCsv(
    reportPath,
    [
      "action",
      "sku",
      "name",
      "material_id",
      "variant_id",
      "kat_price",
      "hub_price",
      "price_source",
      "kat_uom",
      "hub_uom",
      "uom_source",
      "patch_price",
      "patch_uom",
      "status",
    ],
    plan.map((r) => [
      r.action,
      r.sku,
      r.name,
      String(r.material_id),
      String(r.variant_id),
      r.kat_price,
      r.hub_price,
      r.price_source,
      r.kat_uom,
      r.hub_uom,
      r.uom_source,
      String(r.patch_price),
      String(r.patch_uom),
      r.status,
    ]),
  );

  const counts = (a: SyncAction) => plan.filter((r) => r.action === a).length;
  const pricePatches = work.filter((r) => r.patch_price).length;
  const uomPatches = work.filter((r) => r.patch_uom).length;

  console.log("");
  console.log("Summary");
  console.log(`  mismatches found:   ${mismatches.length}`);
  console.log(`  work rows:          ${work.length}`);
  console.log(`    patch price:      ${pricePatches}`);
  console.log(`    patch uom:        ${uomPatches}`);
  console.log(`  would_patch:        ${counts("would_patch")}`);
  console.log(`  patched:            ${counts("patched")}`);
  console.log(`  failed:             ${counts("failed")}`);
  console.log(`  report: ${reportPath}`);
  if (dryRun) {
    console.log("");
    console.log("Dry-run only. Re-run with --confirm to PATCH.");
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
