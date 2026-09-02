/**
 * Surgical cleanup of the live Katana catalog.
 *
 * Phase A repairs malformed variant SKUs. With LS/RS now modelled as distinct
 * frames, a dropped or misplaced directional token no longer just looks untidy
 * — it mints a phantom sub-assembly — so these five edits are load-bearing.
 *
 * Phase B retires a redundant product by copying its recipe rows to the
 * surviving variant first, verifying the copy, then deleting the source rows.
 * It is off by default because only the 84 daybed is a like-for-like swap: the
 * plain 72 is 72x72 against Cabana's 72x78, and the plain 78 is 78x72 against
 * Cabana's 78x78, so copying those cut-lists would specify frames six inches
 * shallower than the product being built.
 *
 * Nothing here has a precedent in this repo — no code has ever issued a Katana
 * DELETE or written archived_at — so every phase probes one object and stops
 * on failure before touching the rest.
 *
 * Usage:
 *   npx tsx scripts/sanitize-katana-catalog.ts --dry-run
 *   npx tsx scripts/sanitize-katana-catalog.ts
 *   npx tsx scripts/sanitize-katana-catalog.ts --confirm-daybed-purge --only-size 84
 *
 * Env: KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY)
 */
import { loadEnvConfig } from "@next/env";
import { katanaFetch } from "../src/lib/katana";

loadEnvConfig(process.cwd());

const dryRun = process.argv.includes("--dry-run");
const confirmDaybedPurge = process.argv.includes("--confirm-daybed-purge");

const onlySize = (() => {
  const index = process.argv.indexOf("--only-size");
  return index === -1 ? null : (process.argv[index + 1]?.trim() ?? null);
})();

/** Katana allows 60 requests / 60s. */
const REQUEST_DELAY_MS = 1100;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Phase A: variant id -> corrected SKU. */
const SKU_PATCHES: ReadonlyArray<{
  variantId: number;
  from: string;
  to: string;
  reason: string;
}> = [
  {
    variantId: 41069374,
    from: "BRA-C-34X84LS-BO",
    to: "BRA-C-34X84-LS-BO",
    reason: "missing hyphen before directional token",
  },
  {
    variantId: 41069380,
    from: "BRA-C-34X84RS-BO",
    to: "BRA-C-34X84-RS-BO",
    reason: "missing hyphen before directional token",
  },
  {
    variantId: 41069377,
    from: "BRA-C-34X84RS-WH",
    to: "BRA-C-34X84-RS-WH",
    reason: "missing hyphen before directional token",
  },
  {
    variantId: 41069219,
    from: "BRA-C-34X72-BL",
    to: "BRA-C-34X72-LS-BL",
    reason: "directional token dropped; LS-BL is the one gap in that color run",
  },
  {
    variantId: 41069416,
    from: "BRA-C-84X42-LS-BR",
    to: "BRA-C-42X84-LS-BR",
    reason: "dimensions transposed; LS-BR is the one gap in that color run",
  },
];

/**
 * Left alone deliberately. Each needs a factory ruling, not a guess.
 */
const FLAGGED_FOR_FACTORY: ReadonlyArray<string> = [
  "BRA-C-42X84-RS-WH appears on two variants while -RS-GR is missing; one is a mis-keyed color",
  "BRA-ODT-* (48 variants, 8 products) is the dekton-top configuration, not a duplicate of BRA-O-*",
  "BRA-CL-D-A and BRA-CL-S-A (12 variants) are an unexplained second configuration",
  "Plain Daybed 72 (72x72) and 78 (78x72) do not match Cabana 72 (72x78) and 78 (78x78)",
];

/** Phase B: retire the plain daybed whose Cabana counterpart is identical. */
const DAYBED_RETIREMENTS: ReadonlyArray<{
  size: string;
  sourceProductId: number;
  sourceProductName: string;
  /** source variant id -> surviving Cabana variant id */
  variantMap: ReadonlyArray<{ from: number; to: number; label: string }>;
  /** Expected to hold no recipe rows; retirement aborts if any do. */
  otherSourceVariantIds: readonly number[];
}> = [
  {
    size: "84",
    sourceProductId: 17426889,
    sourceProductName: "Bravada Daybed 84",
    // Only the BL variant carries a cut-list; the other five colors are empty
    // and are asserted empty before the product is retired.
    variantMap: [
      {
        from: 41070039,
        to: 41078740,
        label: "BRA-D-8478-BL → BRA-CADA-84X78-BL",
      },
    ],
    otherSourceVariantIds: [41070040, 41070041, 41070042, 41070043, 41070044],
  },
];

type KatanaVariant = {
  id: number;
  sku: string | null;
  product_id: number;
  deleted_at: string | null;
};

