/**
 * Hub-only design finalization core (Task 5).
 * Evaluates airlock dossier, writes shop-drawing asset, stamps shop notes,
 * verifies release gate hash, approves draft recipe into live hub BOM,
 * and updates release-gate dossier hash.
 *
 * CRITICAL ARCHITECTURAL RULE:
 * This module has ZERO Katana imports, makes ZERO Katana network calls,
 * and performs NO session lookups (injectable actor).
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  factory_release_gate,
  product_assets,
  product_bom_draft,
  sku_mappings,
} from "@/server/db/schema";
import { evaluateAirlock } from "@/server/factory-bom/evaluate-airlock";
import { renderShopDrawingPdf } from "@/server/factory-bom/shop-drawing";
import { computeDossierHash } from "@/server/factory-bom/dossier-hash";
import { resetReleaseGate } from "@/server/factory-bom/release-gate";
import { approveDraftRecipeCore } from "@/server/factory-bom/approve-draft-recipe";
import { loadAirlockSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import { isKatanaE2eMirror } from "@/server/pipeline/catalog-mode";
import {
  buildStorageKey,
  sha256Hex,
} from "@/server/pim/asset-vault";
import {
  getSupabaseAdmin,
  PRODUCT_DOCUMENTS_BUCKET,
} from "@/lib/supabase-storage";
import type { AirlockDossier } from "@/server/factory-bom/airlock.schema";

export type FinalizeDesignCoreResult =
  | {
      ok: true;
      dossierHash: string;
      dossier: AirlockDossier;
      skuMap: Map<string, any>;
    }
  | {
      ok: false;
      error: string;
      blockingCodes?: string[];
    };

/**
 * Hub-only half of the recipe finalization pipeline.
 * Session-free, zero Katana I/O.
 */
