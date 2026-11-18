/**
 * P0-2: Heal ACF add-on Hub/Katana rows + Phase 1 null ASM-* variant IDs +
 * Corner Sofa/Chaise -LS/-RS resolution.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/remediate-p0-addons-and-asms.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/remediate-p0-addons-and-asms.ts --apply
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import { explodeBomTree } from "../../src/server/db/queries/bom";
import {
  finished_goods_catalog,
  sku_aliases,
  sku_mappings,
  third_party_sources,
} from "../../src/server/db/schema";
import {
  createIntervalPacer,
  ensureKatanaVariantForSku,
  findVariantById,
  findVariantBySku,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import {
  PHASE1_ADDON_DEFAULTS,
  PHASE1_ADDON_SKUS,
  PHASE1_RESALE_SKUS,
  loadPhase1SowRows,
  uniqueCanonicalSkus,
} from "./enable-phase1-hub-data";

const TMP = join(process.cwd(), "tmp");
const ACTOR = "remediate-p0-addons-and-asms";

/** Facing Woo SKUs → canonical Make SKU (same BOM; facing is Attribute 2). */
export const CORNER_FACING_ALIASES: ReadonlyArray<{
  alias_sku: string;
  canonical_sku: string;
  reason: string;
}> = [
  // Corner Sofa
  { alias_sku: "FIN-BRV-COR-SOF-72X34-LS", canonical_sku: "FIN-BRV-COR-SOF-72X34", reason: "left facing" },
  { alias_sku: "FIN-BRV-COR-SOF-72X34-RS", canonical_sku: "FIN-BRV-COR-SOF-72X34", reason: "right facing" },
  { alias_sku: "FIN-BRV-COR-SOF-84X34-LS", canonical_sku: "FIN-BRV-COR-SOF-84X34", reason: "left facing" },
  { alias_sku: "FIN-BRV-COR-SOF-84X34-RS", canonical_sku: "FIN-BRV-COR-SOF-84X34", reason: "right facing" },
  { alias_sku: "FIN-BRV-COR-SOF-96X34-LS", canonical_sku: "FIN-BRV-COR-SOF-96X34", reason: "left facing" },
  { alias_sku: "FIN-BRV-COR-SOF-96X34-RS", canonical_sku: "FIN-BRV-COR-SOF-96X34", reason: "right facing" },
  // Corner Chaise
  { alias_sku: "FIN-BRV-COR-CHS-72X34-LS", canonical_sku: "FIN-BRV-COR-CHS-72X34", reason: "left facing" },
  { alias_sku: "FIN-BRV-COR-CHS-72X34-RS", canonical_sku: "FIN-BRV-COR-CHS-72X34", reason: "right facing" },
  { alias_sku: "FIN-BRV-COR-CHS-84X34-LS", canonical_sku: "FIN-BRV-COR-CHS-84X34", reason: "left facing" },
  { alias_sku: "FIN-BRV-COR-CHS-84X34-RS", canonical_sku: "FIN-BRV-COR-CHS-84X34", reason: "right facing" },
  // Orientation aliases (34X72 / 34X84)
  { alias_sku: "FIN-BRV-COR-CHS-34X72", canonical_sku: "FIN-BRV-COR-CHS-72X34", reason: "orientation swap" },
  { alias_sku: "FIN-BRV-COR-CHS-34X72-LS", canonical_sku: "FIN-BRV-COR-CHS-72X34", reason: "orientation + left" },
  { alias_sku: "FIN-BRV-COR-CHS-34X72-RS", canonical_sku: "FIN-BRV-COR-CHS-72X34", reason: "orientation + right" },
  { alias_sku: "FIN-BRV-COR-CHS-34X84", canonical_sku: "FIN-BRV-COR-CHS-84X34", reason: "orientation swap" },
  { alias_sku: "FIN-BRV-COR-CHS-34X84-LS", canonical_sku: "FIN-BRV-COR-CHS-84X34", reason: "orientation + left" },
  { alias_sku: "FIN-BRV-COR-CHS-34X84-RS", canonical_sku: "FIN-BRV-COR-CHS-84X34", reason: "orientation + right" },
];

