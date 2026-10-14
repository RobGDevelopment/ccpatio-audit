/**
 * Session-free core of "approve draft recipe": copies the draft BOM / operations into the live
 * hub tables after the airlock passes. HUB ONLY: zero Katana imports, zero Katana network calls.
 *
 * Extracted from the "use server" actions module (Phase 11 remediation, QCA M6): a session-free
 * function taking an `actor` must never be a publicly invocable Server Action. The operator
 * session is resolved by the caller (the Server Action, or the Path A finalize core).
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  cad_uploads,
  finished_goods_catalog,
  item_operations,
  item_operations_draft,
  product_bom,
  product_bom_draft,
  recipe_estimates_draft,
  sku_mappings,
} from "@/server/db/schema";
import { subAssemblySku } from "@/lib/heuristic-bom";
import { formatKatanaIngredientNote, resolveDraftCutsAndNote } from "@/lib/sketchup-cutlist";
import { logPimAudit } from "@/lib/pim-audit";
import { evaluateAirlock } from "@/server/factory-bom/evaluate-airlock";
import { type AirlockDossier } from "@/server/factory-bom/airlock.schema";

export type ApproveDraftRecipeResult =
  | { ok: true; dryRun?: boolean }
  | { ok: false; error: string; blockingCodes?: string[] };
async function collectDraftParents(rootSku: string): Promise<string[]> {
  const db = getDb();
  const found = new Set<string>([rootSku]);
  const queue = [rootSku];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const kids = await db
      .select({ child: product_bom_draft.child_sku, type: sku_mappings.item_type })
      .from(product_bom_draft)
      .leftJoin(sku_mappings, eq(product_bom_draft.child_sku, sku_mappings.global_sku))
      .where(eq(product_bom_draft.parent_sku, current));
    for (const kid of kids) {
      if (kid.type === "sub_assembly" && !found.has(kid.child)) {
        found.add(kid.child);
        queue.push(kid.child);
      }
    }
  }
  return [...found];
}

export async function approveDraftRecipeCore(
  rootSku: string,
  actor: { email: string },
  options?: {
    includePackagingBom?: boolean;
    applyEstimatedWeight?: boolean;
  },
): Promise<ApproveDraftRecipeResult> {
  const email = actor.email;
  const sku = rootSku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required" };

  const db = getDb();
  const parents = await collectDraftParents(sku);
  const lines = await db
    .select()
    .from(product_bom_draft)
    .where(inArray(product_bom_draft.parent_sku, parents));

  if (lines.length === 0) {
    return { ok: false, error: "No draft recipe lines to approve" };
  }

  const [estimate] = await db
    .select()
    .from(recipe_estimates_draft)
    .where(eq(recipe_estimates_draft.root_sku, sku))
    .limit(1);

  const includePackaging =
    options?.includePackagingBom === true ||
    estimate?.overrides?.includePackagingBom === true;
  const applyWeight =
    options?.applyEstimatedWeight === true ||
    estimate?.overrides?.applyEstimatedWeight === true;

  const ops = await db
    .select()
    .from(item_operations_draft)
    .where(inArray(item_operations_draft.item_sku, parents));

  const allSkus = new Set<string>();
  for (const p of parents) allSkus.add(p);
  for (const l of lines) allSkus.add(l.child_sku);
  
  const skuMap = new Map<string, any>();
  if (allSkus.size > 0) {
     const mapped = await db.select({
       sku: sku_mappings.global_sku,
       itemType: sku_mappings.item_type,
       originalName: sku_mappings.original_name,
       katanaVariantId: sku_mappings.katana_variant_id,
       category: sku_mappings.category,
     }).from(sku_mappings).where(inArray(sku_mappings.global_sku, Array.from(allSkus)));
     for (const m of mapped) skuMap.set(m.sku, m);
  }
  
  const rootMeta = skuMap.get(sku);
  if (!rootMeta) return { ok: false, error: "Root SKU metadata not found" };

  const [latestCad] = await db
    .select()
    .from(cad_uploads)
    .where(eq(cad_uploads.global_sku, sku))
    .orderBy(desc(cad_uploads.created_at))
    .limit(1);

  let cadNode = null;
  if (latestCad && (latestCad.ext === "dae" || latestCad.ext === "glb")) {
    const snap = latestCad.geometry_snapshot as any;
    cadNode = {
      uploadId: latestCad.id,
      ext: latestCad.ext as "dae" | "glb",
      status: (latestCad.status === "failed" ? "failed" : "draft_ready") as "draft_ready" | "failed",
      sha256: latestCad.sha256 || "",
      hygiene: (snap?.hygiene === "pass" ? "pass" : "fail") as "pass" | "fail",
    };
  }

  const checklist = {
    identityConfirmed: true as const,
    cutListConfirmed: true as const,
    operationsConfirmed: true as const,
    quarantineConfirmed: true as const,
  };

  const nodes = parents.map(parentSku => {
    const pMeta = skuMap.get(parentSku);
    const parentLines = lines.filter(l => l.parent_sku === parentSku).map(l => {
       const cMeta = skuMap.get(l.child_sku);
       const isMetal = Boolean(
         cMeta?.category?.match(/metal|aluminum|tube|flat bar/i) ||
         (Array.isArray(l.cut_list) && l.cut_list.length > 0 && (l.cut_list[0] as any).profile !== "UNKNOWN") ||
         ((l.unit_of_measure === "in" || l.unit_of_measure === "ft") && Array.isArray(l.cut_list) && l.cut_list.length > 0)
       );
       
       return {
         parentSku: l.parent_sku,
         childSku: l.child_sku,
         itemType: cMeta?.itemType as any,
         quantity: Number(l.quantity),
         scrapFactor: Number(l.scrap_factor),
         unitOfMeasure: l.unit_of_measure as any,
         status: l.status,
         source: l.source,
         notes: l.notes,
         cutList: (Array.isArray(l.cut_list) ? (l.cut_list as any).map((c: any) => ({

           role: c.role || "",
           profile: c.profile || "UNKNOWN",
           lengthIn: Number(c.lengthIn) || 0,
           endA: c.endA,
           endB: c.endB,
           qtyEa: c.qtyEa,
           lengthConvention: c.lengthConvention,
           sourceName: c.sourceName || "",
           confidence: c.confidence,
           drawingPartNumber: c.drawingPartNumber
         })) : []) as any,
         isMetal
       };
    });
    const parentOps = ops.filter(o => o.item_sku === parentSku).map(o => ({
       itemSku: o.item_sku,
       workCenter: o.work_center,
       sequence: o.sequence,
       setupTimeMins: o.setup_time_mins ? Number(o.setup_time_mins) : 0,
       runTimeMins: o.run_time_mins ? Number(o.run_time_mins) : 0,
    }));
    return {
      sku: parentSku,
      itemType: pMeta?.itemType as any,
      lines: parentLines,
      operations: parentOps,
    };
  });

  const dossier: AirlockDossier = {
    rootSku: sku,
    identity: {
      itemType: rootMeta.itemType as any,
      originalName: rootMeta.originalName || "",
      katanaVariantId: rootMeta.katanaVariantId,
      cad: cadNode,
      cadWaived: false,
    },
    nodes,
    checklist,
  };

  const blockingCodes = evaluateAirlock(dossier);
  if (blockingCodes.length > 0) {
    return { ok: false, error: "Validation failed: " + blockingCodes.join(", "), blockingCodes };
  }

  const now = new Date();
  for (const line of lines) {
    const { managerNote, cutList } = resolveDraftCutsAndNote({
      notes: line.notes,
      cutList: line.cut_list,
    });
    // Tablet-ready: manager text, else formatKatanaIngredientNote from structure.
    const notesText =
      managerNote.trim() ||
      (cutList.length > 0 ? formatKatanaIngredientNote(cutList) : null) ||
      null;

    await db
      .insert(product_bom)
      .values({
        parent_sku: line.parent_sku,
        child_sku: line.child_sku,
        quantity: line.quantity,
        scrap_factor: line.scrap_factor,
        unit_of_measure: line.unit_of_measure,
        notes: notesText,
        cut_list: cutList as typeof product_bom.$inferInsert.cut_list,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [product_bom.parent_sku, product_bom.child_sku],
        set: {
          quantity: sql`excluded.quantity`,
          scrap_factor: sql`excluded.scrap_factor`,
          unit_of_measure: sql`excluded.unit_of_measure`,
          notes: sql`excluded.notes`,
          cut_list: sql`excluded.cut_list`,
          updated_at: sql`now()`,
        },
      });
  }
  for (const op of ops) {
    await db
      .insert(item_operations)
      .values({
        item_sku: op.item_sku,
        work_center: op.work_center,
        sequence: op.sequence,
        setup_time_mins: op.setup_time_mins,
        run_time_mins: op.run_time_mins,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [
          item_operations.item_sku,
          item_operations.work_center,
          item_operations.sequence,
        ],
        set: {
          setup_time_mins: sql`excluded.setup_time_mins`,
          run_time_mins: sql`excluded.run_time_mins`,
          updated_at: sql`now()`,
        },
      });
  }

  if (applyWeight && estimate) {
    const weight =
      estimate.overrides?.weightLbs ??
      (estimate.est_weight_lbs != null ? Number(estimate.est_weight_lbs) : null);
    if (weight != null && Number.isFinite(weight)) {
      await db
        .update(finished_goods_catalog)
        .set({
          weight: String(Math.round(weight * 10) / 10),
          updated_at: now,
        })
        .where(eq(finished_goods_catalog.global_sku, sku));
    }
  }

  if (includePackaging && estimate?.packaging_bom) {
    const pack = estimate.packaging_bom as {
      lines?: Array<{ sku: string; qty: number; uom: string }>;
    };
    const packSku = subAssemblySku(sku, "PACK");
    const [hub] = await db
      .select({ sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, packSku))
      .limit(1);
    if (!hub) {
      await db.insert(sku_mappings).values({
        global_sku: packSku,
        category: "Packaging",
        item_type: "sub_assembly",
        original_name: `Packaging kit for ${sku}`,
        source_file: "secondary_extraction_pack",
        is_active: true,
        uom_consume: "ea",
        uom_purchase: "ea",
      });
    }
    await db
      .insert(product_bom)
      .values({
        parent_sku: sku,
        child_sku: packSku,
        quantity: "1.0000",
        scrap_factor: "1.0000",
        unit_of_measure: "ea",
        notes: "Packaging SA from secondary extraction (Approve flag)",
        cut_list: [],
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [product_bom.parent_sku, product_bom.child_sku],
        set: {
          quantity: sql`excluded.quantity`,
          notes: sql`excluded.notes`,
          updated_at: sql`now()`,
        },
      });

    for (const line of pack.lines ?? []) {
      const child = line.sku.trim().toUpperCase();
      if (!child) continue;
      const [childHub] = await db
        .select({ sku: sku_mappings.global_sku })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, child))
        .limit(1);
      if (!childHub) continue;
      await db
        .insert(product_bom)
        .values({
          parent_sku: packSku,
          child_sku: child,
          quantity: Number(line.qty).toFixed(4),
          scrap_factor: "1.0000",
          unit_of_measure: line.uom || "ea",
          notes: "Packaging estimate line",
          cut_list: [],
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: [product_bom.parent_sku, product_bom.child_sku],
          set: {
            quantity: sql`excluded.quantity`,
            unit_of_measure: sql`excluded.unit_of_measure`,
            updated_at: sql`now()`,
          },
        });
    }
  }

  await db
    .update(product_bom_draft)
    .set({
      status: "factory_approved",
      reviewed_by: email,
      reviewed_at: now,
      updated_at: now,
    })
    .where(inArray(product_bom_draft.parent_sku, parents));

  await db
    .update(item_operations_draft)
    .set({
      status: "factory_approved",
      reviewed_by: email,
      reviewed_at: now,
      updated_at: now,
    })
    .where(inArray(item_operations_draft.item_sku, parents));

  if (estimate) {
    await db
      .update(recipe_estimates_draft)
      .set({
        status: "factory_approved",
        reviewed_by: email,
        reviewed_at: now,
        updated_at: now,
      })
      .where(eq(recipe_estimates_draft.root_sku, sku));
  }

  await logPimAudit({
    operatorEmail: email,
    globalSku: sku,
    action: "factory_bom_approve",
    newValue: `${lines.length} lines copied to live product_bom${
      includePackaging ? " + packaging" : ""
    }`,
  });
  return { ok: true };
}
