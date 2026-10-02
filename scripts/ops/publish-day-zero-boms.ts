/**
 * Day Zero Katana recipe replace.
 *
 * Builds FG → frame / cushion → raw materials from the OBJ metal review
 * plus heuristic fabric, foam, caps, and powder. Default is dry-run.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/publish-day-zero-boms.ts --dry-run --only "1 BRAVADA club chair.obj"
 *   npx dotenv -e .env.local -- tsx scripts/ops/publish-day-zero-boms.ts --confirm --only "1 BRAVADA club chair.obj"
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  DAY_ZERO_POWDER_PREFERRED,
  applyResolvedFin,
  buildDayZeroDocument,
  powderFallbackSku,
  type DayZeroDocument,
  type DayZeroParent,
  type DayZeroReviewFile,
  type DayZeroRow,
} from "../../src/lib/day-zero-bom";
import {
  KatanaApiError,
  createIntervalPacer,
  ensureKatanaVariantForSku,
  findVariantBySku,
  replaceKatanaVariantRecipe,
  setKatanaRequestPacer,
  type KatanaVariantRecord,
} from "../../src/lib/katana";
import { canMutateKatanaCatalog } from "../../src/server/pipeline/catalog-mode";
import { closeDb, getDb } from "../../src/server/db/client";
import { product_bom, product_bom_draft, sku_mappings } from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const REVIEW_PATH = path.join(process.cwd(), "tmp", "obj-metal-bom-review.json");
const CLUB_CHAIR_FILE = "1 BRAVADA club chair.obj";

const confirm = process.argv.includes("--confirm") && !process.argv.includes("--dry-run");

function readOnlyFile(): string | null {
  const inline = process.argv.find((arg) => arg.startsWith("--only="));
  if (inline) return inline.slice("--only=".length).trim();
  const index = process.argv.indexOf("--only");
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--only requires the OBJ file name.");
  }
  return value;
}

const onlyFile = readOnlyFile();

type ResolvedRow = DayZeroRow & { variantId: number | null };
type ResolvedParent = {
  role: DayZeroParent["role"];
  sku: string;
  variantId: number | null;
  productId: number | null;
  productAction: "reuse" | "create" | "needs_variant";
  rows: ResolvedRow[];
};

type ResolvedDocument = {
  generatedAt: string;
  mode: "dry-run" | "confirm";
  file: string;
  status: DayZeroDocument["status"];
  skipReason: string | null;
  resolution: "sized_variant" | "base_target" | "filename_sku" | "needs_variant" | null;
  dimSource: DayZeroDocument["dimSource"];
  widthIn: number | null;
  depthIn: number | null;
  family: DayZeroDocument["family"];
  finCandidates: string[];
  finSku: string | null;
  frameSku: string | null;
  cushionSku: string | null;
  tubeNetFt: number;
  scrapIncludedInQuantity: true;
  powderSku: string | null;
  parents: ResolvedParent[];
};

function loadReviewFiles(): DayZeroReviewFile[] {
  const raw = JSON.parse(readFileSync(REVIEW_PATH, "utf8")) as { files?: DayZeroReviewFile[] };
  const files = raw.files ?? [];
  if (!onlyFile) return files;
  const match = files.filter((file) => file.file === onlyFile);
  if (match.length === 0) {
    throw new Error(`No review row named ${onlyFile} in ${REVIEW_PATH}`);
  }
  return match;
}

async function lookupSku(sku: string): Promise<KatanaVariantRecord | null> {
  return findVariantBySku(sku);
}

function resolutionOf(
  matchedSku: string | null,
  candidates: string[],
  baseCandidate: string,
): ResolvedDocument["resolution"] {
  if (!matchedSku) return "needs_variant";
  if (matchedSku === baseCandidate) return "base_target";
  if (candidates[0] === matchedSku && matchedSku !== baseCandidate) return "sized_variant";
  return "filename_sku";
}

async function resolveDocument(file: DayZeroReviewFile): Promise<ResolvedDocument> {
  const preview = buildDayZeroDocument(file);
  if (preview.status === "skipped") {
    return {
      generatedAt: new Date().toISOString(),
      mode: confirm ? "confirm" : "dry-run",
      file: file.file,
      status: "skipped",
      skipReason: preview.skipReason,
      resolution: null,
      dimSource: null,
      widthIn: null,
      depthIn: null,
      family: preview.family,
      finCandidates: [],
      finSku: null,
      frameSku: null,
      cushionSku: null,
      tubeNetFt: 0,
      scrapIncludedInQuantity: true,
      powderSku: null,
      parents: [],
    };
  }

  const baseCandidate = file.finCandidate.trim().toUpperCase();
  let matched: KatanaVariantRecord | null = null;
  let matchedSku: string | null = null;
  for (const sku of preview.finCandidates) {
    const variant = await lookupSku(sku);
    if (variant) {
      matched = variant;
      matchedSku = sku;
      break;
    }
  }
  const finSku = matchedSku ?? preview.finCandidates[preview.finCandidates.length - 1] ?? baseCandidate;
  const built = applyResolvedFin(file, finSku);

  let powderSku = powderFallbackSku();
  const preferredPowder = await lookupSku(DAY_ZERO_POWDER_PREFERRED);
  if (preferredPowder) powderSku = DAY_ZERO_POWDER_PREFERRED;

  const parents: ResolvedParent[] = [];
  for (const parent of built.parents) {
    const variant = parent.role === "finished_good" ? matched : await lookupSku(parent.sku);
    const rows: ResolvedRow[] = [];
    for (const row of parent.rows) {
      const ingredientSku = row.ingredientSku === DAY_ZERO_POWDER_PREFERRED ? powderSku : row.ingredientSku;
      const ingredient = await lookupSku(ingredientSku);
      rows.push({
        ...row,
        ingredientSku,
        variantId: ingredient?.id ?? null,
      });
    }
    parents.push({
      role: parent.role,
      sku: parent.sku,
      variantId: variant?.id ?? null,
      productId: variant?.product_id ?? null,
      productAction:
        parent.role === "finished_good"
          ? variant
            ? "reuse"
            : "needs_variant"
          : variant
            ? "reuse"
            : "create",
      rows,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: confirm ? "confirm" : "dry-run",
    file: file.file,
    status: "ready",
    skipReason: null,
    resolution: resolutionOf(matchedSku, preview.finCandidates, baseCandidate),
    dimSource: built.dimSource,
    widthIn: built.widthIn,
    depthIn: built.depthIn,
    family: built.family,
    finCandidates: preview.finCandidates,
    finSku: built.finSku,
    frameSku: built.frameSku,
    cushionSku: built.cushionSku,
    tubeNetFt: built.tubeNetFt,
    scrapIncludedInQuantity: true,
    powderSku,
    parents,
  };
}

function assertPushable(doc: ResolvedDocument): void {
  if (doc.status !== "ready") throw new Error(`${doc.file} is skipped (${doc.skipReason}).`);
  const fin = doc.parents.find((parent) => parent.role === "finished_good");
  if (!fin?.variantId) throw new Error(`${doc.finSku} is not a live Katana variant.`);
  const createdHere = new Set(
    doc.parents.filter((parent) => parent.productAction === "create").map((parent) => parent.sku),
  );
  for (const parent of doc.parents) {
    for (const row of parent.rows) {
      if (row.variantId == null && !createdHere.has(row.ingredientSku)) {
        throw new Error(
          `${doc.file} ingredient ${row.ingredientSku} has no Katana variant. Refusing to delete recipes.`,
        );
      }
    }
  }
}

async function ensureHubSku(
  sku: string,
  itemType: "sub_assembly" | "raw_material",
  uom: string,
  variantId: number | null,
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (existing) return;
  await db.insert(sku_mappings).values({
    global_sku: sku,
    category: itemType === "raw_material" ? "Metal" : "Day Zero",
    item_type: itemType,
    original_name: sku,
    source_file: "day-zero",
    uom_consume: uom,
    uom_purchase: uom,
    katana_variant_id: variantId,
    is_active: true,
  });
}

async function replaceHub(doc: ResolvedDocument): Promise<void> {
  const db = getDb();
  const parents = doc.parents.map((parent) => parent.sku);
  for (const parent of doc.parents) {
    if (parent.role !== "finished_good") {
      await ensureHubSku(parent.sku, "sub_assembly", "ea", parent.variantId);
    }
    for (const row of parent.rows) {
      if (row.ingredientSku.startsWith("ASM-") || row.ingredientSku.startsWith("SA-")) {
        continue;
      }
      await ensureHubSku(row.ingredientSku, "raw_material", row.uom, row.variantId);
    }
  }
  const liveRows = doc.parents.flatMap((parent) =>
    parent.rows.map((row) => ({
      parent_sku: parent.sku,
      child_sku: row.ingredientSku,
      quantity: row.quantity.toFixed(4),
      scrap_factor: "1.0000",
      unit_of_measure: row.uom,
      notes: row.notes,
      cut_list: row.cutList,
    })),
  );
  const draftRows = liveRows.map((row) => ({
    ...row,
    status: "factory_approved" as const,
    source: "manager" as const,
    reviewed_by: "day-zero",
    reviewed_at: new Date(),
  }));

  await db.transaction(async (tx) => {
    for (const parent of parents) {
      await tx.delete(product_bom).where(eq(product_bom.parent_sku, parent));
      await tx.delete(product_bom_draft).where(eq(product_bom_draft.parent_sku, parent));
    }
    if (liveRows.length > 0) await tx.insert(product_bom).values(liveRows);
    if (draftRows.length > 0) await tx.insert(product_bom_draft).values(draftRows);
  });
}

async function replaceKatana(doc: ResolvedDocument): Promise<void> {
  const order: Array<ResolvedParent["role"]> = ["cushion", "frame", "finished_good"];
  for (const role of order) {
    const parent = doc.parents.find((item) => item.role === role);
    if (!parent) continue;
    let variantId = parent.variantId;
    if (variantId == null && role !== "finished_good") {
      const ensured = await ensureKatanaVariantForSku(parent.sku);
      if (!ensured.ok) throw new Error(ensured.error);
      variantId = ensured.variantId;
      parent.variantId = variantId;
      const finished = doc.parents.find((item) => item.role === "finished_good");
      for (const row of finished?.rows ?? []) {
        if (row.ingredientSku === parent.sku) row.variantId = variantId;
      }
    }
    if (variantId == null) throw new Error(`${parent.sku} has no Katana variant.`);
    await replaceKatanaVariantRecipe(
      variantId,
      parent.rows.map((row) => ({
        ingredientVariantId: row.variantId!,
        quantity: row.quantity,
        notes: row.notes,
      })),
      `day0-bom:${parent.sku}`,
    );
    console.log(`  replaced ${parent.sku} variant ${variantId} rows=${parent.rows.length}`);
  }
}

function writePayload(docs: ResolvedDocument[]): void {
  const outDir = path.join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: confirm ? "confirm" : "dry-run",
    scrapIncludedInQuantity: true,
    files: docs,
  };
  const reviewPath = path.join(outDir, "day-zero-bom-dry-run.json");
  writeFileSync(reviewPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${path.relative(process.cwd(), reviewPath)}`);
  const club = docs.find((doc) => doc.file === CLUB_CHAIR_FILE);
  if (club) {
    const clubPath = path.join(outDir, "day-zero-bom-bravada-club.json");
    writeFileSync(clubPath, JSON.stringify(club, null, 2));
    console.log(`Wrote ${path.relative(process.cwd(), clubPath)}`);
  }
}

function printSummary(doc: ResolvedDocument): void {
  console.log(`\n${doc.file}`);
  if (doc.status === "skipped") {
    console.log(`  skipped ${doc.skipReason}`);
    return;
  }
  console.log(
    `  resolution=${doc.resolution} fin=${doc.finSku} dimSource=${doc.dimSource} ${doc.widthIn}x${doc.depthIn} powder=${doc.powderSku}`,
  );
  for (const parent of doc.parents) {
    console.log(`  ${parent.role} ${parent.sku} variant=${parent.variantId ?? "none"} ${parent.productAction}`);
    for (const row of parent.rows) {
      console.log(`    ${row.ingredientSku} ${row.quantity} ${row.uom} variant=${row.variantId ?? "none"}`);
      if (row.notes) console.log(`      ${row.notes}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(confirm ? "LIVE confirm. Day Zero recipe replace is enabled." : "Dry-run. No Katana or hub writes.");
  setKatanaRequestPacer(createIntervalPacer(1300));
  const files = loadReviewFiles();
  const docs: ResolvedDocument[] = [];
  for (const file of files) {
    docs.push(await resolveDocument(file));
  }
  writePayload(docs);
  for (const doc of docs) {
    if (doc.file === CLUB_CHAIR_FILE || files.length === 1) printSummary(doc);
  }

  if (!confirm) return;
  if (!canMutateKatanaCatalog()) {
    throw new Error("Refusing --confirm while catalog publish mode is not live.");
  }
  const failures: string[] = [];
  for (const doc of docs) {
    if (doc.status === "skipped") {
      console.log(`  skip ${doc.file} (${doc.skipReason})`);
      continue;
    }
    if (doc.resolution === "needs_variant") {
      console.log(`  skip ${doc.file} needs_variant ${doc.finSku}`);
      continue;
    }
    try {
      assertPushable(doc);
      await replaceHub(doc);
      await replaceKatana(doc);
      console.log(`  hub + Katana replaced for ${doc.finSku}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${doc.file}: ${message}`);
      failures.push(`${doc.file}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} product(s) failed.\n${failures.join("\n")}`);
  }
}

const invoked = process.argv[1]?.replace(/\\/g, "/").includes("publish-day-zero-boms");
if (invoked) {
  main()
    .catch((error: unknown) => {
      if (error instanceof KatanaApiError && error.details != null) {
        console.error(JSON.stringify(error.details, null, 2));
      }
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
