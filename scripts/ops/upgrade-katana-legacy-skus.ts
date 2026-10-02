/**
 * One-time Katana legacy SKU upgrade — rename variant SKUs to Hub FIN-* standards.
 *
 * Reads tmp/legacy-sku-mapping-proposal.csv. Preserves Katana variant_id /
 * product_id / recipes; only PATCHes the `sku` nametag so native GHL/Zapier
 * POST /sales_orders can resolve FIN-* Master SKUs.
 *
 * Colorway collision rule (Katana SKUs must be unique):
 *   - One primary per Proposed Canonical Hub SKU → exact FIN-* (GHL target)
 *   - Sibling color/flag variants → `${FIN}-${COLOR}` (e.g. FIN-BRV-ARM-LOV-60-BE)
 *
 * Hub claim: after a successful primary PATCH, set sku_mappings.katana_variant_id
 * and upsert channel_sync (katana). Does not rewrite recipes.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/ops/upgrade-katana-legacy-skus.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/upgrade-katana-legacy-skus.ts --confirm
 *
 * Dry-run is the default. --confirm performs live Katana PATCH + Hub writes.
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { katanaFetch } from "../../src/lib/katana";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  channel_sync,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");
const REQUEST_DELAY_MS = 1100;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COLOR_PREF = ["BL", "WH", "BR", "BE", "BO", "GR", "WT"] as const;

type CsvRow = {
  legacySku: string;
  itemName: string;
  matchStatus: string;
  proposedCanonical: string;
  variantId: number;
  matchReason: string;
  modelStem: string;
  collection: string;
};

type UpgradePlan = {
  variantId: number;
  legacySku: string;
  targetSku: string;
  itemName: string;
  isPrimary: boolean;
  proposedCanonical: string;
  matchStatus: string;
};

type ResultRow = UpgradePlan & {
  status: "patched" | "already" | "skipped" | "failed" | "dry-run";
  detail: string;
};

function parseCsv(path: string): CsvRow[] {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    if (cols.length < 5) continue;
    const variantId = Number(cols[4]);
    if (!Number.isFinite(variantId)) continue;
    rows.push({
      legacySku: cols[0]!.trim(),
      itemName: cols[1]!.trim(),
      matchStatus: cols[2]!.trim(),
      proposedCanonical: cols[3]!.trim().toUpperCase(),
      variantId,
      matchReason: (cols[5] ?? "").trim(),
      modelStem: (cols[6] ?? "").trim().toUpperCase(),
      collection: (cols[7] ?? "").trim(),
    });
  }
  return rows;
}

/** Minimal CSV parser supporting quoted fields. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function colorSuffix(legacySku: string, modelStem: string): string | null {
  const full = legacySku.trim().toUpperCase();
  const stem = (modelStem || full).trim().toUpperCase();
  if (full === stem) return null;
  if (full.startsWith(`${stem}-`)) return full.slice(stem.length + 1);
  const parts = full.split("-");
  const last = parts[parts.length - 1] ?? "";
  if (/^(BL|WH|WT|BR|BE|BO|GR|Y|N|YES|NO)$/.test(last)) return last;
  return null;
}

function pickPrimary(rows: CsvRow[]): CsvRow {
  for (const pref of COLOR_PREF) {
    const hit = rows.find(
      (r) => colorSuffix(r.legacySku, r.modelStem) === pref,
    );
    if (hit) return hit;
  }
  const noSuffix = rows.find(
    (r) => colorSuffix(r.legacySku, r.modelStem) == null,
  );
  if (noSuffix) return noSuffix;
  return [...rows].sort((a, b) => a.variantId - b.variantId)[0]!;
}

function buildPlans(rows: CsvRow[]): UpgradePlan[] {
  const byCanonical = new Map<string, CsvRow[]>();
  for (const row of rows) {
    if (!row.proposedCanonical.startsWith("FIN-")) continue;
    const list = byCanonical.get(row.proposedCanonical) ?? [];
    list.push(row);
    byCanonical.set(row.proposedCanonical, list);
  }

  const plans: UpgradePlan[] = [];
  for (const [canonical, group] of byCanonical) {
    const primary = pickPrimary(group);
    const usedTargets = new Set<string>();

    for (const row of group) {
      const isPrimary = row.variantId === primary.variantId;
      let targetSku = canonical;
      if (!isPrimary) {
        const suffix = colorSuffix(row.legacySku, row.modelStem);
        targetSku = suffix
          ? `${canonical}-${suffix}`
          : `${canonical}-V${row.variantId}`;
      }
      // Guarantee uniqueness inside the plan group
      let candidate = targetSku;
      let n = 2;
      while (usedTargets.has(candidate)) {
        candidate = `${targetSku}-${n}`;
        n += 1;
      }
      usedTargets.add(candidate);
      plans.push({
        variantId: row.variantId,
        legacySku: row.legacySku,
        targetSku: candidate,
        itemName: row.itemName,
        isPrimary,
        proposedCanonical: canonical,
        matchStatus: row.matchStatus,
      });
    }
  }

  return plans.sort((a, b) => a.legacySku.localeCompare(b.legacySku));
}

async function getVariantSku(variantId: number): Promise<string | null> {
  try {
    const { data } = await katanaFetch<{ sku?: string | null }>(
      `/variants/${variantId}`,
    );
    return data?.sku?.trim() ?? null;
  } catch {
    return null;
  }
}

async function claimHubOwnership(plan: UpgradePlan): Promise<string> {
  if (!plan.isPrimary) {
    return "sibling-no-hub-claim";
  }

  const db = getDb();
  const sku = plan.proposedCanonical;
  const [existing] = await db
    .select({
      globalSku: sku_mappings.global_sku,
      katanaVariantId: sku_mappings.katana_variant_id,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  if (!existing) {
    await db.insert(sku_mappings).values({
      global_sku: sku,
      category: "Finished Good",
      item_type: "finished_good",
      original_name: plan.itemName || sku,
      source_file: "ops:upgrade-katana-legacy-skus",
      is_active: true,
      sync_to_woo: false,
      sync_to_clover: false,
      katana_variant_id: plan.variantId,
      updated_by: "ops:upgrade-katana-legacy-skus",
      updated_at: new Date(),
    });
  } else if (
    existing.katanaVariantId != null &&
    existing.katanaVariantId !== plan.variantId
  ) {
    return `hub-conflict:existing-variant=${existing.katanaVariantId}`;
  } else {
    await db
      .update(sku_mappings)
      .set({
        katana_variant_id: plan.variantId,
        updated_by: "ops:upgrade-katana-legacy-skus",
        updated_at: new Date(),
      })
      .where(eq(sku_mappings.global_sku, sku));
  }

  await db
    .insert(channel_sync)
    .values({
      global_sku: sku,
      channel: "katana",
      external_id: String(plan.variantId),
      status: "success",
      last_error: null,
      payload_hash: null,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [channel_sync.global_sku, channel_sync.channel],
      set: {
        external_id: String(plan.variantId),
        status: "success",
        last_error: null,
        updated_at: new Date(),
      },
    });

  return existing ? "hub-linked" : "hub-inserted+linked";
}

async function main(): Promise<void> {
  const csvPath = join(process.cwd(), "tmp", "legacy-sku-mapping-proposal.csv");
  console.log("Katana legacy SKU upgrade");
  console.log(`  csv: ${csvPath}`);
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);

  const rows = parseCsv(csvPath);
  const plans = buildPlans(rows);
  const primaries = plans.filter((p) => p.isPrimary).length;
  console.log(
    `  rows=${rows.length} plans=${plans.length} primaries=${primaries} siblings=${plans.length - primaries}`,
  );

  const results: ResultRow[] = [];
  let patched = 0;
  let already = 0;
  let skipped = 0;
  let failed = 0;

  for (const plan of plans) {
    if (!confirm) {
      console.log(
        `  would PATCH ${plan.variantId}: ${plan.legacySku} → ${plan.targetSku}${plan.isPrimary ? " [PRIMARY]" : ""}`,
      );
      results.push({
        ...plan,
        status: "dry-run",
        detail: plan.isPrimary ? "primary" : "sibling",
      });
      continue;
    }

    const current = await getVariantSku(plan.variantId);
    await delay(REQUEST_DELAY_MS);

    if (current == null) {
      console.warn(`  SKIP ${plan.variantId}: variant not readable`);
      skipped += 1;
      results.push({ ...plan, status: "skipped", detail: "variant-missing" });
      continue;
    }

    if (current.toUpperCase() === plan.targetSku.toUpperCase()) {
      console.log(`  already ${plan.targetSku} (variant ${plan.variantId})`);
      already += 1;
      let hubDetail = "no-hub";
      try {
        hubDetail = await claimHubOwnership(plan);
      } catch (error: unknown) {
        hubDetail = `hub-error:${error instanceof Error ? error.message : String(error)}`;
      }
      results.push({ ...plan, status: "already", detail: hubDetail });
      continue;
    }

    try {
      const { data } = await katanaFetch<{ sku?: string | null }>(
        `/variants/${plan.variantId}`,
        {
          method: "PATCH",
          body: { sku: plan.targetSku },
        },
      );
      const after = (data?.sku ?? plan.targetSku).trim().toUpperCase();
      if (after !== plan.targetSku.toUpperCase()) {
        throw new Error(
          `verify failed: expected ${plan.targetSku}, got ${data?.sku}`,
        );
      }

      let hubDetail = "no-hub";
      try {
        hubDetail = await claimHubOwnership(plan);
      } catch (error: unknown) {
        hubDetail = `hub-error:${error instanceof Error ? error.message : String(error)}`;
      }

      patched += 1;
      console.log(
        `  PATCHED ${plan.legacySku} → ${plan.targetSku} (variant ${plan.variantId})${plan.isPrimary ? " [PRIMARY]" : ""} · ${hubDetail}`,
      );
      results.push({ ...plan, status: "patched", detail: hubDetail });
    } catch (error: unknown) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `  FAIL ${plan.variantId} ${plan.legacySku} → ${plan.targetSku}: ${message}`,
      );
      results.push({ ...plan, status: "failed", detail: message });
    }

    await delay(REQUEST_DELAY_MS);
  }

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "katana-legacy-sku-upgrade-results.csv");
  const headers = [
    "Legacy SKU",
    "Target SKU",
    "Katana Variant ID",
    "Is Primary",
    "Proposed Canonical",
    "Status",
    "Detail",
  ];
  const lines = [
    headers.join(","),
    ...results.map((r) =>
      [
        r.legacySku,
        r.targetSku,
        String(r.variantId),
        String(r.isPrimary),
        r.proposedCanonical,
        r.status,
        r.detail,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];
  writeFileSync(outPath, lines.join("\n"), "utf8");

  console.log("\n=== Summary ===");
  if (!confirm) {
    console.log(
      `  DRY-RUN complete: ${plans.length} planned PATCHes (${primaries} primary FIN-* Master SKUs).`,
    );
    console.log("  Re-run with --confirm to apply live Katana + Hub updates.");
  } else {
    console.log(`  Successfully patched: ${patched}`);
    console.log(`  Already at target:    ${already}`);
    console.log(`  Skipped:              ${skipped}`);
    console.log(`  Failed:               ${failed}`);
  }
  console.log(`  Results CSV → ${outPath}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDb();
    } catch {
      /* ignore */
    }
  });
