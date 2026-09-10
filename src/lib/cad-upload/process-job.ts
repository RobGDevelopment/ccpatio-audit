import { eq } from "drizzle-orm";
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
import { cad_uploads, finished_goods_catalog } from "@/server/db/schema";

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
            "`.skp` accepted for thumbnail only. Upload a Collada `.dae` export for cut-list / draft BOM math.",
          thumbnail_source: thumbSource,
          thumbnail_url: thumbnailUrl,
          updated_at: new Date(),
        })
        .where(eq(cad_uploads.id, uploadId));

      return {
        ok: false,
        error:
          "SKP thumbnail extracted (if present); upload .dae for geometry drafts",
      };
    }

    const result = await instantiateDraftsFromDae({
      xml: buffer,
      sourceLabel: data.storagePath,
      globalSku: data.globalSku,
    });

    if (!result.criticOk) {
      const msg = result.criticFindings
        .filter((f) => f.severity === "error")
        .map((f) => `${f.code}: ${f.message}`)
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