type KatanaRecipeRow = {
  id: string;
  product_variant_id: number;
  ingredient_variant_id: number;
  quantity: number;
  notes: string | null;
  rank: number;
};

type KatanaBomRow = {
  id: string;
  product_variant_id: number;
  ingredient_variant_id: number;
  quantity: number;
};

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

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

/**
 * Katana ignores ?product_variant_id on GET /recipes and returns the whole
 * table, so the set is paged in once and filtered here. Reading it fresh after
 * a mutation is the only way to verify a copy actually landed.
 */
let recipeCache: KatanaRecipeRow[] | null = null;

async function loadAllRecipeRows(): Promise<KatanaRecipeRow[]> {
  if (recipeCache) return recipeCache;

  const all: KatanaRecipeRow[] = [];
  const pageSize = 250;
  for (let page = 1; page <= 40; page += 1) {
    const { data } = await katanaFetch(
      `/recipes?limit=${pageSize}&page=${page}`,
    );
    const rows = unwrapList<KatanaRecipeRow>(data);
    all.push(...rows);
    if (rows.length < pageSize) break;
    await delay(REQUEST_DELAY_MS);
  }

  recipeCache = all;
  return all;
}

async function listRecipeRows(variantId: number): Promise<KatanaRecipeRow[]> {
  const all = await loadAllRecipeRows();
  return all.filter((row) => row.product_variant_id === variantId);
}

/**
 * Reads cut-list rows through /bom_rows rather than /recipes. Only /bom_rows
 * exposes a working delete — DELETE /recipes/{id} answers 405 and
 * /recipe_rows/{id} is deprecated — and its row ids are the ones DELETE wants.
 */
async function listBomRows(variantId: number): Promise<KatanaBomRow[]> {
  const all: KatanaBomRow[] = [];
  const pageSize = 250;
  for (let page = 1; page <= 40; page += 1) {
    const { data } = await katanaFetch(
      `/bom_rows?product_variant_id=${variantId}&limit=${pageSize}&page=${page}`,
    );
    const rows = unwrapList<KatanaBomRow>(data);
    all.push(...rows);
    if (rows.length < pageSize) break;
    await delay(REQUEST_DELAY_MS);
  }
  // The filter is not honoured on every Katana list endpoint, so re-apply it.
  return all.filter((row) => row.product_variant_id === variantId);
}

async function phaseA(): Promise<boolean> {
  console.log("=== Phase A — variant SKU repair");

  let patched = 0;
  let skipped = 0;
  let probed = false;

  for (const patch of SKU_PATCHES) {
    const variant = await getVariant(patch.variantId);
    await delay(REQUEST_DELAY_MS);

    if (!variant) {
      skipped += 1;
      continue;
    }
    if (variant.sku === patch.to) {
      console.log(`  ${patch.variantId} already ${patch.to}`);
      skipped += 1;
      continue;
    }
    if (variant.sku !== patch.from) {
      console.warn(
        `  ${patch.variantId} expected ${patch.from} but found ${variant.sku} — skipped`,
      );
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  would patch ${patch.from} → ${patch.to}  (${patch.reason})`);
      continue;
    }

    try {
      await katanaFetch(`/variants/${patch.variantId}`, {
        method: "PATCH",
        body: { sku: patch.to },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  PATCH ${patch.variantId} failed — ${message}`);
      if (!probed) {
        console.error(
          "  first PATCH failed; aborting Phase A rather than half-applying it",
        );
        return false;
      }
      skipped += 1;
      await delay(REQUEST_DELAY_MS);
      continue;
    }

    const after = await getVariant(patch.variantId);
    if (after?.sku !== patch.to) {
      console.error(
        `  verification failed for ${patch.variantId}: sku is ${after?.sku}`,
      );
      return false;
    }

    probed = true;
    patched += 1;
    console.log(`  ${patch.from} → ${patch.to}  (${patch.reason})`);
    await delay(REQUEST_DELAY_MS);
  }

  console.log(`  patched=${patched} skipped=${skipped}`);
  return true;
}

