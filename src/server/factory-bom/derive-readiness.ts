/**
 * Factory readiness for the Master Catalog "Product Bible".
 *
 * Pure: no database access. The caller loads evidence (see
 * getEcommerceRoster) and these functions reduce it in memory.
 *
 * Readiness is computed ONCE per distinct hub SKU and stamped on every listing
 * sharing it. First match wins:
 *   1. Published        liveRecipe && katana success && recipePublished
 *   2. Factory approved liveRecipe (Published conjunction false)
 *   3. Draft pending    no live recipe, and draft lines exist OR latest .dae
 *                       is uploaded | queued | processing | draft_ready
 *   4. Missing CAD      everything else (incl. failed .dae with no drafts)
 */
import { rollupReviewStatus } from "@/app/admin/factory-bom/factory-bom-ui";
import { subAssemblySku } from "@/lib/heuristic-bom";
import type {
  CadUploadStatus,
  ChannelSyncStatus,
  RecipeReviewStatus,
} from "@/server/db/schema";

export type FactoryState =
  | "published"
  | "factory_approved"
  | "draft_pending"
  | "missing_cad";

export interface FactoryEvidence {
  /** Any product_bom row whose parent_sku is in the related-parent set. */
  liveRecipe: boolean;
  /** product_bom_draft.status for every row on the related-parent set. */
  draftStatuses: readonly RecipeReviewStatus[];
  /** Newest cad_uploads row with ext = dae (.skp is never CAD). */
  latestDae: { status: CadUploadStatus; filename: string } | null;
  /** channel_sync status where channel = katana (null = no row). */
  katanaStatus: ChannelSyncStatus | null;
  /** At least one pim_audit_log row with action factory_bom_katana_recipes. */
  recipePublished: boolean;
}

export interface FactoryReadiness {
  state: FactoryState;
  /** Column sublabel — not a separate state. */
  sublabel: string | null;
  /** Evidence echoed for the expanded row. */
  cadFilename: string | null;
  cadStatus: CadUploadStatus | null;
  draftRollup: RecipeReviewStatus | "none";
  liveRecipe: boolean;
  katanaStatus: ChannelSyncStatus | null;
  recipePublished: boolean;
}

const IN_FLIGHT_CAD: readonly CadUploadStatus[] = [
  "uploaded",
  "queued",
  "processing",
  "draft_ready",
];

/** The SKU itself plus current (ASM-) and legacy (SA-) FRAME / CUSH parents. */
export function relatedParents(hubSku: string): string[] {
  const stem = hubSku.trim().toUpperCase().replace(/^(FIN|ASM|SA)-/, "");
  return [
    hubSku,
    subAssemblySku(hubSku, "FRAME"),
    subAssemblySku(hubSku, "CUSH"),
    `SA-${stem}-FRAME`,
    `SA-${stem}-CUSH`,
  ];
}

export function deriveFactoryReadiness(e: FactoryEvidence): FactoryReadiness {
  const draftRollup = rollupReviewStatus(e.draftStatuses);
  const cadInFlight =
    e.latestDae !== null && IN_FLIGHT_CAD.includes(e.latestDae.status);
  const hasDraftLines = e.draftStatuses.length > 0;

  let state: FactoryState;
  let sublabel: string | null = null;

  if (e.liveRecipe && e.katanaStatus === "success" && e.recipePublished) {
    state = "published";
  } else if (e.liveRecipe) {
    state = "factory_approved";
    if (e.katanaStatus === "pending") sublabel = "Katana pending";
    else if (e.katanaStatus === "failed") sublabel = "Katana failed";
    else if (e.katanaStatus === "success") sublabel = "Recipe not published";
  } else if (hasDraftLines || cadInFlight) {
    state = "draft_pending";
    if (draftRollup === "edited") sublabel = "Edited";
    else if (draftRollup === "draft_pending_review") sublabel = "Auto-generated";
    else if (!hasDraftLines && cadInFlight) sublabel = "Extracting";
  } else {
    state = "missing_cad";
    if (e.latestDae?.status === "failed") sublabel = "Extract failed";
  }

  return {
    state,
    sublabel,
    cadFilename: e.latestDae?.filename ?? null,
    cadStatus: e.latestDae?.status ?? null,
    draftRollup,
    liveRecipe: e.liveRecipe,
    katanaStatus: e.katanaStatus,
    recipePublished: e.recipePublished,
  };
}

/** Rows as returned by the five set queries. */
export interface FactoryEvidenceSources {
  cadRows: {
    global_sku: string;
    ext: string;
    status: CadUploadStatus;
    original_filename: string;
    created_at: Date;
  }[];
  draftRows: { parent_sku: string; status: RecipeReviewStatus }[];
  liveParents: Iterable<string>;
  katanaRows: { global_sku: string; status: ChannelSyncStatus }[];
  /** Distinct SKUs with a factory_bom_katana_recipes audit row. */
  auditSkus: Iterable<string>;
}

const isDae = (ext: string) => ext.trim().toLowerCase().replace(/^\./, "") === "dae";

/** Groups the set-query rows into one FactoryEvidence per hub SKU. */
export function buildFactoryEvidence(
  hubSkus: readonly string[],
  src: FactoryEvidenceSources,
): Map<string, FactoryEvidence> {
  const liveSet = new Set(src.liveParents);
  const auditSet = new Set(src.auditSkus);
  const katanaBySku = new Map(src.katanaRows.map((r) => [r.global_sku, r.status]));

  const draftByParent = new Map<string, RecipeReviewStatus[]>();
  for (const d of src.draftRows) {
    const list = draftByParent.get(d.parent_sku) ?? [];
    list.push(d.status);
    draftByParent.set(d.parent_sku, list);
  }

  const latestDaeBySku = new Map<
    string,
    { status: CadUploadStatus; filename: string; at: number }
  >();
  for (const c of src.cadRows) {
    if (!isDae(c.ext)) continue; // .skp is a thumbnail, never CAD
    const at = c.created_at.getTime();
    const cur = latestDaeBySku.get(c.global_sku);
    if (!cur || at > cur.at) {
      latestDaeBySku.set(c.global_sku, {
        status: c.status,
        filename: c.original_filename,
        at,
      });
    }
  }

  const out = new Map<string, FactoryEvidence>();
  for (const sku of new Set(hubSkus)) {
    const parents = relatedParents(sku);
    const dae = latestDaeBySku.get(sku);
    out.set(sku, {
      liveRecipe: parents.some((p) => liveSet.has(p)),
      draftStatuses: parents.flatMap((p) => draftByParent.get(p) ?? []),
      latestDae: dae ? { status: dae.status, filename: dae.filename } : null,
      katanaStatus: katanaBySku.get(sku) ?? null,
      recipePublished: auditSet.has(sku),
    });
  }
  return out;
}
