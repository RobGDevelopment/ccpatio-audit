/**
 * Mint the finished goods that Bravada and Brooklyn sub-assemblies have no
 * parent for, under the canonical FIN-BRV-* / FIN-BRK-* convention.
 *
 * Nothing here is invented: the category code comes from the SKU engine, the
 * size comes from the factory model code (or from the unhanded PIM row it
 * supersedes), and handedness comes from the variant SKU. Models the factory
 * still has to rule on — the daybeds, the dekton-top ottomans, the -A chaise
 * lounges — are skipped, not guessed.
 *
 * Splitting LS/RS supersedes the six unhanded corner sofas. They are set
 * inactive rather than deleted or aliased, and their stale BOM rows removed.
 *
 * Usage:
 *   npx tsx scripts/seed-missing-fgs.ts --dry-run
 *   npx tsx scripts/seed-missing-fgs.ts
 *
 * Env: POSTGRES_URL
 */
import { loadEnvConfig } from "@next/env";
import { inArray, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, getDb } from "../src/server/db/client";
import {
  finished_goods_catalog,
  product_bom,
  sku_mappings,
} from "../src/server/db/schema";
import { KATANA_LIVE_PULL_AT } from "../src/lib/katana-bulk-materials";
import { resolveCatCode } from "../src/lib/sku-engine";
import {
  COLLECTIONS,
  COLLECTION_SOURCE,
  directionOfStem,
  modelCodesFromSkus,
  productsInCollection,
  type CollectionConfig,
  type CollectionKey,
  type KatanaProductLike,
} from "../src/lib/collection-catalog";
import {
  parseFinishedGoodSku,
  reorderChaiseModifier,
  resolveFinishedGoodsByModel,
} from "../src/lib/collection-fg-match";

loadEnvConfig(process.cwd());

const dryRun = process.argv.includes("--dry-run");
const SOURCE_FILE = `${COLLECTION_SOURCE} @ ${KATANA_LIVE_PULL_AT}`;
const TARGETS: CollectionKey[] = ["bravada", "brooklyn"];

/**
 * Models whose finished-good SKU is a data-dictionary decision rather than
 * something the naming rules can derive.
 *
 * The dekton-top and no-metal-arms axes have no category rule of their own, and
 * the two daybed lines differ only in depth, so leaving these to the derived
 * path would either collide with an existing SKU or invent a wrong one.
 *
 * Dimensions come from the sibling finished good wherever one exists, so the
 * factory's own length/depth orientation carries over instead of being guessed.
 */
const EXPLICIT_MINTS: Readonly<
  Record<
    string,
    {
      sku: string;
      nameSuffix: string;
      inheritFrom?: string;
      length?: string;
      depth?: string;
    }
  >
> = {
  "BRA-ODT-30X22": {
    sku: "FIN-BRV-OTT-DKT-30X22",
    nameSuffix: "Dekton Top",
    inheritFrom: "FIN-BRV-OTT-30X22",
  },
  "BRA-ODT-34X34": {
    sku: "FIN-BRV-OTT-DKT-34X34",
    nameSuffix: "Dekton Top",
    inheritFrom: "FIN-BRV-OTT-34X34",
  },
  "BRA-ODT-42X22": {
    sku: "FIN-BRV-OTT-DKT-42X22",
    nameSuffix: "Dekton Top",
    inheritFrom: "FIN-BRV-OTT-42X22",
  },
  "BRA-ODT-42X34": {
    sku: "FIN-BRV-OTT-DKT-42X34",
    nameSuffix: "Dekton Top",
    inheritFrom: "FIN-BRV-OTT-42X34",
  },
  "BRA-ODT-60X22": {
    sku: "FIN-BRV-OTT-DKT-60X22",
    nameSuffix: "Dekton Top",
    inheritFrom: "FIN-BRV-OTT-60X22",
  },
  "BRA-ODT-60X34": {
    sku: "FIN-BRV-OTT-DKT-60X34",
    nameSuffix: "Dekton Top",
    inheritFrom: "FIN-BRV-OTT-60X34",
  },
  "BRA-ODT-72X22": {
    sku: "FIN-BRV-OTT-DKT-72X22",
    nameSuffix: "Dekton Top",
    inheritFrom: "FIN-BRV-OTT-72X22",
  },
  "BRA-ODT-72X34": {
    sku: "FIN-BRV-OTT-DKT-72X34",
    nameSuffix: "Dekton Top",
    inheritFrom: "FIN-BRV-OTT-72X34",
  },
  "BRA-CL-D-A": {
    sku: "FIN-BRV-DOU-CHS-58X79-NOARM",
    nameSuffix: "No Metal Arms",
    inheritFrom: "FIN-BRV-DOU-CHS-58X79",
  },
  "BRA-CL-S-A": {
    sku: "FIN-BRV-SGL-CHS-30X79-NOARM",
    nameSuffix: "No Metal Arms",
    inheritFrom: "FIN-BRV-SGL-CHS-30X79",
  },
  // Plain daybeds are 72 deep against Cabana's 78, so they are their own
  // products rather than duplicates. Sizes read straight off the factory stem.
  "BRA-D-7272": {
    sku: "FIN-BRV-DYB-72X72",
    nameSuffix: "",
    length: "72",
    depth: "72",
  },
  "BRA-D-7872": {
    sku: "FIN-BRV-DYB-78X72",
    nameSuffix: "",
    length: "78",
    depth: "72",
  },
};

