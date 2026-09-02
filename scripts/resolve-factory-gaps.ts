/**
 * Unblock the models that were parked for factory review, without guessing any
 * engineering measurement.
 *
 * Phase 1 — Katana SKU correction. The two "duplicate" BRA-C-42X84-RS-WH
 * variants are not duplicates: Katana's own config_attributes record one as
 * grey, and grey is the single colour missing from that right-facing run while
 * the left-facing run has it. So the SKU is mis-keyed, not redundant, and the
 * fix is to correct the token rather than archive a real variant.
 *
 * Phase 2 — report the architecture gaps that are genuinely empty versus the
 * ones that already hold factory data, so nothing real gets cleared in the name
 * of "empty architecture".
 *
 * The LS -> RS cut-list mirror is deliberately NOT done here. Writing those rows
 * directly would leave them to be deleted by the next Phase 2 seeder run, which
 * clears every parent it owns. The mirror lives in the BOM planner instead
 * (config.mirrorHandedCutLists), so it is regenerated on every run and shows up
 * in the warnings. Run `npm run db:seed-bra-bro` to apply it.
 *
 * Usage:
 *   npx tsx scripts/resolve-factory-gaps.ts --dry-run
 *   npx tsx scripts/resolve-factory-gaps.ts
 *
 * Env: KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY), POSTGRES_URL
 */
import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db/client";
import { katanaFetch } from "../src/lib/katana";

loadEnvConfig(process.cwd());

const dryRun = process.argv.includes("--dry-run");
const REQUEST_DELAY_MS = 1100;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type KatanaVariant = {
  id: number;
  sku: string | null;
  config_attributes?: Array<{ config_name: string; config_value: string }>;
};

/** Colour token per Katana's own `color` config value. */
const COLOR_TOKEN: Readonly<Record<string, string>> = {
  black: "BL",
  white: "WH",
  bronze: "BR",
  beige: "BE",
  bone: "BO",
  grey: "GR",
};

const MISKEYED_VARIANTS: ReadonlyArray<{
  variantId: number;
  from: string;
  to: string;
}> = [{ variantId: 41069425, from: "BRA-C-42X84-RS-WH", to: "BRA-C-42X84-RS-GR" }];

async function getVariant(variantId: number): Promise<KatanaVariant | null> {
  try {
    const { data } = await katanaFetch<KatanaVariant>(`/variants/${variantId}`);
    return data ?? null;
  } catch (error: unknown) {
    console.error(
      `  cannot read variant ${variantId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function colorTokenOf(variant: KatanaVariant): string | null {
  const color = variant.config_attributes?.find(
    (attr) => attr.config_name.toLowerCase() === "color",
  )?.config_value;
  return color ? (COLOR_TOKEN[color.toLowerCase()] ?? null) : null;
}

async function phaseKatanaSkus(): Promise<boolean> {
  console.log("=== Phase 1 — correct mis-keyed variant SKUs");

  for (const patch of MISKEYED_VARIANTS) {
    const variant = await getVariant(patch.variantId);
    await delay(REQUEST_DELAY_MS);
    if (!variant) return false;

    if (variant.sku === patch.to) {
      console.log(`  ${patch.variantId} already ${patch.to}`);
      continue;
    }
    if (variant.sku !== patch.from) {
      console.warn(
        `  ${patch.variantId} expected ${patch.from} but found ${variant.sku} — skipped`,
      );
      continue;
    }

    // Only rename when Katana's own colour attribute agrees with the target.
    const token = colorTokenOf(variant);
    const expected = patch.to.split("-").pop();
    if (token !== expected) {
      console.error(
        `  ${patch.variantId} colour attribute maps to ${token ?? "?"} but target says ${expected} — refusing to rename`,
      );
      return false;
    }
    console.log(`  ${patch.variantId} colour attribute confirms ${token}`);

    if (dryRun) {
      console.log(`  would patch ${patch.from} → ${patch.to}`);
      continue;
    }

    await katanaFetch(`/variants/${patch.variantId}`, {
      method: "PATCH",
      body: { sku: patch.to },
    });
    await delay(REQUEST_DELAY_MS);

    const after = await getVariant(patch.variantId);
    await delay(REQUEST_DELAY_MS);
    if (after?.sku !== patch.to) {
      console.error(
        `  verification failed for ${patch.variantId}: sku is ${after?.sku}`,
      );
      return false;
    }
    console.log(`  ${patch.from} → ${patch.to}`);
  }

  return true;
}

async function phaseArchitectureReport(): Promise<void> {
  console.log("\n=== Phase 2 — architecture status");

  const db = getDb();
  const read = async (query: ReturnType<typeof sql>) => {
    const result = await db.execute(query);
    return (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Array<Record<string, unknown>>;
  };

  console.log("\n  handed frames — cut-list rows:");
  for (const row of await read(sql`
    select sm.global_sku,
           (select count(*)::int from product_bom pb where pb.parent_sku = sm.global_sku) as lines
    from sku_mappings sm
    where sm.global_sku ~ '^SA-BRA-.*-(LS|RS)-FRAME$' and sm.is_active = true
    order by sm.global_sku
  `)) {
    console.log(
      `    ${String(row.global_sku).padEnd(32)} ${String(row.lines).padStart(2)} rows`,
    );
  }

  console.log(
    "\n  variant-axis and parked models — cut-list rows and finished-good links:",
  );
  for (const row of await read(sql`
    select sm.global_sku,
           (select count(*)::int from product_bom pb where pb.parent_sku = sm.global_sku) as lines,
           (select count(*)::int from product_bom pb where pb.child_sku = sm.global_sku) as parents
    from sku_mappings sm
    where sm.is_active = true
      and sm.global_sku ~ '^SA-BRA-(D|O|ODT|CL)-'
    order by sm.global_sku
  `)) {
    const parents = Number(row.parents);
    console.log(
      `    ${String(row.global_sku).padEnd(32)} cut-list=${String(row.lines).padStart(2)}  fg_parents=${parents}${parents === 0 ? "  << ORPHAN" : ""}`,
    );
  }
}

async function main(): Promise<void> {
  console.log(dryRun ? "[dry-run] Resolve factory gaps" : "Resolve factory gaps");

  const ok = await phaseKatanaSkus();
  if (!ok) {
    process.exitCode = 1;
    return;
  }

  await phaseArchitectureReport();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
