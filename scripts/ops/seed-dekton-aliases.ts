/**
 * Seed Dekton sheet-spelling aliases and mint the three missing LP firepit inserts.
 *
 * sku_aliases.alias_sku is a primary key and canonical_sku must be a real
 * sku_mappings.global_sku. One alias cannot point at two thicknesses, and
 * STN-DKT-NIL / STN-DKT-VEG / STN-DKT-BEN are not Hub SKUs.
 * STN-DKT-BEN2.0 is Bento. Bedrock is STN-DKT-BR2.0.
 *
 * Alias keys are the parser key: TYPE + normalized thickness ("NILLIUM 1.2").
 * Bare color names are stored only when that color has a single thickness.
 *
 * publishToKatana refuses any root that is not FIN-*. Firepit inserts are
 * raw materials, so after that refusal the script publishes with
 * syncRawMaterialToKatana (POST /materials).
 *
 * Dry-run is the default. Live writes require --confirm.
 * KHALO vs KHALO KC is prompted on a TTY, or pass --khalo=yes / --khalo=no.
 *
 *   npm run ops:seed-dekton-aliases
 *   npm run ops:seed-dekton-aliases:confirm
 *   npm run ops:seed-dekton-aliases:confirm -- --khalo=yes
 */
import { loadEnvConfig } from "@next/env";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { createRawMaterial } from "../../src/app/admin/raw-materials/actions";
import { syncRawMaterialToKatana } from "../../src/lib/katana";
import { loadHubProductGraph } from "../../src/server/mdm/load-hub-product-graph";
import { publishToKatana } from "../../src/server/mdm/publish-channels";
import { closeDb, getDb } from "../../src/server/db/client";
import { sku_aliases, sku_mappings } from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");
const REASON = "inventory-migration-2026";

export type DektonSheetAlias = {
  aliasSku: string;
  canonicalSku: string;
  note: string;
};

type AliasRow = DektonSheetAlias;

/** Unambiguous sheet spellings from the 2026-07-23 Dekton count. */
export const DEFINITE_ALIASES: readonly AliasRow[] = [
  {
    aliasSku: "NILLIUM 1.2",
    canonicalSku: "STN-DKT-NIL1.2",
    note: "Sheet NILLIUM 1.2 cm → NILIUM 1.2. Bare NILLIUM is not stored; 2.0 is a different SKU.",
  },
  {
    aliasSku: "NILLIUM 2.0",
    canonicalSku: "STN-DKT-NIL2.0",
    note: "Sheet thickness 2 → suffix 2.0.",
  },
  {
    aliasSku: "VEHGA",
    canonicalSku: "STN-DKT-VEG1.2",
    note: "Only a 1.2 cm row exists on the count.",
  },
  {
    aliasSku: "VEHGA 1.2",
    canonicalSku: "STN-DKT-VEG1.2",
    note: "Parser key TYPE + thickness.",
  },
  {
    aliasSku: "BEDROCK",
    canonicalSku: "STN-DKT-BR2.0",
    note: "BED ROCK 2.0. Not STN-DKT-BEN2.0 (that SKU is Bento).",
  },
  {
    aliasSku: "BEDROCK 2.0",
    canonicalSku: "STN-DKT-BR2.0",
    note: "Parser key TYPE + thickness.",
  },
  {
    aliasSku: "TRILLIUM",
    canonicalSku: "STN-DKT-TRI1.2",
    note: "Sheet TRILLIUM → TRILIUM 1.2. The count has no 2.0 row and the Hub has no STN-DKT-TRI2.0.",
  },
  {
    aliasSku: "TRILLIUM 1.2",
    canonicalSku: "STN-DKT-TRI1.2",
    note: "Parser key TYPE + thickness.",
  },
  {
    aliasSku: "KEYLA",
    canonicalSku: "STN-DKT-KEL1.2",
    note: "Sheet KEYLA → KELYA 1.2. Only a 1.2 cm row exists on the count.",
  },
  {
    aliasSku: "KEYLA 1.2",
    canonicalSku: "STN-DKT-KEL1.2",
    note: "Parser key TYPE + thickness.",
  },
  {
    aliasSku: "VOLTERRA",
    canonicalSku: "STN-DKT-VAL1.2",
    note: "Sheet VOLTERRA → VALTERRA 1.2. Only a 1.2 cm row exists on the count.",
  },
  {
    aliasSku: "VOLTERRA 1.2",
    canonicalSku: "STN-DKT-VAL1.2",
    note: "Parser key TYPE + thickness.",
  },
  {
    aliasSku: "EMB EMBALAJE",
    canonicalSku: "STN-DKT-EMB2.0",
    note: "Sheet EMB EMBALAJE thickness 2 → EMBALAJE 2.0.",
  },
  {
    aliasSku: "EMB EMBALAJE 2.0",
    canonicalSku: "STN-DKT-EMB2.0",
    note: "Parser key TYPE + thickness. Sheet thickness 2 is stored as 2.0.",
  },
];