export async function finalizeDesignCore(
  rootSku: string,
  actor: { email: string },
): Promise<FinalizeDesignCoreResult> {
  const sku = rootSku.trim().toUpperCase();
  if (!sku) {
    return { ok: false, error: "SKU is required" };
  }

  const snapshot = await loadAirlockSnapshot(sku);
  const db = getDb();
  const allSkus = new Set<string>();
  allSkus.add(sku);
  snapshot.lines.forEach((l) => {
    allSkus.add(l.parent_sku);
    allSkus.add(l.child_sku);
  });

  const skuMap = new Map<string, any>();
  if (allSkus.size > 0) {
    const mapped = await db
      .select({
        sku: sku_mappings.global_sku,
        itemType: sku_mappings.item_type,
        originalName: sku_mappings.original_name,
        katanaVariantId: sku_mappings.katana_variant_id,
        category: sku_mappings.category,
      })
      .from(sku_mappings)
      .where(inArray(sku_mappings.global_sku, Array.from(allSkus)));
    for (const m of mapped) skuMap.set(m.sku, m);
  }

  const rootMeta = skuMap.get(sku);
  if (!rootMeta) {
    return { ok: false, error: "Root meta not found" };
  }

  let cadNode = null;
  if (
    snapshot.cadUpload &&
    (snapshot.cadUpload.ext === "dae" || snapshot.cadUpload.ext === "glb")
  ) {
    const snap = snapshot.cadUpload.geometry_snapshot as any;
    cadNode = {
      uploadId: snapshot.cadUpload.id,
      ext: snapshot.cadUpload.ext as "dae" | "glb",
      status: (snapshot.cadUpload.status === "failed"
        ? "failed"
        : "draft_ready") as "draft_ready" | "failed",
      sha256: snapshot.cadUpload.sha256 || "",
      hygiene: (snap?.hygiene === "pass" ? "pass" : "fail") as "pass" | "fail",
    };
  }

  const parents = Array.from(allSkus).filter(
    (s) => s === sku || snapshot.lines.some((l) => l.parent_sku === s),
  );

  const nodes = parents.map((parentSku) => {
    const pMeta = skuMap.get(parentSku);
    const parentLines = snapshot.lines
      .filter((l) => l.parent_sku === parentSku)
      .map((l) => {
        const cMeta = skuMap.get(l.child_sku);
        const cat = cMeta?.category || "";
        const isMetal = Boolean(
          cat.match(/metal|aluminum|tube|flat bar/i) ||
            (Array.isArray(l.cut_list) &&
              l.cut_list.length > 0 &&
              (l.cut_list[0] as any).profile !== "UNKNOWN") ||
            ((l.unit_of_measure === "in" || l.unit_of_measure === "ft") &&
              Array.isArray(l.cut_list) &&
              l.cut_list.length > 0),
        );
        return {
          parentSku: l.parent_sku,
          childSku: l.child_sku,
          itemType: (cMeta as any)?.itemType || "raw_material",
          quantity: Number(l.quantity),
          scrapFactor: Number(l.scrap_factor),
          unitOfMeasure: l.unit_of_measure as any,
          status: l.status as any,
          source: l.source,
          notes: l.notes,
          cutList: (Array.isArray(l.cut_list)
            ? (l.cut_list as any).map((c: any) => c)
            : []) as any,
          isMetal,
        };
      });

    const parentOps = snapshot.operations
      .filter((o) => o.item_sku === parentSku)
      .map((o) => ({
        itemSku: o.item_sku,
        workCenter: o.work_center,
        sequence: o.sequence,
        setupTimeMins: o.setup_time_mins ? Number(o.setup_time_mins) : 0,
        runTimeMins: o.run_time_mins ? Number(o.run_time_mins) : 0,
      }));

    return {
      sku: parentSku,
      itemType: (pMeta as any)?.itemType || "sub_assembly",
      lines: parentLines,
      operations: parentOps,
    };
  });

  const dossier: AirlockDossier = {
    rootSku: sku,
    identity: {
      itemType: rootMeta.itemType || "finished_good",
      originalName: rootMeta.originalName || "",
      katanaVariantId: rootMeta.katanaVariantId || null,
      cad: cadNode,
      cadWaived: false,
    },
    nodes,
    checklist: {
      identityConfirmed: true as true,
      cutListConfirmed: true as true,
      operationsConfirmed: true as true,
      quarantineConfirmed: true as true,
    },
  };

  const blockingCodes = evaluateAirlock(dossier);
  if (blockingCodes.length > 0) {
    return { ok: false, error: "Airlock validation failed", blockingCodes };
  }

  const allCuts = dossier.nodes.flatMap((n) => n.lines.flatMap((l) => l.cutList));
  const pdfBytes = renderShopDrawingPdf({
    rootSku: sku,
    originalName: dossier.identity.originalName,
    cadExt: cadNode?.ext || "glb",
    cadSha256: cadNode?.sha256 || "",
    cutList: allCuts as any,
    geometrySnapshot: (snapshot.cadUpload?.geometry_snapshot as any) || {
      components: [],
    },
  });

  const shopDrawingSha256 = sha256Hex(pdfBytes);
  const [currentDrawing] = await db
    .select()
    .from(product_assets)
    .where(
      and(
        eq(product_assets.global_sku, sku),
        eq(product_assets.kind, "shop_drawing"),
        eq(product_assets.is_current, true),
      ),
    )
    .limit(1);

  let storagePath = currentDrawing?.storage_path ?? "";
  if (!(currentDrawing?.sha256 === shopDrawingSha256 && storagePath)) {
    const revision = (currentDrawing?.revision ?? 0) + 1;
    storagePath = buildStorageKey(sku, "shop_drawing", revision, "pdf");
    try {
      const { error: uploadErr } = await getSupabaseAdmin()
        .storage.from(PRODUCT_DOCUMENTS_BUCKET)
        .upload(storagePath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadErr) {
        if (isKatanaE2eMirror()) {
          console.warn(
            "E2E mirror mode: storage upload error ignored for mock env:",
            uploadErr,
          );
        } else {
          return {
            ok: false,
            error: "SHOP_DRAWING_REQUIRED",
            blockingCodes: ["SHOP_DRAWING_REQUIRED"],
          };
        }
      }
    } catch (storageException: unknown) {
      if (isKatanaE2eMirror()) {
        console.warn(
          "E2E mirror mode: storage upload exception ignored for mock env:",
          storageException,
        );
      } else {
        return {
          ok: false,
          error: "SHOP_DRAWING_REQUIRED",
          blockingCodes: ["SHOP_DRAWING_REQUIRED"],
        };
      }
    }

    await db.transaction(async (tx) => {
      if (currentDrawing) {
        await tx
          .update(product_assets)
          .set({
            is_current: false,
            superseded_at: new Date(),
            updated_at: new Date(),
          })
          .where(eq(product_assets.id, currentDrawing.id));
      }
      await tx.insert(product_assets).values({
        global_sku: sku,
        kind: "shop_drawing",
        revision,
        storage_path: storagePath,
        original_filename: `shop_drawing_${sku}.pdf`,
        content_type: "application/pdf",
        byte_size: pdfBytes.length,
        sha256: shopDrawingSha256,
        is_current: true,
      });
    });
  }

  const [firstLine] = snapshot.lines
    .filter((line) => line.parent_sku === sku)
    .slice()
    .sort((a, b) => a.child_sku.localeCompare(b.child_sku));
  if (firstLine) {
    const shopSuffix = `Shop:${storagePath}`;
    const baseNote = (firstLine.notes || "").trim();
    const newNote = baseNote.endsWith(shopSuffix)
      ? baseNote
      : baseNote
        ? `${baseNote} | ${shopSuffix}`
        : shopSuffix;
    if (newNote.length > 255) {
      return { ok: false, error: "SHOP_NOTE", blockingCodes: ["SHOP_NOTE"] };
    }
    await db
      .update(product_bom_draft)
      .set({ notes: newNote })
      .where(eq(product_bom_draft.id, firstLine.id));

    const rootNode = dossier.nodes.find((n) => n.sku === sku);
    if (rootNode) {
      const rootDossierLine = rootNode.lines.find(
        (l) => l.childSku === firstLine.child_sku,
      );
      if (rootDossierLine) rootDossierLine.notes = newNote;
    }
  }

  const dossierHash = computeDossierHash(dossier, shopDrawingSha256);
  if (
    snapshot.releaseGate?.dossier_hash &&
    snapshot.releaseGate.dossier_hash !== dossierHash
  ) {
    await resetReleaseGate(sku, ["CHECKLIST"]);
    return { ok: false, error: "CHECKLIST", blockingCodes: ["CHECKLIST"] };
  }

  const approveRes = await approveDraftRecipeCore(sku, actor);
  if (!approveRes.ok) return approveRes;

  await db
    .update(factory_release_gate)
    .set({ dossier_hash: dossierHash })
    .where(eq(factory_release_gate.root_sku, sku));

  return {
    ok: true,
    dossierHash,
    dossier,
    skuMap,
  };
}

/**
 * Invalidates design finalization for custom SKUs when the release gate is reset.
 * Reverts item to needs_review and saga to designing (from AWAITING_DEPOSIT).
 */
export async function invalidateFinalization(sku: string): Promise<void> {
  const { classifyCustomSku } = await import("@/server/path-a/katana-fence");
  const customInfo = await classifyCustomSku(sku);
  if (customInfo.type === "custom_job_bound") {
    const { createItemStore } = await import("@/server/path-a/item-store");
    const { createReleaseStore } = await import("@/server/path-a/release-store");
    const itemStore = createItemStore();
    const releaseStore = createReleaseStore();

    await itemStore.setItemStatus({
      globalSku: sku,
      from: ["finalized"],
      to: "needs_review",
    });

    await releaseStore.revertToDesigning(
      customInfo.opportunityId,
      "design_invalidated",
    );
  }
}
