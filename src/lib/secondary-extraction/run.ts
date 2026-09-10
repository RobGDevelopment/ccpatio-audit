import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  item_operations_draft,
  material_physics_factors,
  product_bom_draft,
  recipe_estimates_draft,
  sku_mappings,
} from "@/server/db/schema";
import { computeLabor, deriveGeometryDrivers } from "./labor";
import { computePackaging } from "./packaging";
import { parseCutListFromNotes } from "./parse-notes";
import {
  CALC_VERSION,
  type DraftLineInput,
  type PhysicsFactor,
} from "./types";
import { computeWeight } from "./weight";

const ELIGIBLE_OP_SOURCES = ["heuristic", "sketchup_geometry", "secondary_extract"] as const;

function num(raw: string | null | undefined, fallback = 0): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function attrWeightPlf(attributes: unknown): number | null {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return null;
  }
  const raw = (attributes as Record<string, unknown>).weight_plf;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function collectDraftTree(rootSku: string): Promise<DraftLineInput[]> {
  const db = getDb();
  const parents = new Set<string>([rootSku]);
  const queue = [rootSku];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const kids = await db
      .select({
        child: product_bom_draft.child_sku,
        type: sku_mappings.item_type,
      })
      .from(product_bom_draft)
      .leftJoin(
        sku_mappings,
        eq(product_bom_draft.child_sku, sku_mappings.global_sku),
      )
      .where(eq(product_bom_draft.parent_sku, current));
    for (const kid of kids) {
      if (kid.type === "sub_assembly" && !parents.has(kid.child)) {
        parents.add(kid.child);
        queue.push(kid.child);
      }
    }
  }

  const rows = await db
    .select()
    .from(product_bom_draft)
    .where(inArray(product_bom_draft.parent_sku, [...parents]));

  return rows.map((row) => {
    const { cutList } = parseCutListFromNotes(row.notes);
    return {
      parentSku: row.parent_sku,
      childSku: row.child_sku,
      quantity: num(row.quantity),
      scrapFactor: num(row.scrap_factor, 1),
      unitOfMeasure: row.unit_of_measure,
      notes: row.notes,
      cutList,
    };
  });
}

async function loadFactors(materialSkus: string[]): Promise<PhysicsFactor[]> {
  const db = getDb();
  const skus = [...new Set(materialSkus.map((s) => s.toUpperCase()))];
  if (skus.length === 0) return [];

  const factorRows = await db.select().from(material_physics_factors);
  const mappings = await db
    .select({
      sku: sku_mappings.global_sku,
      attributes: sku_mappings.attributes,
    })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, skus));

  const attrBySku = new Map(
    mappings.map((m) => [m.sku, attrWeightPlf(m.attributes)]),
  );

  return factorRows.map((row) => ({
    materialSku: row.material_sku,
    profileCode: row.profile_code ?? "",
    weightPlf: row.weight_plf != null ? num(row.weight_plf) : null,
    densityPcf: row.density_pcf != null ? num(row.density_pcf) : null,
    ozPerYd2: row.oz_per_yd2 != null ? num(row.oz_per_yd2) : null,
    fabricWidthIn:
      row.fabric_width_in != null ? num(row.fabric_width_in) : null,
    perimeterIn: row.perimeter_in != null ? num(row.perimeter_in) : null,
    coverageSqftPerLb:
      row.coverage_sqft_per_lb != null ? num(row.coverage_sqft_per_lb) : null,
    attrWeightPlf: attrBySku.get(row.material_sku) ?? null,
  }));
}

function hashInputs(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
}

export type SecondaryExtractResult = {
  rootSku: string;
  estWeightLbs: number;
  estDimWeightLbs: number;
  estLaborMinutes: number;
  inputsHash: string;
  opsUpdated: number;
};

/**
 * Recalculate draft estimates + eligible draft operation run times.
 * Preserves manager overrides on recipe_estimates_draft.overrides.
 */
