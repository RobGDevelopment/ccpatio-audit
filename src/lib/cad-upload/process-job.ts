import { and, eq, inArray, sql } from "drizzle-orm";
import {
  CAD_UPLOADED_EVENT,
  extractSkpThumbnail,
  instantiateDraftsFromDae,
  type CadUploadedEventData,
} from "@/lib/cad-upload";
import {
  downloadCadObject,
  uploadProductImage,
} from "@/lib/supabase-storage";
import { getDb } from "@/server/db/client";
import { cad_uploads, finished_goods_catalog, item_operations_draft, product_bom, product_bom_draft, recipe_estimates_draft, sku_mappings } from "@/server/db/schema";
import { parseGlbWeldment } from "@/lib/sketchup-cutlist/parse-glb-weldment";
import { profileToRmSku, formatDrawingPartNumber } from "@/lib/sketchup-cutlist/parse-component-name";
import { formatGeomHygieneMessage } from "@/lib/sketchup-cutlist/component-hygiene";
import { calculateCushionPackage } from "@/lib/sketchup-cutlist/derived-heuristics";
import {
  CAP_LIVE_FALLBACKS,
  POWDER_LIVE_FALLBACKS,
  RM_PLASTIC_CAP_2X2,
  RM_POWDER_COAT,
  resolveLiveIngredient,
} from "@/lib/level2-bom";
import { resetReleaseGate } from "@/server/factory-bom/release-gate";

const RM_TIG_WIRE = "RM-MET-TIG-WIRE";
const RM_HW_BOLT = "RM-HW-BOLT";
const RM_CONS_ARGON = "RM-CONS-ARGON";
const RM_CONS_SAND = "RM-CONS-SAND";
const RM_CAP_2X1 = "RM-PLASTIC-CAP-2X1";
const RM_CAP_15X075 = "RM-PLASTIC-CAP-15X075";
const RM_PKG_SKID = "RM-PKG-SKID-LUMBER";
const RM_PKG_STRAP = "RM-PKG-PET-STRAP";
const RM_PKG_SHRINK = "RM-PKG-SHRINK";

function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

type GeometryCut = {
  role: string;
  profile: string;
  lengthIn: number;
  endA: number | null;
  endB: number | null;
  qtyEa: number;
  lengthConvention: string;
  sourceName: string;
  confidence: string;
  drawingPartNumber: string | null;
};

