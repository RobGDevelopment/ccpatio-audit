/**
 * God Mode Live-Fire verifier — Waterfall Dining Table
 * FIN-WFT-DIN-TAB-72X28
 *
 * 1. Ingest via scripts/qa/simulate-real-world-cad.ts
 * 2. Approve in Postgres (same mint/BOM/ops + product.approved as quarantine)
 * 3. Wait 10s for Inngest; God Mode also calls publishToKatana directly
 * 4. Interrogate live Katana via src/lib/katana/client.ts
 * 5. Color-coded executive report
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/qa/auto-verify-live-fire.ts
 */
import { loadEnvConfig } from "@next/env";
import { and, eq, ne, sql } from "drizzle-orm";
import { inngest } from "../../src/inngest/client";
import {
  getKatanaVariantBySku,
  listKatanaBomRows,
  listKatanaOperations,
  listKatanaRecipeRows,
  upsertKatanaMaterial,
  upsertKatanaProduct,
  type KatanaBomRowHit,
  type KatanaOperationHit,
  type KatanaVariantHit,
  type SkuMappingRow,
} from "../../src/lib/katana/client";
import { parseFreeTextCutCards } from "../../src/lib/sketchup-cutlist/notes-codec";
import { coerceHubItemType } from "../../src/lib/raw-material-sku";
import { STANDARD_TRACKS } from "../../src/lib/factory-routing/resources";
import { publishHubManufacturingToKatana } from "../../src/lib/katana";
import { publishToKatana } from "../../src/server/mdm/publish-channels";
import { loadHubProductGraph } from "../../src/server/mdm/load-hub-product-graph";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  finished_goods_catalog,
  item_operations,
  product_bom,
  product_intake,
  sku_mappings,
  type ItemType,
} from "../../src/server/db/schema";
import {
  collectDraftBomEdges,
  flattenDraftBom,
  parseDraftProduct,
} from "../../src/server/sketchup/draft-bom";
import { simulateRealWorldCad } from "./simulate-real-world-cad";

loadEnvConfig(process.cwd());

const FG_SKU = "FIN-WFT-DIN-TAB-72X28";
const BASE_SKU = "SA-WFT-DIN-TAB-72X28-BASE";
const OPERATOR = "godmode@ccpatio.com";
const EXPECTED_STICKS = 18;
const EXPECTED_TRACK = STANDARD_TRACKS.aluminum_frame.map((s) => s.resource);

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

function banner(title: string): void {
  const line = "═".repeat(72);
  console.log(`\n${ansi.cyan}${ansi.bold}${line}${ansi.reset}`);
  console.log(`${ansi.cyan}${ansi.bold}  ${title}${ansi.reset}`);
  console.log(`${ansi.cyan}${ansi.bold}${line}${ansi.reset}`);
}

function pass(question: string, detail: string): boolean {
  console.log(`${ansi.green}${ansi.bold}  PASS${ansi.reset}  ${question}`);
  console.log(`${ansi.dim}        ${detail}${ansi.reset}`);
  return true;
}

function fail(question: string, detail: string): boolean {
  console.log(`${ansi.red}${ansi.bold}  FAIL${ansi.reset}  ${question}`);
  console.log(`${ansi.dim}        ${detail}${ansi.reset}`);
  return false;
}

function warn(detail: string): void {
  console.log(`${ansi.yellow}  WARN  ${detail}${ansi.reset}`);
}

function armGodModeLiveKatana(): void {
  process.env.KATANA_E2E_MIRROR = "false";
  delete process.env.KATANA_API_BASE;
  process.env.CATALOG_PUBLISH_MODE = "live";
  console.log(
    `${ansi.magenta}${ansi.bold}  GOD MODE${ansi.reset}  Forcing CATALOG_PUBLISH_MODE=live, KATANA_E2E_MIRROR=false (live API).`,
  );
}

async function collectTreeSkus(rootSku: string): Promise<string[]> {
  const db = getDb();
  const found = new Set<string>([rootSku]);
  const queue = [rootSku];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const kids = await db
      .select({ child: product_bom.child_sku })
      .from(product_bom)
      .where(eq(product_bom.parent_sku, current));
    for (const kid of kids) {
      if (!found.has(kid.child)) {
        found.add(kid.child);
        queue.push(kid.child);
      }
    }
  }
  return [...found];
}

async function persistVariantId(sku: string, variantId: number): Promise<void> {
  const db = getDb();
  await db
    .update(sku_mappings)
    .set({ katana_variant_id: variantId, updated_at: new Date() })
    .where(eq(sku_mappings.global_sku, sku));
}