async function phaseB(): Promise<void> {
  console.log("=== Phase B — daybed recipe migration and retirement");

  if (!confirmDaybedPurge) {
    console.log("  skipped (pass --confirm-daybed-purge to run)");
    return;
  }

  const targets = onlySize
    ? DAYBED_RETIREMENTS.filter((row) => row.size === onlySize)
    : DAYBED_RETIREMENTS;

  if (targets.length === 0) {
    console.log(`  no retirement defined for size ${onlySize}`);
    return;
  }

  for (const target of targets) {
    console.log(`  ${target.sourceProductName} (product ${target.sourceProductId})`);

    for (const mapping of target.variantMap) {
      const destinationId = mapping.to;
      const sourceRows = await listRecipeRows(mapping.from);
      const existing = await listRecipeRows(destinationId);

      console.log(
        `    ${mapping.label}: ${sourceRows.length} source rows, ${existing.length} already on destination`,
      );

      if (dryRun) {
        for (const row of sourceRows) {
          console.log(
            `      would copy ingredient ${row.ingredient_variant_id} qty ${row.quantity}`,
          );
        }
        continue;
      }

      const existingIngredients = new Set(
        existing.map((row) => row.ingredient_variant_id),
      );
      const toCopy = sourceRows.filter(
        (row) => !existingIngredients.has(row.ingredient_variant_id),
      );

      if (toCopy.length < sourceRows.length) {
        console.log(
          `      ${sourceRows.length - toCopy.length} ingredients already on destination, left alone`,
        );
      }

      if (toCopy.length > 0) {
        // POST /recipes takes a batch envelope; keep_current_rows stays true so
        // a partial destination is added to rather than replaced.
        await katanaFetch("/recipes", {
          method: "POST",
          body: {
            keep_current_rows: true,
            rows: toCopy.map((row) => ({
              product_variant_id: destinationId,
              ingredient_variant_id: row.ingredient_variant_id,
              quantity: row.quantity,
              ...(row.notes ? { notes: row.notes } : {}),
            })),
          },
        });
        await delay(REQUEST_DELAY_MS);
      }
      const copied = toCopy.length;

      recipeCache = null;
      const verified = await listRecipeRows(destinationId);
      const verifiedIngredients = new Set(
        verified.map((r) => r.ingredient_variant_id),
      );
      const missing = sourceRows.filter(
        (row) => !verifiedIngredients.has(row.ingredient_variant_id),
      );
      if (missing.length > 0) {
        console.error(
          `      verification failed: ${missing.length} ingredients missing on destination; source left intact`,
        );
        return;
      }
      console.log(`      copied ${copied}, verified ${verified.length} rows`);

      const sourceBomRows = await listBomRows(mapping.from);
      await delay(REQUEST_DELAY_MS);
      for (const row of sourceBomRows) {
        await katanaFetch(`/bom_rows/${row.id}`, { method: "DELETE" });
        await delay(REQUEST_DELAY_MS);
      }
      recipeCache = null;
      console.log(`      deleted ${sourceBomRows.length} source cut-list rows`);
    }

    let strayRows = 0;
    for (const variantId of target.otherSourceVariantIds) {
      const rows = await listRecipeRows(variantId);
      if (rows.length > 0) {
        console.error(
          `    variant ${variantId} unexpectedly holds ${rows.length} recipe rows`,
        );
        strayRows += rows.length;
      }
    }
    if (strayRows > 0) {
      console.error(
        `    aborting retirement of product ${target.sourceProductId}: ${strayRows} unmigrated recipe rows`,
      );
      continue;
    }

    if (dryRun) {
      console.log(`    would retire product ${target.sourceProductId}`);
      continue;
    }

    await retireProduct(target.sourceProductId, target.sourceProductName);
  }
}

/** Katana's supported retirement verb is undocumented here, so try in order. */
async function retireProduct(productId: number, name: string): Promise<void> {
  try {
    await katanaFetch(`/products/${productId}`, { method: "DELETE" });
    console.log(`    deleted product ${productId}`);
    return;
  } catch (error: unknown) {
    console.warn(
      `    DELETE /products/${productId} rejected (${error instanceof Error ? error.message : String(error)}); trying archived_at`,
    );
  }
  await delay(REQUEST_DELAY_MS);

  try {
    await katanaFetch(`/products/${productId}`, {
      method: "PATCH",
      body: { archived_at: new Date().toISOString() },
    });
    console.log(`    archived product ${productId}`);
    return;
  } catch (error: unknown) {
    console.warn(
      `    PATCH archived_at rejected (${error instanceof Error ? error.message : String(error)}); falling back to name prefix`,
    );
  }
  await delay(REQUEST_DELAY_MS);

  await katanaFetch(`/products/${productId}`, {
    method: "PATCH",
    body: { name: `Z-ARCHIVED-${name}` },
  });
  console.log(`    renamed product ${productId} to Z-ARCHIVED-${name}`);
}

async function main(): Promise<void> {
  console.log(
    dryRun ? "[dry-run] Katana catalog sanitize" : "Katana catalog sanitize",
  );

  const ok = await phaseA();
  if (!ok) {
    process.exitCode = 1;
    return;
  }

  await phaseB();

  console.log("=== Flagged for factory review, untouched");
  for (const note of FLAGGED_FOR_FACTORY) {
    console.log(`  ${note}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