export async function runSecondaryExtract(
  rootSkuRaw: string,
  options?: { forceOps?: boolean },
): Promise<SecondaryExtractResult> {
  const rootSku = rootSkuRaw.trim().toUpperCase();
  if (!rootSku) {
    throw new Error("root_sku is required");
  }

  const db = getDb();
  const lines = await collectDraftTree(rootSku);
  const factors = await loadFactors(lines.map((l) => l.childSku));

  const [fg] = await db
    .select({
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
    })
    .from(finished_goods_catalog)
    .where(eq(finished_goods_catalog.global_sku, rootSku))
    .limit(1);

  const envelope = {
    lengthIn: num(fg?.length, 34),
    depthIn: num(fg?.depth, 34),
    heightIn: num(fg?.height, 31),
  };

  const weight = computeWeight({ lines, factors });
  const packaging = computePackaging({ envelope });
  const drivers = deriveGeometryDrivers({ lines, factors });
  const labor = computeLabor({
    drivers,
    estWeightLbs: weight.estWeightLbs,
  });

  const inputsHash = hashInputs({
    lines: lines.map((l) => ({
      p: l.parentSku,
      c: l.childSku,
      q: l.quantity,
      s: l.scrapFactor,
      u: l.unitOfMeasure,
      cuts: l.cutList,
    })),
    envelope,
    calc: CALC_VERSION,
  });

  const [existing] = await db
    .select({ overrides: recipe_estimates_draft.overrides })
    .from(recipe_estimates_draft)
    .where(eq(recipe_estimates_draft.root_sku, rootSku))
    .limit(1);

  const overrides = existing?.overrides ?? {};
  const now = new Date();

  await db
    .insert(recipe_estimates_draft)
    .values({
      root_sku: rootSku,
      est_weight_lbs: weight.estWeightLbs.toFixed(4),
      weight_breakdown: weight.breakdown,
      est_dim_weight_lbs: String(packaging.dimWeightLbs),
      carton_lwh_in: packaging.cartonIn,
      packaging_bom: {
        cartonIn: packaging.cartonIn,
        lines: packaging.lines,
        dimWeightLbs: packaging.dimWeightLbs,
        dimDivisor: packaging.dimDivisor,
      },
      est_labor_minutes: labor.totalMinutes.toFixed(4),
      labor_breakdown: {
        drivers,
        ops: labor.ops,
      },
      est_packaging_cost:
        packaging.packCost != null ? packaging.packCost.toFixed(4) : null,
      overrides,
      status: "draft_pending_review",
      source: "secondary_extract",
      calc_version: CALC_VERSION,
      inputs_hash: inputsHash,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: recipe_estimates_draft.root_sku,
      set: {
        est_weight_lbs: weight.estWeightLbs.toFixed(4),
        weight_breakdown: weight.breakdown,
        est_dim_weight_lbs: String(packaging.dimWeightLbs),
        carton_lwh_in: packaging.cartonIn,
        packaging_bom: {
          cartonIn: packaging.cartonIn,
          lines: packaging.lines,
          dimWeightLbs: packaging.dimWeightLbs,
          dimDivisor: packaging.dimDivisor,
        },
        est_labor_minutes: labor.totalMinutes.toFixed(4),
        labor_breakdown: {
          drivers,
          ops: labor.ops,
        },
        est_packaging_cost:
          packaging.packCost != null ? packaging.packCost.toFixed(4) : null,
        source: "secondary_extract",
        calc_version: CALC_VERSION,
        inputs_hash: inputsHash,
        updated_at: now,
      },
    });

  // Write algorithmic run times onto FG + FRAME/CUSH draft ops when eligible.
  const targetSkus = [
    rootSku,
    ...new Set(lines.map((l) => l.parentSku)),
  ];
  let opsUpdated = 0;

  for (const op of labor.ops) {
    const itemSku =
      op.workCenter.startsWith("Fabric") ||
      op.workCenter === "Cushion Stuffing"
        ? targetSkus.find((s) => s.includes("-CUSH")) ?? rootSku
        : op.workCenter.startsWith("Metal") ||
            op.workCenter === "Building & Welding"
          ? targetSkus.find((s) => s.includes("-FRAME")) ?? rootSku
          : rootSku;

    const existingOps = await db
      .select()
      .from(item_operations_draft)
      .where(
        and(
          eq(item_operations_draft.item_sku, itemSku),
          eq(item_operations_draft.work_center, op.workCenter),
        ),
      );

    const eligible = existingOps.filter(
      (row) =>
        options?.forceOps ||
        (ELIGIBLE_OP_SOURCES.includes(
          row.source as (typeof ELIGIBLE_OP_SOURCES)[number],
        ) &&
          row.status !== "factory_approved"),
    );

    if (eligible.length > 0) {
      for (const row of eligible) {
        await db
          .update(item_operations_draft)
          .set({
            setup_time_mins: op.setupTimeMins.toFixed(4),
            run_time_mins: op.runTimeMins.toFixed(4),
            source: "secondary_extract",
            notes: `Algorithmic run times · ${JSON.stringify(op.drivers)}`,
            updated_at: now,
          })
          .where(eq(item_operations_draft.id, row.id));
        opsUpdated += 1;
      }
      continue;
    }

    // Insert when no op exists yet for this work center on the target node
    const anyForCenter = existingOps.length > 0;
    if (!anyForCenter) {
      await db.insert(item_operations_draft).values({
        item_sku: itemSku,
        work_center: op.workCenter,
        sequence: op.sequence,
        setup_time_mins: op.setupTimeMins.toFixed(4),
        run_time_mins: op.runTimeMins.toFixed(4),
        status: "draft_pending_review",
        source: "secondary_extract",
        notes: `Algorithmic run times · ${JSON.stringify(op.drivers)}`,
        updated_at: now,
      });
      opsUpdated += 1;
    }
  }

  return {
    rootSku,
    estWeightLbs: weight.estWeightLbs,
    estDimWeightLbs: packaging.dimWeightLbs,
    estLaborMinutes: labor.totalMinutes,
    inputsHash,
    opsUpdated,
  };
}