/** Star Leg table height suffixes emitted by the Phase 1 CSV (not in shared barstool list). */
export const TABLE_HEIGHT_ALIASES: ReadonlyArray<{
  alias_sku: string;
  canonical_sku: string;
  reason: string;
}> = [
  { alias_sku: "FIN-BRK-BAR-TAB-36X36-BAR", canonical_sku: "FIN-BRK-BAR-TAB-36X36", reason: "bar height" },
  { alias_sku: "FIN-BRK-BAR-TAB-42X42-BAR", canonical_sku: "FIN-BRK-BAR-TAB-42X42", reason: "bar height" },
  { alias_sku: "FIN-BRK-CNT-TAB-36X36-CNT", canonical_sku: "FIN-BRK-CNT-TAB-36X36", reason: "counter height" },
  { alias_sku: "FIN-BRK-CNT-TAB-42X42-CNT", canonical_sku: "FIN-BRK-CNT-TAB-42X42", reason: "counter height" },
];

type Plan = {
  addons: Array<{
    sku: string;
    name: string;
    tps: boolean;
    vendor_name: string;
    vendor_sku: string;
    wholesale_cost: string;
    hubExists: boolean;
    fgcExists: boolean;
    tpsExists: boolean;
    katanaVariantId: number | null;
  }>;
  nullAsms: string[];
  facingAliases: typeof CORNER_FACING_ALIASES;
};

async function phase1NullAsmSkus(makeSkus: string[]): Promise<string[]> {
  const db = getDb();
  const asmChildren = new Set<string>();
  for (const parent of makeSkus) {
    const rows = await explodeBomTree(parent);
    for (const row of rows) {
      const child = row.child_sku?.trim().toUpperCase();
      if (child?.startsWith("ASM-")) asmChildren.add(child);
    }
  }
  if (asmChildren.size === 0) return [];
  const vids = await db
    .select({
      sku: sku_mappings.global_sku,
      vid: sku_mappings.katana_variant_id,
    })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, [...asmChildren]));
  return vids
    .filter((r) => r.vid == null)
    .map((r) => r.sku)
    .sort();
}

async function buildPlan(): Promise<Plan> {
  const db = getDb();
  const sow = loadPhase1SowRows();
  const makeSkus = uniqueCanonicalSkus(sow).filter(
    (s) => !(PHASE1_RESALE_SKUS as readonly string[]).includes(s),
  );

  const uniqueAddons = [
    ...new Map(
      PHASE1_ADDON_DEFAULTS.map((a) => [
        a.sku,
        {
          sku: a.sku,
          name: a.name,
          tps: a.tps,
          vendor_name: a.vendor_name,
          vendor_sku: a.vendor_sku,
          wholesale_cost: a.wholesale_cost,
        },
      ]),
    ).values(),
  ];

  const hubRows = await db
    .select({
      sku: sku_mappings.global_sku,
      vid: sku_mappings.katana_variant_id,
    })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, uniqueAddons.map((a) => a.sku)));
  const hubBySku = new Map(hubRows.map((r) => [r.sku, r]));

  const fgcRows = await db
    .select({ sku: finished_goods_catalog.global_sku })
    .from(finished_goods_catalog)
    .where(inArray(finished_goods_catalog.global_sku, uniqueAddons.map((a) => a.sku)));
  const fgcSet = new Set(fgcRows.map((r) => r.sku));

  const tpsRows = await db
    .select({ sku: third_party_sources.global_sku })
    .from(third_party_sources)
    .where(inArray(third_party_sources.global_sku, uniqueAddons.map((a) => a.sku)));
  const tpsSet = new Set(tpsRows.map((r) => r.sku));

  const nullAsms = await phase1NullAsmSkus(makeSkus);

  return {
    addons: uniqueAddons.map((a) => {
      const hub = hubBySku.get(a.sku);
      return {
        ...a,
        hubExists: Boolean(hub),
        fgcExists: fgcSet.has(a.sku),
        tpsExists: tpsSet.has(a.sku),
        katanaVariantId: hub?.vid ?? null,
      };
    }),
    nullAsms,
    facingAliases: CORNER_FACING_ALIASES,
  };
}

