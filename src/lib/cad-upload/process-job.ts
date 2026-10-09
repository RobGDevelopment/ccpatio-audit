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
import { cad_uploads, finished_goods_catalog, product_bom_draft, recipe_estimates_draft, sku_mappings } from "@/server/db/schema";
import { parseGlbWeldment } from "@/lib/sketchup-cutlist/parse-glb-weldment";
import { profileToRmSku, formatDrawingPartNumber } from "@/lib/sketchup-cutlist/parse-component-name";
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
        
        const failingNames = snapshot.failures.map(f => `${f.name} (${f.reason})`).join(", ");
        const msg = "GEOM_HYGIENE: " + failingNames;

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
        ...CAP_LIVE_FALLBACKS,
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
        const cap = resolveLiveIngredient(RM_PLASTIC_CAP_2X2, CAP_LIVE_FALLBACKS, live);
        if (cap.live) {
          const wrote = await insertGeometryLine({
            childSku: cap.sku,
            quantity: derived.joinery.capEa,
            unitOfMeasure: "ea",
            notes: "Plastic caps for dead ends",
            cutList: [],
          });
          if (wrote) linesWritten++;
        }
      }

      if (derived?.weight && Number.isFinite(derived.weight.aluminumLbs)) {
        const aluminum = round4(derived.weight.aluminumLbs);
        const aluminumText = aluminum.toFixed(4);
        await db.insert(recipe_estimates_draft).values({
          root_sku: data.globalSku,
          est_weight_lbs: aluminumText,
          weight_breakdown: { aluminum },
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
              COALESCE(${recipe_estimates_draft.weight_breakdown}, '{}'::jsonb),
              '{aluminum}',
              to_jsonb(${aluminumText}::numeric)
            )`,
            updated_at: new Date(),
          },
        });
      }

      await resetReleaseGate(data.globalSku);

      await db
        .update(cad_uploads)
        .set({
          status: "draft_ready",
          error_message: null,
          geometry_snapshot: snapshot,
          updated_at: new Date(),
        })
        .where(eq(cad_uploads.id, uploadId));

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