export const KHALO_ALIAS: AliasRow = {
  aliasSku: "KHALO 2.0",
  canonicalSku: "STN-DKT-KK2.0",
  note: "Operator confirmed KHALO and KHALO KC 2.0 are the same slab.",
};

/**
 * Sheet key → Hub SKU for the inventory cleanse.
 * Includes KHALO. The seeder below still prompts before writing that alias.
 */
export const DEKTON_SHEET_ALIASES: readonly DektonSheetAlias[] = [
  ...DEFINITE_ALIASES,
  KHALO_ALIAS,
];

const LP_FIREPITS: Array<{ sku: string; name: string }> = [
  {
    sku: "FRP-HPC-TORMLFPK36TRGHFLEXLP",
    name: '36" Trough Flex LP',
  },
  {
    sku: "FRP-HPC-TORFPPK60TRGHFLEXLP",
    name: '60" Trough Flex LP',
  },
  {
    sku: "FRP-HPC-TORFPPK72TRGHFLEXLP",
    name: '72" Trough Flex LP',
  },
];

function flagValue(name: string): "yes" | "no" | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  const value = hit.slice(prefix.length).trim().toLowerCase();
  if (value === "yes" || value === "y") return "yes";
  if (value === "no" || value === "n") return "no";
  throw new Error(`${prefix} expects yes or no (got ${value})`);
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function resolveKhalo(): Promise<boolean> {
  const flag = flagValue("khalo");
  if (flag === "yes") return true;
  if (flag === "no") return false;
  if (!input.isTTY) {
    console.log(
      "  KHALO alias skipped (stdin is not a TTY). Re-run with --khalo=yes or --khalo=no.",
    );
    return false;
  }
  console.log(
    "KHALO on the slab count is 0.5 of a 2.0 cm slab. The Hub SKU is STN-DKT-KK2.0, original name KHALO KC 2.0.",
  );
  return askYesNo(
    "Are KHALO and KHALO KC the same material? Alias KHALO 2.0 → STN-DKT-KK2.0? [y/N] ",
  );
}

async function assertCanonical(sku: string): Promise<void> {
  if (sku.startsWith("STN-DKT-BEN")) {
    throw new Error(
      `${sku} is Bento, not Bedrock. Bedrock canonical is STN-DKT-BR2.0.`,
    );
  }
  const db = getDb();
  const [row] = await db
    .select({ sku: sku_mappings.global_sku, name: sku_mappings.original_name })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!row) {
    throw new Error(
      `Canonical ${sku} is not in sku_mappings. Refusing to insert an alias that would fail the foreign key.`,
    );
  }
  console.log(`  canonical ${row.sku} exists (${row.name})`);
}

