import { eq } from "drizzle-orm";
import {
  critiqueCutlistPlan,
  DEFAULT_TUBE_SCRAP_FACTOR,
  formatCutNote,
  inchesToFeet,
  instantiateBravadaClubChair,
  instantiateWaterfallDiningTable,
  parseDaeWeldmentFromXml,
  profileToRmSku,
  type CutLine,
  type DraftBomLine,
  type InstantiatedPlan,
  type WalkerExport,
  type WalkerStick,
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

function stickCut(stick: WalkerStick): CutLine | null {
  const lengthIn = stick.nameLengthIn ?? stick.obbLengthIn;
  if (lengthIn == null || lengthIn <= 0 || stick.profile === "UNKNOWN") return null;
  const qtyEa = stick.instanceCount > 0 ? stick.instanceCount : 1;
  const endA = stick.endA ?? 90;
  const endB = stick.endB ?? 90;
  return {
    role: stick.definitionName,
    profile: stick.profile,
    lengthIn,
    endA,
    endB,
    qtyEa,
    lengthConvention: endA === 45 || endB === 45 ? "long_point" : "square",
    sourceName: stick.definitionName,
    confidence: stick.confidence,
    drawingPartNumber: null,
  };
}

/** Unknown Collada files roll up stick profiles. They do not borrow a family fixture. */
function instantiateGeometryRollup(
  walker: WalkerExport,
  preferredSku?: string,
): InstantiatedPlan {
  const finSku = (preferredSku || walker.productHint || "GEOM-UNMAPPED").toUpperCase();
  const byRm = new Map<string, { feet: number; notes: string[]; cutList: CutLine[] }>();
  for (const stick of walker.sticks) {
    const cut = stickCut(stick);
    if (!cut) continue;
    const rm = profileToRmSku(cut.profile);
    const bucket = byRm.get(rm) ?? { feet: 0, notes: [], cutList: [] };
    bucket.feet += inchesToFeet(cut.lengthIn) * cut.qtyEa;
    bucket.notes.push(
      formatCutNote({
        qtyEa: cut.qtyEa,
        lengthIn: cut.lengthIn,
        endA: cut.endA,
        endB: cut.endB,
        convention: cut.lengthConvention,
        role: cut.role,
      }),
    );
    bucket.cutList.push(cut);
    byRm.set(rm, bucket);
  }

  const lines: DraftBomLine[] = [...byRm.entries()].map(([childSku, bucket]) => ({
    parentSku: finSku,
    childSku,
    quantity: Math.round(bucket.feet * 10000) / 10000,
    scrapFactor: DEFAULT_TUBE_SCRAP_FACTOR,
    unitOfMeasure: "ft",
    notes: bucket.notes.join("; "),
    cutList: bucket.cutList,
  }));

  return {
    finSku,
    seatSku: finSku,
    armSku: null,
    backSku: null,
    cushSku: null,
    hubSkus: [
      {
        globalSku: finSku,
        itemType: "finished_good",
        originalName: walker.productHint ?? finSku,
        category: "Geometry",
      },
    ],
    lines,
    flags: [...walker.flags, "geometry_rollup"],
  };
}

export function buildPlan(walker: WalkerExport, preferredSku?: string): InstantiatedPlan {
  const hint = `${walker.productHint ?? ""} ${preferredSku ?? ""}`;
  const opts = preferredSku ? { finSku: preferredSku } : undefined;
  if (/WFT|WATERFALL/i.test(hint)) {
    return instantiateWaterfallDiningTable(walker, opts);
  }
  if (/BRV|BRAVADA/i.test(hint)) {
    return instantiateBravadaClubChair(walker, opts);
  }
  return instantiateGeometryRollup(walker, preferredSku);
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

    const notesPayload = line.notes;
    const cutListPayload = line.cutList;

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
        cut_list: cutListPayload,
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
          cut_list: cutListPayload,
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
      work_center: "FAB POD A",
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
