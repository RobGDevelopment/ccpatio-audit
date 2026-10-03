/**
 * Fill empty FIN-* logistics rows from the heuristic estimator.
 *
 * Dry run (default) prints processed, ready, and skipped. Nothing is written.
 *   npx dotenv -e .env.local -- tsx scripts/admin/seed-heuristic-logistics.ts
 *
 * Write packaged dims, weight, NMFC class, and a default lead time:
 *   npx dotenv -e .env.local -- tsx scripts/admin/seed-heuristic-logistics.ts --confirm
 *
 * Only rows with weight_lb IS NULL and variant_sku LIKE 'FIN-%' are eligible.
 * An existing lead time is left in place.
 */
import { loadEnvConfig } from "@next/env";
import { and, inArray, isNull, sql } from "drizzle-orm";
import {
  DEFAULT_LEAD_TIME_DAYS,
  estimateHeuristicLogistics,
  logisticsPhysicsFromReadings,
  type HeuristicLogisticsEstimate,
  type PhysicsReading,
} from "../../src/lib/heuristic-logistics";
import { RM_FAB_GENERIC, RM_FOAM } from "../../src/lib/heuristic-bom";
import {
  RM_MET_15X075,
  RM_MET_2X2,
  RM_MET_FLATBAR,
} from "../../src/lib/level2-bom";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  logistics_profiles,
  material_physics_factors,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const CHUNK = 100;
const SAMPLE_LIMIT = 8;
const PHYSICS_SKUS = [
  RM_MET_2X2,
  RM_MET_15X075,
  RM_MET_FLATBAR,
  RM_FOAM,
  RM_FAB_GENERIC,
] as const;

const confirm = process.argv.includes("--confirm");
const dryRun = !confirm || process.argv.includes("--dry-run");

type Candidate = {
  id: string;
  variantSku: string;
};

type ReadyRow = Candidate & {
  estimate: HeuristicLogisticsEstimate;
};

type SkippedRow = {
  sku: string;
  reason: string;
};

function measure(value: number): string {
  return value.toFixed(4);
}

function numOrNull(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function attrWeightPlf(
  attributes: Record<string, unknown> | null,
): number | null {
  if (!attributes) return null;
  const raw = attributes.weight_plf;
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  const raw = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  return raw.filter(
    (row): row is Record<string, unknown> =>
      row != null && typeof row === "object",
  );
}

async function loadPhysics(
  db: ReturnType<typeof getDb>,
): Promise<ReturnType<typeof logisticsPhysicsFromReadings>> {
  const factorRows = await db
    .select({
      materialSku: material_physics_factors.material_sku,
      profileCode: material_physics_factors.profile_code,
      weightPlf: material_physics_factors.weight_plf,
      densityPcf: material_physics_factors.density_pcf,
      ozPerYd2: material_physics_factors.oz_per_yd2,
      fabricWidthIn: material_physics_factors.fabric_width_in,
    })
    .from(material_physics_factors);

  const attrRows = await db
    .select({
      globalSku: sku_mappings.global_sku,
      attributes: sku_mappings.attributes,
    })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, [...PHYSICS_SKUS]));

  const attrBySku = new Map<string, number | null>();
  for (const row of attrRows) {
    attrBySku.set(row.globalSku, attrWeightPlf(row.attributes));
  }

  const readings: PhysicsReading[] = factorRows.map((row) => ({
    materialSku: row.materialSku,
    profileCode: row.profileCode,
    weightPlf: numOrNull(row.weightPlf),
    densityPcf: numOrNull(row.densityPcf),
    ozPerYd2: numOrNull(row.ozPerYd2),
    fabricWidthIn: numOrNull(row.fabricWidthIn),
    attrWeightPlf: attrBySku.get(row.materialSku) ?? null,
  }));

  const seen = new Set(readings.map((row) => row.materialSku));
  for (const sku of PHYSICS_SKUS) {
    if (seen.has(sku)) continue;
    const attr = attrBySku.get(sku) ?? null;
    if (attr == null) continue;
    readings.push({
      materialSku: sku,
      profileCode: "",
      weightPlf: null,
      densityPcf: null,
      ozPerYd2: null,
      fabricWidthIn: null,
      attrWeightPlf: attr,
    });
  }

  return logisticsPhysicsFromReadings(readings);
}