async function upsertAlias(row: AliasRow): Promise<void> {
  const db = getDb();
  const aliasSku = row.aliasSku.trim().toUpperCase();
  const canonicalSku = row.canonicalSku.trim().toUpperCase();
  const [existing] = await db
    .select({
      alias: sku_aliases.alias_sku,
      canonical: sku_aliases.canonical_sku,
    })
    .from(sku_aliases)
    .where(eq(sku_aliases.alias_sku, aliasSku))
    .limit(1);

  if (existing) {
    if (existing.canonical !== canonicalSku) {
      throw new Error(
        `Alias ${aliasSku} already points at ${existing.canonical}, not ${canonicalSku}.`,
      );
    }
    console.log(`  exists ${aliasSku} → ${canonicalSku}`);
    return;
  }

  if (!confirm) {
    console.log(`  would insert ${aliasSku} → ${canonicalSku} (${row.note})`);
    return;
  }

  await db.insert(sku_aliases).values({
    alias_sku: aliasSku,
    canonical_sku: canonicalSku,
    reason: REASON,
  });
  console.log(`  inserted ${aliasSku} → ${canonicalSku}`);
}

async function publishFirepit(sku: string): Promise<void> {
  const graph = await loadHubProductGraph(sku);
  try {
    const published = await publishToKatana(graph);
    console.log(
      `  publishToKatana ${sku} externalId=${published.externalId ?? "none"} skipped=${published.skipped}`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("FIN-*") && !message.includes("Catalog root")) {
      throw error;
    }
    console.log(
      `  publishToKatana refused ${sku}: catalog publish only accepts FIN-* roots. Posting the material with syncRawMaterialToKatana.`,
    );
  }

  const synced = await syncRawMaterialToKatana(sku);
  if (!synced.ok) {
    throw new Error(`Katana material sync failed for ${sku}: ${synced.error}`);
  }
  console.log(
    `  Katana ${synced.action} ${sku} variant=${synced.variantId ?? "?"} material=${synced.materialId ?? "?"}`,
  );
}

async function skuExists(sku: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  return Boolean(row);
}

async function mintFirepit(sku: string, name: string): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  if (!confirm) {
    console.log(
      existing
        ? `  would publish existing ${sku}`
        : `  would createRawMaterial ${sku} "${name}" then publish to Katana`,
    );
    return;
  }

  if (!existing) {
    const created = await createRawMaterial({
      sku,
      name,
      category: "Firepit",
      unitOfMeasure: "ea",
      attributes: { "fire_specs.fuel": "LP" },
    });
    const revalidateOnly =
      !created.ok &&
      created.error.includes("revalidatePath") &&
      (await skuExists(sku));
    if ((!created.ok || !created.material) && !revalidateOnly) {
      throw new Error(
        `createRawMaterial ${sku} failed: ${created.ok ? "no row" : created.error}`,
      );
    }
    if (revalidateOnly) {
      console.log(
        `  minted ${sku} (Hub row committed; revalidatePath is unavailable outside Next.js)`,
      );
    } else if (created.ok && created.material) {
      if (created.material.sku !== sku) {
        throw new Error(
          `createRawMaterial minted ${created.material.sku} instead of ${sku}. Stopped before a duplicate SKU was published.`,
        );
      }
      console.log(`  minted ${created.material.sku} (${created.material.name})`);
    }
  } else {
    console.log(`  hub SKU already present: ${sku}`);
  }

  await publishFirepit(sku);
}

async function main(): Promise<void> {
  console.log("Seed Dekton aliases + LP firepit inserts");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);

  const aliases = [...DEFINITE_ALIASES];
  const khaloSame = await resolveKhalo();
  if (khaloSame) {
    aliases.push(KHALO_ALIAS);
    console.log("  KHALO confirmed. Will alias KHALO 2.0 → STN-DKT-KK2.0.");
  } else {
    console.log("  KHALO not aliased. STN-DKT-KK2.0 stays a ghost until you confirm.");
  }

  console.log("\nAliases");
  for (const row of aliases) {
    await assertCanonical(row.canonicalSku);
    await upsertAlias(row);
  }

  console.log("\nLP firepit inserts");
  for (const item of LP_FIREPITS) {
    await mintFirepit(item.sku, item.name);
  }

  if (!confirm) {
    console.log("Re-run with --confirm to write Hub rows and publish the three LP materials.");
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalized = entry.replace(/\\/g, "/");
  if (normalized.endsWith("/scripts/ops/seed-dekton-aliases.ts")) return true;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const cause =
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : error instanceof Error && error.cause != null
            ? String(error.cause)
            : "";
      console.error(cause ? `${message}\n${cause}` : message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