const DIRECTION_LABEL: Record<string, string> = {
  LS: "Left Facing",
  RS: "Right Facing",
};

type MintRow = {
  globalSku: string;
  originalName: string;
  modelCode: string;
  productName: string;
  katanaProductId: number;
  direction: string | null;
  length: string | null;
  depth: string | null;
  supersedes: string | null;
};

async function loadProducts(): Promise<KatanaProductLike[]> {
  const parsed = JSON.parse(
    await readFile(path.resolve(process.cwd(), COLLECTION_SOURCE), "utf8"),
  ) as { data?: KatanaProductLike[] } | KatanaProductLike[];
  return Array.isArray(parsed) ? parsed : (parsed.data ?? []);
}

/** Size token as the factory wrote it: BRA-C-34X72-LS -> "34X72". */
function sizeTokenFromModelCode(modelCode: string): string {
  const tokens = modelCode.split("-");
  return (
    tokens.find((token) => /^\d{2,3}X\d{2,3}$/.test(token)) ??
    tokens.find((token) => /^\d{2,3}$/.test(token)) ??
    ""
  );
}

function dimsOfSizeToken(sizeToken: string): number[] {
  return sizeToken
    ? sizeToken.split("X").map(Number).sort((a, b) => a - b)
    : [];
}

function isSubset(needle: number[], haystack: number[]): boolean {
  const pool = [...haystack];
  for (const value of needle) {
    const index = pool.indexOf(value);
    if (index === -1) return false;
    pool.splice(index, 1);
  }
  return true;
}

