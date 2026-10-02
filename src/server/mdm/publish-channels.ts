/**
 * Per-channel publish executors for product.approved saga.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 4 / PR-T2.0.
 *
 * Katana Path A: foundation materials/products via mapper plan, then
 * unified manufacturing writer (`publishHubManufacturingToKatana`) for
 * /bom_rows (or /recipes fallback) + /product_operation_rows from live hub tables.
 */
import { NonRetriableError } from "inngest";
import { eq } from "drizzle-orm";
import { upsertCloverItem, CloverApiError } from "@/lib/clover-catalog";
import {
  findVariantBySku,
  katanaFetch,
  KatanaApiError,
  publishHubManufacturingToKatana,
} from "@/lib/katana";
import { upsertWooCommerceProduct, WooCommerceApiError } from "@/lib/woocommerce-catalog";
import {
  KatanaCatalogPublishError,
  stageKatanaCatalogGraph,
} from "@/mappers/katana-catalog-guard";
import { buildKatanaPublishPlan } from "@/mappers/katana";
import { mapFinishedGoodToClover } from "@/mappers/clover";
import { mapFinishedGoodToWooCommerce } from "@/mappers/woocommerce";
import type { HubProductGraph } from "@/mappers/types";
import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import {
  channelSyncIsCurrent,
  getChannelSyncRow,
  hashChannelPayload,
  upsertChannelSync,
} from "@/server/mdm/channel-sync";
import {
  canMutateKatanaCatalog,
  getCatalogPublishMode,
} from "@/server/pipeline/catalog-mode";

function httpStatus(error: unknown): number | null {
  if (error instanceof KatanaApiError) return error.status;
  if (error instanceof WooCommerceApiError) return error.status;
  if (error instanceof CloverApiError) return error.status;
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return null;
}

/** 401/403 → NonRetriableError so Inngest stops and onFailure emails IT. */
export function throwProviderAuthOrRethrow(
  channel: string,
  error: unknown,
): never {
  const status = httpStatus(error);
  if (status === 401 || status === 403) {
    throw new NonRetriableError(
      `${channel} unauthorized (${status}) — rotate token then Retry in Inngest`,
      { cause: error },
    );
  }
  throw error;
}