async function updateChunk(
  db: ReturnType<typeof getDb>,
  rows: readonly ReadyRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = sql.join(
    rows.map(
      (row) =>
        sql`(
          CAST(${row.id} AS uuid),
          CAST(${measure(row.estimate.packagedLengthIn)} AS numeric),
          CAST(${measure(row.estimate.packagedWidthIn)} AS numeric),
          CAST(${measure(row.estimate.packagedHeightIn)} AS numeric),
          CAST(${measure(row.estimate.weightLb)} AS numeric),
          ${row.estimate.ltlClass},
          CAST(${DEFAULT_LEAD_TIME_DAYS} AS integer)
        )`,
    ),
    sql`, `,
  );

  const result = await db.execute(sql`
    UPDATE logistics_profiles AS lp
    SET
      length_in = v.length_in,
      width_in = v.width_in,
      height_in = v.height_in,
      weight_lb = v.weight_lb,
      ltl_class = v.ltl_class,
      lead_time_days = COALESCE(lp.lead_time_days, v.lead_time_days),
      updated_at = now()
    FROM (
      VALUES ${values}
    ) AS v(id, length_in, width_in, height_in, weight_lb, ltl_class, lead_time_days)
    WHERE lp.id = v.id
      AND lp.weight_lb IS NULL
      AND lp.variant_sku LIKE 'FIN-%'
    RETURNING lp.variant_sku
  `);
  return rowsOf(result).length;
}

function printSamples(ready: readonly ReadyRow[]): void {
  const sample = ready.slice(0, SAMPLE_LIMIT);
  if (sample.length === 0) return;
  console.log("samples:");
  for (const row of sample) {
    const item = row.estimate;
    console.log(
      `  ${item.variantSku}  product ${item.lengthIn} x ${item.widthIn} x ${item.heightIn}  packed ${item.packagedLengthIn} x ${item.packagedWidthIn} x ${item.packagedHeightIn}  ${measure(item.weightLb)} lb  class ${item.ltlClass}`,
    );
  }
  if (ready.length > sample.length) {
    console.log(`  … ${ready.length - sample.length} more ready`);
  }
}

function printSkips(skipped: readonly SkippedRow[]): void {
  const counts = new Map<string, number>();
  for (const row of skipped) {
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  }
  if (counts.size === 0) return;
  console.log("skip reasons:");
  for (const [reason, count] of [...counts.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    console.log(`  ${reason}: ${count}`);
  }
  const listed = skipped.slice(0, SAMPLE_LIMIT);
  for (const row of listed) {
    console.log(`  ${row.sku}  ${row.reason}`);
  }
  if (skipped.length > listed.length) {
    console.log(`  … ${skipped.length - listed.length} more skipped`);
  }
}

async function main(): Promise<void> {
  console.log("Heuristic logistics seeder");
  console.log(`  mode: ${dryRun ? "dry-run" : "confirm"}`);

  const db = getDb();
  try {
    const physics = await loadPhysics(db);
    console.log(
      `  physics lb/ft: 2x2=${physics.tube2x2Plf} slat=${physics.slatPlf} flat=${physics.flatbarPlf} foam=${physics.foamDensityPcf} pcf`,
    );

    const candidates = await db
      .select({
        id: logistics_profiles.id,
        variantSku: logistics_profiles.variant_sku,
      })
      .from(logistics_profiles)
      .where(
        and(
          isNull(logistics_profiles.weight_lb),
          sql`${logistics_profiles.variant_sku} LIKE 'FIN-%'`,
        ),
      );

    const ready: ReadyRow[] = [];
    const skipped: SkippedRow[] = [];
    for (const row of candidates) {
      const result = estimateHeuristicLogistics(row.variantSku, physics);
      if (result.status === "ready") {
        ready.push({ ...row, estimate: result.estimate });
      } else {
        skipped.push({ sku: result.sku, reason: result.reason });
      }
    }

    console.log(`processed: ${candidates.length}`);
    console.log(`ready: ${ready.length}`);
    console.log(`skipped: ${skipped.length}`);
    printSamples(ready);
    printSkips(skipped);

    if (dryRun) {
      console.log("Dry run. No rows written. Pass --confirm to update.");
      return;
    }

    let updated = 0;
    for (let offset = 0; offset < ready.length; offset += CHUNK) {
      const chunk = ready.slice(offset, offset + CHUNK);
      updated += await updateChunk(db, chunk);
      console.log(
        `  chunk ${Math.floor(offset / CHUNK) + 1}: ${chunk.length} ready`,
      );
    }
    console.log(`updated: ${updated}`);
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