export async function processCadUploadJob(
  data: CadUploadedEventData,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const db = getDb();
  const uploadId = data.uploadId;
  const now = new Date();

  await db
    .update(cad_uploads)
    .set({ status: "processing", updated_at: now, error_message: null })
    .where(eq(cad_uploads.id, uploadId));

  try {
    const buffer = await downloadCadObject(data.storagePath);
    const ext = data.ext;

    if (ext === "skp") {
      const png = extractSkpThumbnail(buffer);
      let thumbnailUrl: string | null = null;
      let thumbSource: "skp_embed" | "none" = "none";

      if (png) {
        const [fg] = await db
          .select({ image: finished_goods_catalog.image_url })
          .from(finished_goods_catalog)
          .where(eq(finished_goods_catalog.global_sku, data.globalSku))
          .limit(1);
        const mayWrite =
          data.replaceImage === true || !fg?.image?.trim();
        if (mayWrite) {
          thumbnailUrl = await uploadProductImage({
            globalSku: data.globalSku,
            buffer: png,
            contentType: "image/png",
            ext: "png",
          });
          thumbSource = "skp_embed";
          await db
            .update(finished_goods_catalog)
            .set({
              image_url: thumbnailUrl,
              updated_at: now,
              updated_by: data.operatorEmail || "cad_upload",
            })
            .where(eq(finished_goods_catalog.global_sku, data.globalSku));
        }
      }

      await db
        .update(cad_uploads)
        .set({
          status: "failed",
          error_message:
            "`.skp` accepted for thumbnail only. Upload a `.glb` or `.dae` export for cut-list / draft BOM math.",
          thumbnail_source: thumbSource,
          thumbnail_url: thumbnailUrl,
          updated_at: new Date(),
        })
        .where(eq(cad_uploads.id, uploadId));

      return {
        ok: false,
        error:
          "SKP thumbnail extracted (if present); upload .glb or .dae for geometry drafts",
      };
    }

    if (ext === "glb") {
      const snapshot = await parseGlbWeldment(buffer);

      if (snapshot.hygiene === "fail") {
        await db.delete(product_bom_draft).where(and(
          eq(product_bom_draft.parent_sku, data.globalSku),
          eq(product_bom_draft.source, "sketchup_geometry")
        ));
        
        const msg = "GEOM_HYGIENE: " + formatGeomHygieneMessage(snapshot.failures);

        await db.update(cad_uploads)
          .set({ status: "failed", error_message: msg, geometry_snapshot: snapshot, updated_at: new Date() })
          .where(eq(cad_uploads.id, uploadId));
        return { ok: false, error: msg };
      }

      // Replace this tree's source = sketchup_geometry drafts. Manager rows stay.
      await db.delete(product_bom_draft).where(and(
        eq(product_bom_draft.parent_sku, data.globalSku),
        eq(product_bom_draft.source, "sketchup_geometry")
      ));

      const cutMap = new Map<string, GeometryCut[]>();
      for (const comp of snapshot.components) {
        if (!comp.profile || comp.lengthIn == null) continue;
        const rmSku = profileToRmSku(comp.profile);
        const endA = comp.endA === "45" ? 45 : 90;
        const endB = comp.endB === "45" ? 45 : 90;
        const piece = {
          role: comp.role,
          profile: comp.profile,
          lengthIn: comp.lengthIn,
          endA,
          endB,
          qtyEa: 1,
          lengthConvention: comp.lengthConvention === "long_point" ? "long_point" : "square",
          sourceName: comp.name,
          confidence: comp.confidence,
          drawingPartNumber: formatDrawingPartNumber({
            profile: comp.profile,
            lengthIn: comp.lengthIn,
            endA,
            endB,
          }) || comp.name,
        };
        const bucket = cutMap.get(rmSku);
        if (bucket) bucket.push(piece);
        else cutMap.set(rmSku, [piece]);
      }

      const derived = snapshot.derived;
      const candidateSkus = [
        ...cutMap.keys(),
        RM_POWDER_COAT,
        ...POWDER_LIVE_FALLBACKS,
        RM_TIG_WIRE,
        RM_HW_BOLT,
        RM_PLASTIC_CAP_2X2,
        RM_CAP_2X1,
        RM_CAP_15X075,
        ...CAP_LIVE_FALLBACKS,
        RM_CONS_ARGON,
        RM_CONS_SAND,
        RM_PKG_SKID,
        RM_PKG_STRAP,
        RM_PKG_SHRINK,
      ];
      const liveRows = candidateSkus.length
        ? await db
            .select({ sku: sku_mappings.global_sku })
            .from(sku_mappings)
            .where(inArray(sku_mappings.global_sku, [...new Set(candidateSkus)]))
        : [];
      const liveByUpper = new Map(liveRows.map((row) => [row.sku.trim().toUpperCase(), row.sku]));
      const live = new Set(liveByUpper.keys());

      async function insertGeometryLine(input: {
        childSku: string;
        quantity: number;
        unitOfMeasure: string;
        notes: string;
        cutList: GeometryCut[];
      }): Promise<boolean> {
        const storedSku = liveByUpper.get(input.childSku.trim().toUpperCase());
        const quantity = round4(input.quantity);
        if (!storedSku || quantity === 0) return false;
        const inserted = await db
          .insert(product_bom_draft)
          .values({
            parent_sku: data.globalSku,
            child_sku: storedSku,
            quantity: quantity.toFixed(4),
            scrap_factor: "1",
            unit_of_measure: input.unitOfMeasure,
            status: "draft_pending_review",
            source: "sketchup_geometry",
            notes: input.notes,
            cut_list: input.cutList,
          })
          .onConflictDoNothing({
            target: [product_bom_draft.parent_sku, product_bom_draft.child_sku],
          })
          .returning({ id: product_bom_draft.id });
        return inserted.length > 0;
      }

      let linesWritten = 0;
      for (const [rmSku, cuts] of cutMap.entries()) {
        const totalIn = cuts.reduce((sum, cut) => sum + Number(cut.lengthIn), 0);
        const wrote = await insertGeometryLine({
          childSku: rmSku,
          quantity: totalIn / 12,
          unitOfMeasure: "ft",
          notes: `${cuts.length} pieces from ${rmSku}`,
          cutList: cuts,
        });
        if (wrote) linesWritten++;
      }

      if (derived?.powder) {
        const powder = resolveLiveIngredient(RM_POWDER_COAT, POWDER_LIVE_FALLBACKS, live);
        if (powder.live) {
          const wrote = await insertGeometryLine({
            childSku: powder.sku,
            quantity: derived.powder.pounds,
            unitOfMeasure: "lb",
            notes: `Powder estimate (${derived.powder.method})`,
            cutList: [],
          });
          if (wrote) linesWritten++;
        }
      }
      if (derived?.joinery) {
        const wire = resolveLiveIngredient(RM_TIG_WIRE, [], live);
        if (wire.live) {
          const wrote = await insertGeometryLine({
            childSku: wire.sku,
            quantity: derived.joinery.weldWireLb,
            unitOfMeasure: "lb",
            notes: `Weld wire from ${derived.joinery.jointCount} joints`,
            cutList: [],
          });
          if (wrote) linesWritten++;
        }
        const bolt = resolveLiveIngredient(RM_HW_BOLT, [], live);
        if (bolt.live) {
          const wrote = await insertGeometryLine({
            childSku: bolt.sku,
            quantity: derived.joinery.fastenerEa,
            unitOfMeasure: "ea",
            notes: "Fasteners for frame corners",
            cutList: [],
          });
          if (wrote) linesWritten++;
        }
        for (const c of derived.joinery.caps || []) {
          const preferred = c.sku || RM_PLASTIC_CAP_2X2;
          const cap = resolveLiveIngredient(
            preferred,
            preferred === RM_PLASTIC_CAP_2X2 ? CAP_LIVE_FALLBACKS : [],
            live,
          );
          if (cap.live) {
            const wrote = await insertGeometryLine({
              childSku: cap.sku,
              quantity: c.ea,
              unitOfMeasure: "ea",
              notes: "Plastic caps for dead ends",
              cutList: [],
            });
            if (wrote) linesWritten++;
          }
        }
      }

      if (derived?.argon) {
        const argon = resolveLiveIngredient(RM_CONS_ARGON, [], live);
        if (argon.live) {
          const wrote = await insertGeometryLine({
            childSku: argon.sku,
            quantity: derived.argon.cubicFeet,
            unitOfMeasure: "cf",
            notes: `Argon gas for ${derived.argon.jointCount} joints`,
            cutList: [],
          });
          if (wrote) linesWritten++;
        }
      }

      if (derived?.sand) {
        const sand = resolveLiveIngredient(RM_CONS_SAND, [], live);
        if (sand.live) {
          const wrote = await insertGeometryLine({
            childSku: sand.sku,
            quantity: derived.sand.pounds,
            unitOfMeasure: "lb",
            notes: `Blast media estimate`,
            cutList: [],
          });
          if (wrote) linesWritten++;
        }
      }

      if (derived?.freight && !derived.freight.reason) {
        const freightLines = [
          { sku: RM_PKG_SKID, quantity: derived.freight.skidBoardFt, unit: "boardft", notes: "Custom skid lumber" },
          { sku: RM_PKG_STRAP, quantity: derived.freight.strapFt, unit: "ft", notes: "PET strapping" },
          { sku: RM_PKG_SHRINK, quantity: derived.freight.shrinkSqft, unit: "sqft", notes: "LTL shrink wrap" },
        ];
        for (const line of freightLines) {
          const ingredient = resolveLiveIngredient(line.sku, [], live);
          if (!ingredient.live) continue;
          const wrote = await insertGeometryLine({
            childSku: ingredient.sku,
            quantity: line.quantity,
            unitOfMeasure: line.unit,
            notes: line.notes,
            cutList: [],
          });
          if (wrote) linesWritten++;
        }
      }

      if (derived?.weight && Number.isFinite(derived.weight.aluminumLbs)) {
        const aluminum = round4(derived.weight.aluminumLbs);
        const aluminumText = aluminum.toFixed(4);
        
        let grossFreightLbs = null;
        let cartonLwhIn = null;
        let estDimWeightLbs = null;
        let packagingBomFreight = null;
        if (derived.freight && derived.freight.reason !== "degenerate_aabb") {
          grossFreightLbs = derived.freight.grossFreightLbs.toFixed(4);
          cartonLwhIn = { l: derived.freight.lIn, w: derived.freight.wIn, h: derived.freight.hIn };
          estDimWeightLbs = derived.freight.dimWeightLbs.toFixed(4);
          packagingBomFreight = {
            lIn: derived.freight.lIn,
            wIn: derived.freight.wIn,
            hIn: derived.freight.hIn,
            skidBoardFt: derived.freight.skidBoardFt,
            strapFt: derived.freight.strapFt,
            shrinkSqft: derived.freight.shrinkSqft,
            reason: derived.freight.reason,
          };
        }

        await db.insert(recipe_estimates_draft).values({
          root_sku: data.globalSku,
          est_weight_lbs: aluminumText,
          weight_breakdown: derived.freight?.skidBoardFt ? { aluminum, skid_lumber: derived.freight.skidBoardFt * 2.5 } : { aluminum },
          gross_freight_weight_lbs: grossFreightLbs,
          carton_lwh_in: cartonLwhIn,
          est_dim_weight_lbs: estDimWeightLbs,
          packaging_bom: packagingBomFreight ? { geometryFreight: packagingBomFreight } : undefined,
          created_at: new Date(),
          updated_at: new Date(),
        }).onConflictDoUpdate({
          target: recipe_estimates_draft.root_sku,
          set: {
            est_weight_lbs: sql`CASE
              WHEN jsonb_typeof(${recipe_estimates_draft.overrides} -> 'weightLbs') = 'number'
              THEN ${recipe_estimates_draft.est_weight_lbs}
              ELSE ${aluminumText}::numeric
            END`,
            weight_breakdown: sql`jsonb_set(
              jsonb_set(
                COALESCE(${recipe_estimates_draft.weight_breakdown}, '{}'::jsonb),
                '{aluminum}',
                to_jsonb(${aluminumText}::numeric)
              ),
              '{skid_lumber}',
              to_jsonb(${derived.freight?.skidBoardFt ? derived.freight.skidBoardFt * 2.5 : 0}::numeric)
            )`,
            gross_freight_weight_lbs: grossFreightLbs ? sql`${grossFreightLbs}::numeric` : recipe_estimates_draft.gross_freight_weight_lbs,
            carton_lwh_in: cartonLwhIn ? sql`${JSON.stringify(cartonLwhIn)}::jsonb` : recipe_estimates_draft.carton_lwh_in,
            est_dim_weight_lbs: estDimWeightLbs ? sql`CASE
              WHEN jsonb_typeof(${recipe_estimates_draft.overrides} -> 'dimWeightLbs') = 'number'
              THEN ${recipe_estimates_draft.est_dim_weight_lbs}
              ELSE ${estDimWeightLbs}::numeric
            END` : recipe_estimates_draft.est_dim_weight_lbs,
            packaging_bom: packagingBomFreight ? sql`jsonb_set(
              COALESCE(${recipe_estimates_draft.packaging_bom}, '{}'::jsonb),
              '{geometryFreight}',
              ${JSON.stringify(packagingBomFreight)}::jsonb
            )` : recipe_estimates_draft.packaging_bom,
            updated_at: new Date(),
          },
        });
      }

      await db
        .update(cad_uploads)
        .set({
          status: "draft_ready",
          error_message: null,
          geometry_snapshot: snapshot,
          updated_at: new Date(),
        })
        .where(eq(cad_uploads.id, uploadId));

      const [est] = await db.select({ cushion_fulfillment_mode: recipe_estimates_draft.cushion_fulfillment_mode })
        .from(recipe_estimates_draft)
        .where(eq(recipe_estimates_draft.root_sku, data.globalSku))
        .limit(1);
      
      const mode = est?.cushion_fulfillment_mode || "standard";
      await applyCushionFulfillmentMode(data.globalSku, mode as "standard" | "vacuum_compressed");

      await resetReleaseGate(data.globalSku);

      return {
        ok: true,
        message: `Wrote ${linesWritten} draft lines for ${data.globalSku} using GLB pure parser`,
      };
    }

    const result = await instantiateDraftsFromDae({
      xml: buffer,
      sourceLabel: data.storagePath,
      globalSku: data.globalSku,
    });

    if (!result.criticOk) {
      const msg = result.criticFindings
        .filter((f: any) => f.severity === "error")
        .map((f: any) => `${f.code}: ${f.message}`)
        .join("; ");
      await db
        .update(cad_uploads)
        .set({
          status: "failed",
          error_message: msg || "Critic refused draft write",
          updated_at: new Date(),
        })
        .where(eq(cad_uploads.id, uploadId));
      return { ok: false, error: msg || "Critic refused draft write" };
    }

    await resetReleaseGate(data.globalSku);

    await db
      .update(cad_uploads)
      .set({
        status: "draft_ready",
        error_message: null,
        updated_at: new Date(),
      })
      .where(eq(cad_uploads.id, uploadId));

    return {
      ok: true,
      message: `Wrote ${result.linesWritten} draft lines for ${result.finSku}`,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "CAD processing failed";
    await db
      .update(cad_uploads)
      .set({
        status: "failed",
        error_message: message,
        updated_at: new Date(),
      })
      .where(eq(cad_uploads.id, uploadId));
    return { ok: false, error: message };
  }
}

export { CAD_UPLOADED_EVENT };

export async function applyCushionFulfillmentMode(
  rootSku: string,
  mode: "standard" | "vacuum_compressed"
) {
  const db = getDb();
  
  await db.update(recipe_estimates_draft)
    .set({ cushion_fulfillment_mode: mode })
    .where(eq(recipe_estimates_draft.root_sku, rootSku));

  const uploads = await db.select({ snapshot: cad_uploads.geometry_snapshot })
    .from(cad_uploads)
    .where(and(eq(cad_uploads.global_sku, rootSku), eq(cad_uploads.status, "draft_ready")))
    .orderBy(sql`created_at DESC`)
    .limit(1);
    
  let cushionAabb = null;
  if (uploads.length > 0 && uploads[0].snapshot && (uploads[0].snapshot as any).cushionAabb) {
    cushionAabb = (uploads[0].snapshot as any).cushionAabb;
  }
  
  const [draftBoms, liveBoms] = await Promise.all([
    db.select({ child_sku: product_bom_draft.child_sku })
      .from(product_bom_draft)
      .where(eq(product_bom_draft.parent_sku, rootSku)),
    db.select({ child_sku: product_bom.child_sku })
      .from(product_bom)
      .where(eq(product_bom.parent_sku, rootSku)),
  ]);

  const cushionParents: string[] = [];
  if (rootSku.endsWith("-CUSH")) {
    cushionParents.push(rootSku);
  } else {
    for (const b of [...draftBoms, ...liveBoms]) {
      if (b.child_sku.endsWith("-CUSH") && !cushionParents.includes(b.child_sku)) {
        cushionParents.push(b.child_sku);
      }
    }
  }

  if (cushionParents.length === 0 && !cushionAabb) {
    return; // no_cushion_geometry
  }

  const pkg = calculateCushionPackage(mode, cushionAabb);

  const packageSkus = [...new Set(pkg.lines.map((line) => line.sku))];
  const livePackageRows = packageSkus.length
    ? await db
        .select({ sku: sku_mappings.global_sku })
        .from(sku_mappings)
        .where(inArray(sku_mappings.global_sku, packageSkus))
    : [];
  const livePackages = new Set(livePackageRows.map((row) => row.sku.trim().toUpperCase()));

  for (const parentSku of cushionParents) {
    await db.delete(product_bom_draft)
      .where(and(
        eq(product_bom_draft.parent_sku, parentSku),
        inArray(product_bom_draft.child_sku, ["RM-PKG-CORRUGATE-OS", "RM-PKG-DUNNAGE-15"]),
        eq(product_bom_draft.source, "sketchup_geometry")
      ));
    await db.delete(product_bom_draft)
      .where(and(
        eq(product_bom_draft.parent_sku, parentSku),
        eq(product_bom_draft.child_sku, "RM-PKG-SHRINK"),
        eq(product_bom_draft.notes, "cushion"),
        eq(product_bom_draft.source, "sketchup_geometry")
      ));

    for (const line of pkg.lines) {
      if (!livePackages.has(line.sku.trim().toUpperCase())) continue;
      await db.insert(product_bom_draft)
        .values({
          parent_sku: parentSku,
          child_sku: line.sku,
          quantity: line.qty.toFixed(4),
          scrap_factor: "1",
          unit_of_measure: line.uom,
          status: "draft_pending_review",
          source: "sketchup_geometry",
          notes: line.notes,
          cut_list: [],
        })
        .onConflictDoNothing({ target: [product_bom_draft.parent_sku, product_bom_draft.child_sku] });
    }
    
    // Manage sequence 30
    const routes = await db.select().from(item_operations_draft)
      .where(and(
        eq(item_operations_draft.item_sku, parentSku),
        eq(item_operations_draft.sequence, 30)
      ));
      
    if (routes.length === 0) {
      if (pkg.labor.run > 0) {
        await db.insert(item_operations_draft).values({
          item_sku: parentSku,
          sequence: 30,
          work_center: "Cushion Stuffing",
          setup_time_mins: pkg.labor.setup.toString(),
          run_time_mins: pkg.labor.run.toString(),
          notes: pkg.labor.notes,
          source: "sketchup_geometry",
          status: "draft_pending_review",
        });
      }
    } else {
      const r = routes[0];
      if (r.source === "manager" || r.status === "edited") continue;
      
      if (r.notes?.startsWith("CUSHION_MODE:") || r.source === "sketchup_geometry") {
        await db.update(item_operations_draft)
          .set({
            setup_time_mins: pkg.labor.setup.toString(),
            run_time_mins: pkg.labor.run.toString(),
            notes: pkg.labor.notes,
          })
          .where(and(
            eq(item_operations_draft.item_sku, parentSku),
            eq(item_operations_draft.sequence, 30)
          ));
      }
    }
  }
}
