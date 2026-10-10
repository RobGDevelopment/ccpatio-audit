import { getDb } from "@/server/db/client";
import { parseFactoryOrderLine } from "./parse-factory-order-packet";
import {
  sku_mappings,
  finished_goods_catalog,
  product_bom,
  channel_sync,
  pim_audit_log,
  product_bom_draft,
  cad_uploads,
} from "@/server/db/schema";
import { deriveFactoryReadiness, type FactoryEvidence } from "./derive-readiness";
import { eq, and, sql, ilike, desc } from "drizzle-orm";

export async function matchFactoryOrderLine(rawLine: string) {
  const parsed = parseFactoryOrderLine(rawLine);
  const db = getDb();

  if (parsed.configuration !== "") {
    return { rawLine, isCustom: true, parsed, snapToGlobalSku: null };
  }

  if (!parsed.family || !parsed.widthInches || !parsed.depthInches) {
    return { rawLine, isCustom: true, parsed, snapToGlobalSku: null };
  }

  // Exact match by family name (original_name) and dimensions (length, depth)
  const matches = await db
    .select({
      globalSku: sku_mappings.global_sku,
      originalName: sku_mappings.original_name,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
    })
    .from(sku_mappings)
    .innerJoin(finished_goods_catalog, eq(sku_mappings.global_sku, finished_goods_catalog.global_sku))
    .where(
      and(
        ilike(sku_mappings.original_name, parsed.family),
        eq(finished_goods_catalog.length, parsed.widthInches),
        eq(finished_goods_catalog.depth, parsed.depthInches)
      )
    );

  if (matches.length !== 1) {
    return { rawLine, isCustom: true, parsed, snapToGlobalSku: null };
  }

  const candidateSku = matches[0].globalSku;

  // Check if published: live product_bom, channel_sync katana='success', factory_bom_katana_recipes exists
  const hasLiveBom = await db.query.product_bom.findFirst({
    where: eq(product_bom.parent_sku, candidateSku),
  });

  const sync = await db.query.channel_sync.findFirst({
    where: and(
      eq(channel_sync.global_sku, candidateSku),
      eq(channel_sync.channel, "katana")
    ),
  });

  const recipeAudit = await db.query.pim_audit_log.findFirst({
    where: and(
      eq(pim_audit_log.global_sku, candidateSku),
      eq(pim_audit_log.action, "factory_bom_katana_recipes")
    ),
  });

  const draftRows = await db.query.product_bom_draft.findMany({
    where: eq(product_bom_draft.parent_sku, candidateSku),
  });

  const latestDae = await db.query.cad_uploads.findFirst({
    where: and(
      eq(cad_uploads.global_sku, candidateSku),
      ilike(cad_uploads.ext, "dae")
    ),
    orderBy: [desc(cad_uploads.created_at)],
  });

  const evidence: FactoryEvidence = {
    liveRecipe: !!hasLiveBom,
    draftStatuses: draftRows.map((r) => r.status),
    latestDae: latestDae
      ? { status: latestDae.status, filename: latestDae.original_filename }
      : null,
    katanaStatus: sync?.status ?? null,
    recipePublished: !!recipeAudit,
  };

  const readiness = deriveFactoryReadiness(evidence);

  if (readiness.state === "published") {
    return { rawLine, isCustom: false, parsed, snapToGlobalSku: candidateSku };
  }

  return { rawLine, isCustom: true, parsed, snapToGlobalSku: null };
}