async function planCollection(
  config: CollectionConfig,
  products: KatanaProductLike[],
): Promise<{ mint: MintRow[]; superseded: Set<string>; skipped: string[] }> {
  const candidates = await getDb()
    .select({
      globalSku: sku_mappings.global_sku,
      originalName: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(sql`${sku_mappings.global_sku} like ${`${config.finPrefix}%`}`);

  const resolution = resolveFinishedGoodsByModel({
    products,
    config,
    candidates,
  });
  const unlinked = new Set(resolution.unmatched.map((row) => row.modelCode));

  const dimsBySku = new Map<string, { length: string | null; depth: string | null }>(
    (
      await getDb()
        .select({
          globalSku: finished_goods_catalog.global_sku,
          length: finished_goods_catalog.length,
          depth: finished_goods_catalog.depth,
        })
        .from(finished_goods_catalog)
        .where(
          sql`${finished_goods_catalog.global_sku} like ${`${config.finPrefix}%`}`,
        )
    ).map((row) => [row.globalSku, { length: row.length, depth: row.depth }]),
  );

  const mint: MintRow[] = [];
  const superseded = new Set<string>();
  const skipped: string[] = [];
  const taken = new Set(candidates.map((row) => row.globalSku));

  for (const product of productsInCollection(products, config)) {
    const skus = (product.variants ?? [])
      .map((variant) => variant.sku?.trim() ?? "")
      .filter(Boolean);
    if (skus.length === 0) continue;

    for (const modelCode of modelCodesFromSkus(skus, config.skuPrefix)) {
      if (!unlinked.has(modelCode)) continue;

      const explicit = EXPLICIT_MINTS[modelCode];
      if (explicit) {
        if (taken.has(explicit.sku)) {
          skipped.push(`${modelCode} → ${explicit.sku} already exists`);
          continue;
        }
        const parent = explicit.inheritFrom
          ? dimsBySku.get(explicit.inheritFrom)
          : undefined;
        if (explicit.inheritFrom && !parent) {
          skipped.push(
            `${modelCode} → ${explicit.sku} cannot inherit dimensions from ${explicit.inheritFrom}`,
          );
          continue;
        }
        taken.add(explicit.sku);
        mint.push({
          globalSku: explicit.sku,
          originalName: explicit.nameSuffix
            ? `${product.name} (${explicit.nameSuffix})`
            : product.name,
          modelCode,
          productName: product.name,
          katanaProductId: product.id,
          direction: null,
          length: parent?.length ?? explicit.length ?? null,
          depth: parent?.depth ?? explicit.depth ?? null,
          supersedes: null,
        });
        continue;
      }

      const catCode = resolveCatCode(reorderChaiseModifier(product.name));
      if (catCode === "MIS") {
        skipped.push(`${modelCode} (${product.name}) — no category rule`);
        continue;
      }

      const direction = directionOfStem(modelCode);
      let sizeToken = sizeTokenFromModelCode(modelCode);
      let supersedes: string | null = null;

      // A handed model inherits the size of the unhanded row it replaces, so
      // FIN-BRV-COR-SOF-96X34 becomes ...-96X34-LS rather than losing its depth.
      for (const row of candidates) {
        const parts = parseFinishedGoodSku(row.globalSku, config);
        if (
          !parts ||
          parts.direction !== null ||
          parts.catCode !== catCode ||
          dimsOfSizeToken(sizeToken).length >= parts.dims.length ||
          !isSubset(dimsOfSizeToken(sizeToken), parts.dims)
        ) {
          continue;
        }
        sizeToken = parts.sizeToken;
        supersedes = row.globalSku;
        break;
      }

      const globalSku = [
        `${config.finPrefix}${catCode}`,
        sizeToken || null,
        direction,
      ]
        .filter(Boolean)
        .join("-");

      if (taken.has(globalSku)) {
        skipped.push(`${modelCode} → ${globalSku} already exists`);
        continue;
      }
      taken.add(globalSku);
      if (supersedes) superseded.add(supersedes);

      const [length, depth] = sizeToken.split("X");

      mint.push({
        globalSku,
        originalName: direction
          ? `${product.name} (${DIRECTION_LABEL[direction]})`
          : product.name,
        modelCode,
        productName: product.name,
        katanaProductId: product.id,
        direction,
        length: length || null,
        depth: depth || null,
        supersedes,
      });
    }
  }

  mint.sort((a, b) => a.globalSku.localeCompare(b.globalSku));
  return { mint, superseded, skipped };
}

async function writeCollection(
  config: CollectionConfig,
  mint: MintRow[],
  superseded: Set<string>,
): Promise<void> {
  const db = getDb();
  const now = new Date();

  if (mint.length > 0) {
    await db
      .insert(sku_mappings)
      .values(
        mint.map((row) => ({
          global_sku: row.globalSku,
          category: `${config.label} Collection`,
          item_type: "finished_good" as const,
          original_name: row.originalName,
          source_file: SOURCE_FILE,
          is_active: true,
          sync_to_woo: false,
          uom_purchase: "ea",
          uom_consume: "ea",
          attributes: {
            collection: config.key,
            factory_model: row.modelCode,
            katana_parent_product_id: row.katanaProductId,
            parent_name: row.productName,
            ...(row.direction ? { direction: row.direction } : {}),
            ...(row.supersedes ? { supersedes: row.supersedes } : {}),
          },
          updated_by: "missing-fg-seed",
          updated_at: now,
        })),
      )
      .onConflictDoUpdate({
        target: sku_mappings.global_sku,
        set: {
          category: sql`excluded.category`,
          item_type: sql`excluded.item_type`,
          original_name: sql`excluded.original_name`,
          source_file: sql`excluded.source_file`,
          is_active: sql`excluded.is_active`,
          uom_purchase: sql`excluded.uom_purchase`,
          uom_consume: sql`excluded.uom_consume`,
          attributes: sql`excluded.attributes`,
          updated_by: sql`excluded.updated_by`,
          updated_at: sql`excluded.updated_at`,
        },
      });

    // image_url and MSRP are executive-owned; only seed the structural fields.
    await db
      .insert(finished_goods_catalog)
      .values(
        mint.map((row) => ({
          global_sku: row.globalSku,
          length: row.length,
          depth: row.depth,
          updated_by: "missing-fg-seed",
          updated_at: now,
        })),
      )
      .onConflictDoUpdate({
        target: finished_goods_catalog.global_sku,
        set: {
          length: sql`excluded.length`,
          depth: sql`excluded.depth`,
          updated_by: sql`excluded.updated_by`,
          updated_at: sql`excluded.updated_at`,
        },
      });
  }

  if (superseded.size > 0) {
    const list = [...superseded];
    await db.delete(product_bom).where(inArray(product_bom.parent_sku, list));
    await db
      .update(sku_mappings)
      .set({
        is_active: false,
        sync_to_woo: false,
        updated_by: "missing-fg-seed",
        updated_at: now,
      })
      .where(inArray(sku_mappings.global_sku, list));
  }
}

async function main(): Promise<void> {
  const products = await loadProducts();

  console.log(
    dryRun ? "[dry-run] Mint missing finished goods" : "Mint missing finished goods",
  );

  for (const key of TARGETS) {
    const config = COLLECTIONS[key];
    const { mint, superseded, skipped } = await planCollection(config, products);

    console.log(`=== ${config.label}`);
    console.log(
      `  mint=${mint.length}  supersede=${superseded.size}  skipped=${skipped.length}`,
    );
    for (const row of mint) {
      console.log(
        `  + ${row.globalSku.padEnd(28)} ${row.modelCode.padEnd(18)} ${row.originalName}${row.supersedes ? `  (supersedes ${row.supersedes})` : ""}`,
      );
    }
    for (const sku of [...superseded].sort()) {
      console.log(`  - ${sku} → is_active=false`);
    }
    for (const note of skipped) {
      console.log(`  skip: ${note}`);
    }

    if (!dryRun) {
      await writeCollection(config, mint, superseded);
      console.log(`  written.`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