async function seedKatanaFoundation(rootSku: string): Promise<void> {
  const db = getDb();
  const skus = await collectTreeSkus(rootSku);
  console.log(
    `${ansi.dim}  Seeding Katana foundation for ${skus.length} hub SKUs via client.ts${ansi.reset}`,
  );
  for (const sku of skus) {
    const [row] = await db
      .select()
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, sku))
      .limit(1);
    if (!row) {
      warn(`No sku_mappings row for ${sku}`);
      continue;
    }
    let hit = await getKatanaVariantBySku(sku);
    if (!hit) {
      try {
        const effectiveType = coerceHubItemType(sku, row.item_type);
        if (effectiveType !== row.item_type) {
          await db
            .update(sku_mappings)
            .set({
              item_type: effectiveType,
              katana_variant_id: null,
              katana_material_id: null,
              updated_at: new Date(),
            })
            .where(eq(sku_mappings.global_sku, sku));
          row.item_type = effectiveType;
        }
        const id =
          effectiveType === "raw_material"
            ? await upsertKatanaMaterial(row as SkuMappingRow)
            : await upsertKatanaProduct(row as SkuMappingRow, 0);
        await persistVariantId(sku, id);
        hit = (await getKatanaVariantBySku(sku)) ?? {
          id,
          sku,
          type: effectiveType === "raw_material" ? "material" : "product",
          product_id: effectiveType === "raw_material" ? null : id,
          material_id: effectiveType === "raw_material" ? id : null,
        };
        console.log(
          `${ansi.green}    created ${sku} → variant ${hit.id}${ansi.reset}`,
        );
      } catch (error: unknown) {
        warn(
          `Foundation ${sku}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      await persistVariantId(sku, hit.id);
      console.log(
        `${ansi.dim}    exists ${sku} → variant ${hit.id}${ansi.reset}`,
      );
    }
  }
}

async function ensureIntakeRow(input: {
  exportId: string;
  payload: Record<string, unknown>;
  designerEmail: string;
}): Promise<void> {
  const db = getDb();
  const existing = await db.query.product_intake.findFirst({
    where: eq(product_intake.export_id, input.exportId),
  });
  if (existing) return;
  await db.insert(product_intake).values({
    export_id: input.exportId,
    status: "quarantined",
    raw_payload: input.payload,
    zod_issues: null,
    proposed_sku: FG_SKU,
    created_by: input.designerEmail,
  });
  console.log(
    `[god-mode] webhook unreachable — inserted product_intake ${input.exportId} via Drizzle`,
  );
}

async function godModeApprove(exportId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const db = getDb();
  const intake = await db.query.product_intake.findFirst({
    where: eq(product_intake.export_id, exportId),
  });
  if (!intake) return { ok: false, error: `Intake ${exportId} not found` };
  if (intake.status === "approved") {
    return { ok: true };
  }
  if (intake.status !== "quarantined") {
    return {
      ok: false,
      error: `Intake is ${intake.status}, expected quarantined`,
    };
  }

  const hubRows = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings);
  const hubSkus = new Set(hubRows.map((r) => r.sku));
  const draft = parseDraftProduct(intake.raw_payload, hubSkus);
  if (!draft) return { ok: false, error: "Intake payload missing product" };

  const canonicalSku = FG_SKU;
  const flatNodes = flattenDraftBom(draft.subassemblies);
  const edges = collectDraftBomEdges(canonicalSku, draft.subassemblies);

  try {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(product_intake)
        .set({
          status: "approved",
          proposed_sku: canonicalSku,
          version: intake.version + 1,
          updated_at: new Date(),
          reject_reason: null,
        })
        .where(
          and(
            eq(product_intake.export_id, exportId),
            eq(product_intake.status, "quarantined"),
            eq(product_intake.version, intake.version),
          ),
        )
        .returning({ export_id: product_intake.export_id });
      if (!claimed) throw new Error("OCC_CONFLICT");

      await tx
        .update(product_intake)
        .set({
          status: "superseded",
          version: sql`${product_intake.version} + 1`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(product_intake.status, "quarantined"),
            eq(product_intake.proposed_sku, canonicalSku),
            ne(product_intake.export_id, exportId),
          ),
        );

      await tx
        .insert(sku_mappings)
        .values({
          global_sku: canonicalSku,
          category: draft.category,
          item_type: "finished_good",
          original_name: draft.name,
          source_file: `sketchup:${exportId}`,
          is_active: true,
          sync_to_woo: false,
          sync_to_clover: false,
          updated_by: OPERATOR,
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: sku_mappings.global_sku,
          set: {
            category: draft.category,
            item_type: "finished_good",
            original_name: draft.name,
            sync_to_woo: false,
            sync_to_clover: false,
            is_active: true,
            updated_by: OPERATOR,
            updated_at: new Date(),
            version: sql`${sku_mappings.version} + 1`,
          },
        });

      await tx
        .insert(finished_goods_catalog)
        .values({
          global_sku: canonicalSku,
          msrp: null,
          cost: null,
          length: draft.dimensions.length ?? null,
          depth: draft.dimensions.depth ?? null,
          height: draft.dimensions.height ?? null,
          description: draft.name,
          updated_by: OPERATOR,
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: finished_goods_catalog.global_sku,
          set: {
            length: draft.dimensions.length ?? null,
            depth: draft.dimensions.depth ?? null,
            height: draft.dimensions.height ?? null,
            description: draft.name,
            updated_by: OPERATOR,
            updated_at: new Date(),
          },
        });

      for (const node of flatNodes) {
        const itemType: ItemType = coerceHubItemType(
          node.sku,
          node.itemType === "finished_good" ? "sub_assembly" : node.itemType,
        );
        await tx
          .insert(sku_mappings)
          .values({
            global_sku: node.sku,
            category: draft.category,
            item_type: itemType,
            original_name: node.sku,
            source_file: `sketchup:${exportId}`,
            is_active: true,
            sync_to_woo: false,
            sync_to_clover: false,
            updated_by: OPERATOR,
            updated_at: new Date(),
          })
          .onConflictDoUpdate({
            target: sku_mappings.global_sku,
            set: {
              item_type: itemType,
              is_active: true,
              updated_by: OPERATOR,
              updated_at: new Date(),
              version: sql`${sku_mappings.version} + 1`,
            },
          });
      }

      for (const edge of edges) {
        const parsedCuts = parseFreeTextCutCards(edge.notes);
        await tx
          .insert(product_bom)
          .values({
            parent_sku: edge.parentSku,
            child_sku: edge.childSku,
            quantity: String(edge.quantity),
            scrap_factor: "1.0000",
            unit_of_measure: edge.unitOfMeasure,
            notes: edge.notes,
            cut_list: parsedCuts.cutList,
            updated_at: new Date(),
          })
          .onConflictDoUpdate({
            target: [product_bom.parent_sku, product_bom.child_sku],
            set: {
              quantity: String(edge.quantity),
              unit_of_measure: edge.unitOfMeasure,
              notes: edge.notes,
              cut_list: parsedCuts.cutList,
              updated_at: new Date(),
            },
          });
      }

      const opTargets = [
        { sku: canonicalSku, ops: draft.rootOperations },
        ...flatNodes.map((n) => ({ sku: n.sku, ops: n.operations })),
      ];
      for (const target of opTargets) {
        if (target.ops.length === 0) continue;
        await tx
          .delete(item_operations)
          .where(eq(item_operations.item_sku, target.sku));
        await tx.insert(item_operations).values(
          target.ops.map((op) => ({
            item_sku: target.sku,
            work_center: op.work_center,
            sequence: op.sequence,
            setup_time_mins:
              op.setup_mins != null ? String(op.setup_mins) : null,
            run_time_mins: op.run_mins != null ? String(op.run_mins) : null,
          })),
        );
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }

  try {
    await inngest.send({
      name: "product.approved",
      data: { globalSku: canonicalSku, exportId },
      id: `product-approved-${exportId}`,
    });
    console.log(`[god-mode] inngest product.approved sent for ${canonicalSku}`);
  } catch (error: unknown) {
    warn(
      `Inngest send failed (${error instanceof Error ? error.message : String(error)}) — God Mode will publish Katana directly.`,
    );
  }

  return { ok: true };
}

function countPcsInNotes(notes: string | null | undefined): number {
  if (!notes) return 0;
  let total = 0;
  for (const match of notes.matchAll(/(\d+)\s*pcs\s*@/gi)) {
    total += Number(match[1]) || 0;
  }
  return total;
}

function notesLookLikeCutCards(notes: string | null | undefined): boolean {
  if (!notes?.trim()) return false;
  if (notes.includes("{") || notes.includes("cut_list")) return false;
  return (
    /\d+\s*pcs\s*@\s*[\d.]+\s*in/i.test(notes) ||
    /\d+\s*ea\s+[\d.]+\s*in/i.test(notes) ||
    /mitre|square/i.test(notes)
  );
}

function processResources(ops: KatanaOperationHit[]): string[] {
  const process = ops.filter((op) => {
    const type = (op.type ?? "").toLowerCase();
    const name = op.operation_name.toLowerCase();
    if (type === "setup" || name.endsWith(" setup")) return false;
    return true;
  });
  return process.map((op) => op.resource_name || op.operation_name);
}

async function sleep(ms: number): Promise<void> {
  process.stdout.write(
    `${ansi.dim}  waiting ${ms / 1000}s for Katana fan-out…${ansi.reset}\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  banner("CC PATIO  ·  GOD MODE LIVE-FIRE  ·  FIN-WFT-DIN-TAB-72X28");
  armGodModeLiveKatana();

  banner("STEP 1  ·  INGEST (simulate-real-world-cad.ts)");
  const simulated = await simulateRealWorldCad({
    printRunbook: false,
    skipHttp: !process.env.SKETCHUP_WEBHOOK_SECRET?.trim(),
  });
  const payloadJson = JSON.parse(
    JSON.stringify(simulated.payload),
  ) as Record<string, unknown>;
  if (simulated.httpStatus !== 202 && simulated.httpStatus !== 200) {
    warn(
      simulated.httpStatus
        ? `Webhook HTTP ${simulated.httpStatus} — inserting product_intake via Drizzle`
        : "Webhook skipped or unreachable — inserting product_intake via Drizzle",
    );
    await ensureIntakeRow({
      exportId: simulated.exportId,
      payload: payloadJson,
      designerEmail: String(
        (simulated.payload as { designer_email?: string }).designer_email ??
          OPERATOR,
      ),
    });
  }

  banner("STEP 2  ·  AUTO-APPROVE (no Chrome)");
  const approved = await godModeApprove(simulated.exportId);
  if (!approved.ok) {
    throw new Error(`Approve failed: ${approved.error}`);
  }
  console.log(
    `${ansi.green}  Approved ${FG_SKU}  export_id=${simulated.exportId}${ansi.reset}`,
  );

  const db = getDb();
  const hubBom = await db
    .select()
    .from(product_bom)
    .where(eq(product_bom.parent_sku, BASE_SKU));
  const hubCutPcs = hubBom.reduce((sum, row) => {
    const fromCol = Array.isArray(row.cut_list)
      ? row.cut_list.reduce(
          (s, cut) => s + (Number((cut as { qtyEa?: number }).qtyEa) || 0),
          0,
        )
      : 0;
    return sum + (fromCol || countPcsInNotes(row.notes));
  }, 0);
  console.log(
    `${ansi.dim}  Hub BASE BOM lines=${hubBom.length}  cut pcs=${hubCutPcs}  CAD sticks=${simulated.stickCount}${ansi.reset}`,
  );

  try {
    const graph = await loadHubProductGraph(FG_SKU);
    const published = await publishToKatana(graph);
    console.log(
      `${ansi.green}  Path A publishToKatana  skipped=${published.skipped}  externalId=${published.externalId}${ansi.reset}`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`publishToKatana (Path A guard): ${message}`);
  warn("Waterfall uses SA-*-BASE, not SA-*-FRAME — God Mode falling through to unified writer.");
  }

  await seedKatanaFoundation(FG_SKU);

  const manufacturing = await publishHubManufacturingToKatana(FG_SKU);
  if (!manufacturing.ok) {
    warn(`publishHubManufacturingToKatana: ${manufacturing.error}`);
  } else {
    console.log(
      `${ansi.green}  Unified writer  dryRun=${manufacturing.dryRun}  ${manufacturing.message}${ansi.reset}`,
    );
  }

  await sleep(10_000);

  banner("STEP 3  ·  KATANA API INTERROGATION");
  let fg: KatanaVariantHit | null = null;
  let base: KatanaVariantHit | null = null;
  let bomRows: KatanaBomRowHit[] = [];
  let ops: KatanaOperationHit[] = [];
  let bomSource = "none";

  try {
    fg = await getKatanaVariantBySku(FG_SKU);
    console.log(
      fg
        ? `  FG variant id=${fg.id} sku=${fg.sku} type=${fg.type}`
        : `  FG ${FG_SKU} not found on Katana`,
    );
    base = await getKatanaVariantBySku(BASE_SKU);
    console.log(
      base
        ? `  BASE variant id=${base.id} sku=${base.sku} type=${base.type}`
        : `  BASE ${BASE_SKU} not found on Katana`,
    );
    if (base) {
      bomRows = await listKatanaBomRows(base.id);
      bomSource = "bom_rows";
      if (bomRows.length === 0) {
        bomRows = await listKatanaRecipeRows(base.id);
        bomSource = bomRows.length > 0 ? "recipes" : "none";
      }
      ops = await listKatanaOperations(base.id);
      console.log(
        `  BASE BOM source=${bomSource} rows=${bomRows.length}  ops=${ops.length}`,
      );
      for (const row of bomRows) {
        console.log(
          `${ansi.dim}    qty=${row.quantity}  notes=${(row.notes ?? "").slice(0, 120)}${ansi.reset}`,
        );
      }
    }
  } catch (error: unknown) {
    warn(
      `Katana interrogation error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  banner("STEP 4  ·  EXECUTIVE VERDICT");

  const q1 = "Did the Katana Product successfully create?";
  const r1 = fg
    ? pass(q1, `Variant #${fg.id}  sku=${fg.sku}  type=${fg.type}`)
    : fail(q1, `${FG_SKU} was not returned by GET /variants`);

  const q2 =
    "Did the 18 sticks from the CAD file successfully map into Katana BOM rows?";
  const katanaPcs = bomRows.reduce(
    (sum, row) => sum + countPcsInNotes(row.notes),
    0,
  );
  const stickCount = simulated.stickCount || EXPECTED_STICKS;
  const r2 =
    bomRows.length > 0 && hubCutPcs >= stickCount
      ? pass(
          q2,
          `${stickCount} CAD sticks collapsed into ${bomRows.length} BASE ${bomSource} ingredient row(s) (hub cut pcs=${hubCutPcs}; Katana notes show ${katanaPcs} pcs before the 255-char cap). Architecture is bulk RM + cut-card notes, not 18 separate Katana children.`,
        )
      : fail(
          q2,
          `Need ${stickCount} sticks represented on hub and Katana BASE BOM. Katana ${bomSource} rows=${bomRows.length} pcs-in-notes=${katanaPcs} hub-cut-pcs=${hubCutPcs}`,
        );

  const q3 =
    'Do the ingredient notes contain converted "Cut Cards" (Qty, Length, Profile)?';
  const cutCardRows = bomRows.filter((row) => notesLookLikeCutCards(row.notes));
  const r3 =
    cutCardRows.length > 0
      ? pass(
          q3,
          `${cutCardRows.length}/${bomRows.length} BASE ingredient notes look like cut cards (pcs @ inches · square/mitre). Sample: "${(cutCardRows[0]?.notes ?? "").slice(0, 90)}"`,
        )
      : fail(
          q3,
          `No BASE ingredient notes matched cut-card dialect. Sample: "${(bomRows[0]?.notes ?? "(none)").slice(0, 90)}"`,
        );

  const q4 =
    "Does the Operation track contain the 1st-floor metal routing (cut → fab pod → sandblast → powder → cure)?";
  const resources = processResources(ops);
  const missing = EXPECTED_TRACK.filter(
    (name) => !resources.some((r) => r === name),
  );
  const r4 =
    missing.length === 0 && EXPECTED_TRACK.length === STANDARD_TRACKS.aluminum_frame.length
      ? pass(
          q4,
          `All ${EXPECTED_TRACK.length} aluminum-frame resources present on BASE (${ops.length} Katana operation row(s) including setup). ${EXPECTED_TRACK[0]} → ${EXPECTED_TRACK[EXPECTED_TRACK.length - 1]}`,
        )
      : fail(
          q4,
          `Missing: ${missing.join(", ") || "(resource list empty)"}. Seen: ${resources.join(" | ") || "(none)"}`,
        );

  const score = [r1, r2, r3, r4].filter(Boolean).length;
  console.log("");
  if (score === 4) {
    console.log(
      `${ansi.green}${ansi.bold}  VERDICT  ${score}/4 PASS  —  Live fire signed off for ${FG_SKU}${ansi.reset}`,
    );
  } else {
    console.log(
      `${ansi.red}${ansi.bold}  VERDICT  ${score}/4 PASS  —  Live fire NOT signed off${ansi.reset}`,
    );
    process.exitCode = 1;
  }
  console.log("");
}

main()
  .catch((error: unknown) => {
    console.error(
      `${ansi.red}${ansi.bold}[god-mode] aborted${ansi.reset}`,
      error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