async function persistKatanaIds(input: {
  sku: string;
  variantId: number;
  materialId?: number | null;
}): Promise<void> {
  const db = getDb();
  await db
    .update(sku_mappings)
    .set({
      katana_variant_id: input.variantId,
      ...(input.materialId != null
        ? { katana_material_id: input.materialId }
        : {}),
      updated_at: new Date(),
    })
    .where(eq(sku_mappings.global_sku, input.sku));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractCreatedIds(data: unknown): {
  id: number | null;
  variantId: number | null;
} {
  const record = asRecord(data);
  const id = record?.id != null ? Number(record.id) : NaN;
  const variants = Array.isArray(record?.variants) ? record.variants : [];
  const first = asRecord(variants[0]);
  const variantId = first?.id != null ? Number(first.id) : NaN;
  return {
    id: Number.isFinite(id) ? id : null,
    variantId: Number.isFinite(variantId) ? variantId : null,
  };
}

/**
 * Katana spoke (PR-T2.0):
 * 1. Foundation mapper plan → POST /materials + /products (Idempotency-Key)
 * 2. Unified hub writer → POST /recipes + /product_operation_rows
 * Both steps respect CATALOG_PUBLISH_MODE (no transactional order POSTs).
 */
export async function publishToKatana(
  graph: HubProductGraph,
): Promise<{ skipped: boolean; externalId: string | null }> {
  let stagedGraph = graph;
  try {
    stagedGraph = stageKatanaCatalogGraph(graph).graph;
  } catch (error) {
    if (error instanceof KatanaCatalogPublishError) {
      throw new NonRetriableError(error.message, { cause: error });
    }
    throw error;
  }

  const globalSku = stagedGraph.rootSku.toUpperCase();
  const foundationPlan = buildKatanaPublishPlan(stagedGraph);
  const payloadHash = hashChannelPayload({
    channel: "katana",
    rootSku: globalSku,
    foundationPlan,
    manufacturingWriter: "publishHubManufacturingToKatana",
    // Invalidate skip when live-graph manufacturing shape changes
    edges: stagedGraph.edges,
    operations: stagedGraph.operations,
  });
  const existing = await getChannelSyncRow(globalSku, "katana");
  if (channelSyncIsCurrent(existing, payloadHash)) {
    return { skipped: true, externalId: existing?.external_id ?? null };
  }

  const allowMutate = canMutateKatanaCatalog(getCatalogPublishMode());
  const variantIds = new Map<string, number>();
  for (const node of stagedGraph.skus) {
    if (node.katanaVariantId != null) {
      variantIds.set(node.globalSku.toUpperCase(), node.katanaVariantId);
    }
  }

  try {
    let rootExternalId: string | null = null;

    for (const request of foundationPlan) {
      const sku = (request.sku ?? "").toUpperCase();
      if (!sku) continue;

      const already = await findVariantBySku(sku);
      if (already) {
        variantIds.set(sku, already.id);
        await persistKatanaIds({
          sku,
          variantId: already.id,
          materialId: already.material_id ?? null,
        });
        if (sku === globalSku) {
          rootExternalId = String(already.id);
        }
        continue;
      }

      if (!allowMutate) {
        // Dry-run: do not POST materials/products; manufacturing writer also dry-runs.
        continue;
      }

      const { data } = await katanaFetch<Record<string, unknown>>(
        request.path,
        {
          method: "POST",
          body: request.body,
          idempotencyKey: request.idempotencyKey,
        },
      );
      const created = extractCreatedIds(data);
      if (created.variantId == null) {
        throw new Error(
          `Katana ${request.kind} ${sku} returned no variant id`,
        );
      }
      variantIds.set(sku, created.variantId);
      await persistKatanaIds({
        sku,
        variantId: created.variantId,
        materialId: request.kind === "material" ? created.id : null,
      });
      if (sku === globalSku) {
        rootExternalId = String(created.variantId);
      }
    }

    // Single manufacturing writer — recipes/ops from live hub (not mapper plan).
    const manufacturing = await publishHubManufacturingToKatana(globalSku, {
      allowEmpty: true,
    });
    if (!manufacturing.ok) {
      throw new Error(manufacturing.error);
    }

    if (!rootExternalId) {
      rootExternalId =
        manufacturing.productVariantId > 0
          ? String(manufacturing.productVariantId)
          : variantIds.get(globalSku) != null
            ? String(variantIds.get(globalSku))
            : null;
    }

    await upsertChannelSync({
      globalSku,
      channel: "katana",
      status: manufacturing.dryRun ? "pending" : "success",
      externalId: rootExternalId,
      lastError: null,
      payloadHash,
    });

    return {
      skipped: manufacturing.dryRun,
      externalId: rootExternalId,
    };
  } catch (error) {
    await upsertChannelSync({
      globalSku,
      channel: "katana",
      status: "failed",
      lastError: error instanceof Error ? error.message : String(error),
      payloadHash,
    });
    throwProviderAuthOrRethrow("Katana", error);
  }
}

export async function publishToWooCommerce(
  graph: HubProductGraph,
): Promise<{ skipped: boolean; externalId: string | null }> {
  const globalSku = graph.rootSku.toUpperCase();
  const mapped = mapFinishedGoodToWooCommerce(graph.commerce);
  const payloadHash = hashChannelPayload({
    channel: "woocommerce",
    rootSku: globalSku,
    mapped,
  });
  const existing = await getChannelSyncRow(globalSku, "woocommerce");
  if (channelSyncIsCurrent(existing, payloadHash)) {
    return { skipped: true, externalId: existing?.external_id ?? null };
  }

  if (mapped.skip) {
    await upsertChannelSync({
      globalSku,
      channel: "woocommerce",
      status: "success",
      externalId: "skipped",
      lastError: null,
      payloadHash,
    });
    return { skipped: true, externalId: "skipped" };
  }

  try {
    const { externalId } = await upsertWooCommerceProduct(mapped.payload);
    await upsertChannelSync({
      globalSku,
      channel: "woocommerce",
      status: "success",
      externalId,
      lastError: null,
      payloadHash,
    });
    return { skipped: false, externalId };
  } catch (error) {
    await upsertChannelSync({
      globalSku,
      channel: "woocommerce",
      status: "failed",
      lastError: error instanceof Error ? error.message : String(error),
      payloadHash,
    });
    throwProviderAuthOrRethrow("WooCommerce", error);
  }
}

export async function publishToClover(
  graph: HubProductGraph,
): Promise<{ skipped: boolean; externalId: string | null }> {
  const globalSku = graph.rootSku.toUpperCase();
  const mapped = mapFinishedGoodToClover(graph.commerce);
  const payloadHash = hashChannelPayload({
    channel: "clover",
    rootSku: globalSku,
    mapped,
  });
  const existing = await getChannelSyncRow(globalSku, "clover");
  if (channelSyncIsCurrent(existing, payloadHash)) {
    return { skipped: true, externalId: existing?.external_id ?? null };
  }

  if (mapped.skip) {
    await upsertChannelSync({
      globalSku,
      channel: "clover",
      status: "success",
      externalId: "skipped",
      lastError: null,
      payloadHash,
    });
    return { skipped: true, externalId: "skipped" };
  }

  try {
    const { externalId } = await upsertCloverItem(mapped.payload);
    await upsertChannelSync({
      globalSku,
      channel: "clover",
      status: "success",
      externalId,
      lastError: null,
      payloadHash,
    });
    return { skipped: false, externalId };
  } catch (error) {
    await upsertChannelSync({
      globalSku,
      channel: "clover",
      status: "failed",
      lastError: error instanceof Error ? error.message : String(error),
      payloadHash,
    });
    throwProviderAuthOrRethrow("Clover", error);
  }
}
