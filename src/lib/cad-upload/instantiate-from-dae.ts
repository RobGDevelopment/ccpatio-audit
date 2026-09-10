import { eq } from "drizzle-orm";
import {
  critiqueCutlistPlan,
  instantiateBravadaClubChair,
  instantiateWaterfallDiningTable,
  parseDaeWeldmentFromXml,
  type InstantiatedPlan,
  type WalkerExport,
} from "@/lib/sketchup-cutlist";
import { runSecondaryExtract } from "@/lib/secondary-extraction";
import { getDb } from "@/server/db/client";
import {
  item_operations_draft,
  product_bom_draft,
  sku_mappings,
} from "@/server/db/schema";

export type CadInstantiateResult = {
  finSku: string;
  linesWritten: number;
  criticOk: boolean;
  criticFindings: Array<{ severity: string; code: string; message: string }>;
  estimateWeightLbs?: number;
};

function buildPlan(walker: WalkerExport, preferredSku?: string): InstantiatedPlan {
  const hint = `${walker.productHint ?? ""} ${preferredSku ?? ""}`;
  const opts = preferredSku ? { finSku: preferredSku } : undefined;
  if (/WFT|WATERFALL/i.test(hint)) {
    return instantiateWaterfallDiningTable(walker, opts);
  }
  return instantiateBravadaClubChair(walker, opts);
}

async function ensureHubSkus(plan: InstantiatedPlan): Promise<void> {
  const db = getDb();
  for (const hub of plan.hubSkus) {
    const [existing] = await db
      .select({ sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, hub.globalSku))
      .limit(1);
    if (existing) continue;
    await db.insert(sku_mappings).values({
      global_sku: hub.globalSku,
      category: hub.category,
      item_type: hub.itemType,
      original_name: hub.originalName,
      source_file: "cad_upload_pipeline",
      is_active: true,
    });
  }
}

async function writeDrafts(plan: InstantiatedPlan): Promise<number> {
  const db = getDb();
  let upserts = 0;
  for (const line of plan.lines) {
    const [child] = await db
      .select({ sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, line.childSku))
      .limit(1);
    if (!child) continue;

    const notesPayload = line.cutList.length
      ? `${line.notes}\n${JSON.stringify({ cut_list: line.cutList })}`
      : line.notes;

    await db
      .insert(product_bom_draft)
      .values({
        parent_sku: line.parentSku,
        child_sku: line.childSku,
        quantity: String(line.quantity),
        scrap_factor: String(line.scrapFactor),
        unit_of_measure: line.unitOfMeasure,
        status: "draft_pending_review",
        source: "sketchup_geometry",
        notes: notesPayload,
      })
      .onConflictDoUpdate({
        target: [product_bom_draft.parent_sku, product_bom_draft.child_sku],
        set: {
          quantity: String(line.quantity),
          scrap_factor: String(line.scrapFactor),
          unit_of_measure: line.unitOfMeasure,
          status: "draft_pending_review",
          source: "sketchup_geometry",
          notes: notesPayload,
          updated_at: new Date(),
        },
      });
    upserts += 1;
  }

  const weldSkus = [plan.seatSku, plan.armSku, plan.backSku].filter(
    (s): s is string => Boolean(s),
  );
  for (const sku of weldSkus) {
    const [exists] = await db
      .select({ id: item_operations_draft.id })
      .from(item_operations_draft)
      .where(eq(item_operations_draft.item_sku, sku))
      .limit(1);
    if (exists) continue;
    await db.insert(item_operations_draft).values({
      item_sku: sku,
      work_center: "Building & Welding",
      sequence: 20,
      run_time_mins: "15",
      status: "draft_pending_review",
      source: "sketchup_geometry",
      notes: "From CAD upload pipeline",
    });
  }

  return upserts;
}

/**
 * Parse DAE buffer → critic → product_bom_draft + recipe_estimates_draft.
 * Never writes live product_bom.
 */
export async function instantiateDraftsFromDae(input: {
  xml: Buffer | string;
  sourceLabel: string;
  globalSku: string;
}): Promise<CadInstantiateResult> {
  const parsed = parseDaeWeldmentFromXml(input.xml, input.sourceLabel);
  // Prefer hub SKU as product hint when walker basename differs
  parsed.walker.productHint =
    input.globalSku || parsed.walker.productHint || null;

  const plan = buildPlan(parsed.walker, input.globalSku);

  const critic = critiqueCutlistPlan({ plan, walker: parsed.walker });
  if (!critic.okForDraft) {
    return {
      finSku: plan.finSku,
      linesWritten: 0,
      criticOk: false,
      criticFindings: critic.findings.map((f) => ({
        severity: f.severity,
        code: f.code,
        message: f.message,
      })),
    };
  }

  await ensureHubSkus(plan);
  const linesWritten = await writeDrafts(plan);

  let estimateWeightLbs: number | undefined;
  try {
    const est = await runSecondaryExtract(plan.finSku);
    estimateWeightLbs = est.estWeightLbs;
  } catch {
    /* estimates optional if factors missing */
  }

  return {
    finSku: plan.finSku,
    linesWritten,
    criticOk: true,
    criticFindings: critic.findings.map((f) => ({
      severity: f.severity,
      code: f.code,
      message: f.message,
    })),
    estimateWeightLbs,
  };
}