/**
 * Clear Hub katana_* ids that point at soft-deleted / missing Katana variants,
 * then ensure a live variant exists (create if needed).
 */
async function healAndEnsureKatana(sku: string): Promise<{
  ok: boolean;
  action?: string;
  variantId?: number | null;
  error?: string;
  clearedStale?: boolean;
}> {
  const db = getDb();
  const [mapping] = await db
    .select({
      sku: sku_mappings.global_sku,
      vid: sku_mappings.katana_variant_id,
      mid: sku_mappings.katana_material_id,
      version: sku_mappings.version,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!mapping) {
    return { ok: false, error: `missing hub row for ${sku}` };
  }

  let clearedStale = false;
  let live =
    mapping.vid != null ? await findVariantById(mapping.vid) : null;
  if (!live) {
    live = await findVariantBySku(sku);
  }

  if (mapping.vid != null && !live) {
    await db
      .update(sku_mappings)
      .set({
        katana_variant_id: null,
        katana_material_id: null,
        updated_at: new Date(),
        version: mapping.version + 1,
      })
      .where(eq(sku_mappings.global_sku, sku));
    clearedStale = true;
    console.log(`  cleared stale katana ids for ${sku} (was variant ${mapping.vid})`);
  } else if (live && mapping.vid !== live.id) {
    await db
      .update(sku_mappings)
      .set({
        katana_variant_id: live.id,
        katana_material_id: live.material_id ?? null,
        updated_at: new Date(),
        version: mapping.version + 1,
      })
      .where(eq(sku_mappings.global_sku, sku));
    console.log(`  rebound ${sku} → variant ${live.id}`);
  }

  const ensured = await ensureKatanaVariantForSku(sku);
  if (!ensured.ok) {
    return { ok: false, error: ensured.error, clearedStale };
  }
  return {
    ok: true,
    action: ensured.action,
    variantId: ensured.variantId,
    clearedStale,
  };
}

async function ensureAddonHub(addon: Plan["addons"][number]): Promise<void> {
  const db = getDb();
  if (!addon.hubExists) {
    await db.insert(sku_mappings).values({
      global_sku: addon.sku,
      product_origin: null,
      category: "Add-On",
      item_type: "finished_good",
      original_name: addon.name,
      source_file: ACTOR,
      is_active: true,
      sync_to_woo: false,
      updated_by: ACTOR,
    });
  } else {
    await db
      .update(sku_mappings)
      .set({
        is_active: true,
        item_type: "finished_good",
        original_name: addon.name,
        updated_by: ACTOR,
        updated_at: new Date(),
      })
      .where(eq(sku_mappings.global_sku, addon.sku));
  }

  if (!addon.fgcExists) {
    await db.insert(finished_goods_catalog).values({
      global_sku: addon.sku,
      msrp: "0.00",
      weight: "1.00",
      updated_by: ACTOR,
    });
  }

  if (addon.tps) {
    if (addon.tpsExists) {
      await db
        .update(third_party_sources)
        .set({
          vendor_name: addon.vendor_name,
          vendor_sku: addon.vendor_sku,
          wholesale_cost: addon.wholesale_cost,
          updated_at: new Date(),
        })
        .where(eq(third_party_sources.global_sku, addon.sku));
    } else {
      await db.insert(third_party_sources).values({
        global_sku: addon.sku,
        vendor_name: addon.vendor_name,
        vendor_sku: addon.vendor_sku,
        wholesale_cost: addon.wholesale_cost,
      });
    }
  }
}

async function upsertAliasRows(
  rows: ReadonlyArray<{ alias_sku: string; canonical_sku: string; reason: string }>,
): Promise<number> {
  const db = getDb();
  let n = 0;
  for (const a of rows) {
    const [existing] = await db
      .select({ alias: sku_aliases.alias_sku })
      .from(sku_aliases)
      .where(eq(sku_aliases.alias_sku, a.alias_sku))
      .limit(1);
    if (existing) {
      await db
        .update(sku_aliases)
        .set({ canonical_sku: a.canonical_sku, reason: a.reason })
        .where(eq(sku_aliases.alias_sku, a.alias_sku));
    } else {
      await db.insert(sku_aliases).values({
        alias_sku: a.alias_sku,
        canonical_sku: a.canonical_sku,
        reason: a.reason,
      });
    }
    n += 1;
  }
  return n;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply || process.argv.includes("--dry-run");
  if (apply && process.argv.includes("--dry-run")) {
    throw new Error("Pass only one of --apply or --dry-run");
  }
  mkdirSync(TMP, { recursive: true });

  const plan = await buildPlan();
  const reportPath = join(
    TMP,
    dryRun ? "p0-remediate-dry-run.json" : "p0-remediate-apply.json",
  );

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "apply",
        addonCount: plan.addons.length,
        addonsMissingHub: plan.addons.filter((a) => !a.hubExists).map((a) => a.sku),
        addonsNullVid: plan.addons
          .filter((a) => a.katanaVariantId == null)
          .map((a) => a.sku),
        nullAsmCount: plan.nullAsms.length,
        nullAsms: plan.nullAsms,
        facingAliasCount: plan.facingAliases.length,
        phase1AddonSkus: [...PHASE1_ADDON_SKUS],
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    writeFileSync(reportPath, JSON.stringify({ mode: "dry-run", plan }, null, 2));
    console.log(`wrote ${reportPath}`);
    await closeDb();
    return;
  }

  setKatanaRequestPacer(createIntervalPacer(1300));

  const results: Record<string, unknown> = {
    mode: "apply",
    addons: [] as unknown[],
    asms: [] as unknown[],
    facingAliasesUpserted: 0,
  };

  for (const addon of plan.addons) {
    console.log(`→ addon Hub ${addon.sku}`);
    await ensureAddonHub(addon);
    console.log(`→ addon Katana ${addon.sku}`);
    const ensured = await healAndEnsureKatana(addon.sku);
    (results.addons as unknown[]).push({ sku: addon.sku, ensured });
    if (!ensured.ok) {
      throw new Error(`Addon Katana ensure failed for ${addon.sku}: ${ensured.error}`);
    }
  }

  for (const sku of plan.nullAsms) {
    console.log(`→ ASM heal ${sku}`);
    const ensured = await healAndEnsureKatana(sku);
    (results.asms as unknown[]).push({ sku, ensured });
    if (!ensured.ok) {
      throw new Error(`ASM Katana ensure failed for ${sku}: ${ensured.error}`);
    }
  }

  results.facingAliasesUpserted = await upsertAliasRows(CORNER_FACING_ALIASES);
  results.tableHeightAliasesUpserted = await upsertAliasRows(TABLE_HEIGHT_ALIASES);
  console.log(
    `→ facing aliases upserted: ${results.facingAliasesUpserted}; table height: ${results.tableHeightAliasesUpserted}`,
  );

  // Re-verify
  const verify = await buildPlan();
  results.verify = {
    addonsNullVid: verify.addons
      .filter((a) => a.katanaVariantId == null)
      .map((a) => a.sku),
    nullAsmCount: verify.nullAsms.length,
  };
  if (verify.nullAsms.length > 0) {
    throw new Error(
      `Post-apply still has ${verify.nullAsms.length} null ASM katana_variant_id(s)`,
    );
  }
  const stillNullAddons = verify.addons.filter((a) => a.katanaVariantId == null);
  if (stillNullAddons.length > 0) {
    throw new Error(
      `Post-apply add-ons still null vid: ${stillNullAddons.map((a) => a.sku).join(", ")}`,
    );
  }

  writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`wrote ${reportPath}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        addonsNullVid: (results.verify as { addonsNullVid: string[] }).addonsNullVid,
        nullAsmCount: (results.verify as { nullAsmCount: number }).nullAsmCount,
      },
      null,
      2,
    ),
  );
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
