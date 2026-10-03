/**
 * Push packaged weight and dimensions from logistics_profiles onto Katana
 * variant cards so the factory floor sees the same numbers.
 *
 * Selects rows where weight_lb and katana_variant_id are both set, then
 * PATCH /variants/{id}:
 *   weight ← weight_lb
 *   width  ← width_in
 *   depth  ← length_in
 *   height ← height_in
 *
 * Null dimensions are omitted so a partial profile does not clear a Katana
 * field. Dry-run is the default and does not call Katana.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/sync-logistics-to-katana.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/sync-logistics-to-katana.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import { and, asc, isNotNull } from "drizzle-orm";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import { closeDb, getDb } from "../../src/server/db/client";
import { logistics_profiles } from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");

/** Stay under Katana's 60 requests / 60 seconds budget. */
const REQUEST_DELAY_MS = 1000;
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type ProfileRow = {
  katanaVariantId: number;
  variantSku: string;
  weightLb: string | null;
  widthIn: string | null;
  lengthIn: string | null;
  heightIn: string | null;
};

/** Body accepted by PATCH /v1/variants/{variant_id}. */
type KatanaVariantLogisticsPayload = {
  weight: number;
  width?: number;
  depth?: number;
  height?: number;
};

function positiveMeasure(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number(n.toFixed(4));
}

/**
 * Map a logistics profile onto the Katana variant payload.
 * Returns null when weight is missing or not a positive number.
 */
function buildKatanaLogisticsPayload(row: ProfileRow): {
  payload: KatanaVariantLogisticsPayload;
  omitted: Array<"width" | "depth" | "height">;
} | null {
  const weight = positiveMeasure(row.weightLb);
  if (weight == null) return null;

  const payload: KatanaVariantLogisticsPayload = { weight };
  const omitted: Array<"width" | "depth" | "height"> = [];

  const width = positiveMeasure(row.widthIn);
  const depth = positiveMeasure(row.lengthIn);
  const height = positiveMeasure(row.heightIn);

  if (width == null) omitted.push("width");
  else payload.width = width;

  if (depth == null) omitted.push("depth");
  else payload.depth = depth;

  if (height == null) omitted.push("height");
  else payload.height = height;

  return { payload, omitted };
}

function formatLine(
  mode: "DRY" | "OK" | "FAIL" | "SKIP",
  row: Pick<ProfileRow, "katanaVariantId" | "variantSku">,
  detail: string,
): string {
  return `  ${mode}  variant ${row.katanaVariantId}  ${row.variantSku}  ${detail}`;
}

async function main(): Promise<void> {
  console.log("Katana outbound logistics sync");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);
  console.log(
    "  PATCH /variants/{id}  weight←weight_lb  width←width_in  depth←length_in  height←height_in",
  );
  console.log("");

  const db = getDb();
  try {
    const rows = await db
      .select({
        katanaVariantId: logistics_profiles.katana_variant_id,
        variantSku: logistics_profiles.variant_sku,
        weightLb: logistics_profiles.weight_lb,
        widthIn: logistics_profiles.width_in,
        lengthIn: logistics_profiles.length_in,
        heightIn: logistics_profiles.height_in,
      })
      .from(logistics_profiles)
      .where(
        and(
          isNotNull(logistics_profiles.weight_lb),
          isNotNull(logistics_profiles.katana_variant_id),
        ),
      )
      .orderBy(asc(logistics_profiles.variant_sku));

    console.log(`  profiles with weight and variant id: ${rows.length}`);
    console.log("");

    let planned = 0;
    let skipped = 0;
    let patched = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      const built = buildKatanaLogisticsPayload(row);
      if (!built) {
        skipped += 1;
        console.log(
          formatLine(
            "SKIP",
            row,
            `weight_lb=${row.weightLb ?? "null"} is not a positive number`,
          ),
        );
        continue;
      }

      const omitted =
        built.omitted.length > 0 ? `  omitted: ${built.omitted.join(", ")}` : "";
      const detail = `PATCH /variants/${row.katanaVariantId} ${JSON.stringify(built.payload)}${omitted}`;

      if (!confirm) {
        planned += 1;
        console.log(formatLine("DRY", row, detail));
        continue;
      }

      let abort = false;
      try {
        await katanaFetch(`/variants/${row.katanaVariantId}`, {
          method: "PATCH",
          body: built.payload,
        });
        patched += 1;
        console.log(formatLine("OK", row, detail));
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.log(formatLine("FAIL", row, `${detail}  ${message}`));
        if (error instanceof KatanaApiError && error.status === 0) {
          abort = true;
          console.error(
            "  Aborting: Katana credentials are not configured.",
          );
        }
      }

      if (abort) break;
      if (i < rows.length - 1) {
        await delay(REQUEST_DELAY_MS);
      }
    }

    console.log("");
    console.log("========================================");
    console.log(
      confirm
        ? "  LOGISTICS → KATANA SUMMARY"
        : "  LOGISTICS → KATANA SUMMARY (DRY-RUN)",
    );
    console.log("========================================");
    console.log(`  Selected: ${rows.length}`);
    console.log(`  Skipped (invalid weight): ${skipped}`);
    if (confirm) {
      console.log(`  Patched: ${patched}`);
      console.log(`  Failed: ${failed}`);
    } else {
      console.log(`  Would patch: ${planned}`);
      console.log("  Pass --confirm to PATCH live Katana variants.");
    }
    console.log("========================================");

    if (failed > 0) process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
