/**
 * Per-channel publish executors for product.approved saga.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 4.
 */
import { NonRetriableError } from "inngest";
import { eq } from "drizzle-orm";
import { upsertCloverItem, CloverApiError } from "@/lib/clover-catalog";
import {
  findVariantBySku,
  katanaFetch,
  KatanaApiError,
} from "@/lib/katana";
import { upsertWooCommerceProduct, WooCommerceApiError } from "@/lib/woocommerce-catalog";
import { buildKatanaPublishPlan } from "@/mappers/katana";
import { mapFinishedGoodToClover } from "@/mappers/clover";
import { mapFinishedGoodToWooCommerce } from "@/mappers/woocommerce";
import type { HubProductGraph } from "@/mappers/types";
import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import {
  getChannelSyncRow,
  upsertChannelSync,
} from "@/server/mdm/channel-sync";

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
 * Katana spoke: mapper plan → HTTP with Idempotency-Key → channel_sync.
 */
export async function publishToKatana(
  graph: HubProductGraph,
): Promise<{ skipped: boolean; externalId: string | null }> {
  const globalSku = graph.rootSku.toUpperCase();
  const existing = await getChannelSyncRow(globalSku, "katana");
  if (existing?.status === "success") {
    return { skipped: true, externalId: existing.external_id };
  }

  const variantIds = new Map<string, number>();
  for (const node of graph.skus) {
    if (node.katanaVariantId != null) {
      variantIds.set(node.globalSku.toUpperCase(), node.katanaVariantId);
    }
  }

  try {
    const plan = buildKatanaPublishPlan(graph);
    let rootExternalId: string | null = null;

    for (const request of plan) {
      if (request.kind === "material" || request.kind === "product") {
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
          materialId:
            request.kind === "material" ? created.id : null,
        });
        if (sku === globalSku) {
          rootExternalId = String(created.variantId);
        }
        continue;
      }

      if (request.kind === "recipes") {
        const rawRows = Array.isArray(request.body.rows)
          ? (request.body.rows as Array<Record<string, unknown>>)
          : [];
        const rows = rawRows.map((row) => {
          const parentSku = String(row._parent_sku ?? "").toUpperCase();
          const childSku = String(row._child_sku ?? "").toUpperCase();
          const productVariantId =
            (parentSku ? variantIds.get(parentSku) : undefined) ??
            (row.product_variant_id != null
              ? Number(row.product_variant_id)
              : NaN);
          const ingredientVariantId =
            (childSku ? variantIds.get(childSku) : undefined) ??
            (row.ingredient_variant_id != null
              ? Number(row.ingredient_variant_id)
              : NaN);
          if (
            !Number.isFinite(productVariantId) ||
            !Number.isFinite(ingredientVariantId)
          ) {
            throw new Error(
              `Katana recipe missing variant ids for ${parentSku} → ${childSku}`,
            );
          }
          return {
            product_variant_id: productVariantId,
            ingredient_variant_id: ingredientVariantId,
            quantity: row.quantity,
            ...(typeof row.notes === "string" ? { notes: row.notes } : {}),
          };
        });

        if (rows.length === 0) continue;

        await katanaFetch("/recipes", {
          method: "POST",
          body: {
            keep_current_rows: false,
            rows,
          },
          idempotencyKey: request.idempotencyKey,
        });
        continue;
      }

      if (request.kind === "product_operation_rows") {
        const rawRows = Array.isArray(request.body.rows)
          ? (request.body.rows as Array<Record<string, unknown>>)
          : [];
        const rows = rawRows.map((row) => {
          const itemSku = String(row.item_sku ?? "").toUpperCase();
          const productVariantId =
            (itemSku ? variantIds.get(itemSku) : undefined) ??
            (row.product_variant_id != null
              ? Number(row.product_variant_id)
              : NaN);
          if (!Number.isFinite(productVariantId)) {
            throw new Error(
              `Katana operation missing product_variant_id for ${itemSku || "unknown"}`,
            );
          }
          const cleaned = { ...row };
          delete cleaned.item_sku;
          return {
            ...cleaned,
            product_variant_id: productVariantId,
          };
        });

        if (rows.length === 0) continue;

        await katanaFetch("/product_operation_rows", {
          method: "POST",
          body: {
            keep_current_rows: false,
            rows,
          },
          idempotencyKey: request.idempotencyKey,
        });
      }
    }

    if (!rootExternalId) {
      rootExternalId =
        variantIds.get(globalSku) != null
          ? String(variantIds.get(globalSku))
          : null;
    }

    await upsertChannelSync({
      globalSku,
      channel: "katana",
      status: "success",
      externalId: rootExternalId,
      lastError: null,
    });

    return { skipped: false, externalId: rootExternalId };
  } catch (error) {
    await upsertChannelSync({
      globalSku,
      channel: "katana",
      status: "failed",
      lastError: error instanceof Error ? error.message : String(error),
    });
    throwProviderAuthOrRethrow("Katana", error);
  }
}

export async function publishToWooCommerce(
  graph: HubProductGraph,
): Promise<{ skipped: boolean; externalId: string | null }> {
  const globalSku = graph.rootSku.toUpperCase();
  const existing = await getChannelSyncRow(globalSku, "woocommerce");
  if (existing?.status === "success") {
    return { skipped: true, externalId: existing.external_id };
  }

  const mapped = mapFinishedGoodToWooCommerce(graph.commerce);
  if (mapped.skip) {
    await upsertChannelSync({
      globalSku,
      channel: "woocommerce",
      status: "success",
      externalId: "skipped",
      lastError: null,
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
    });
    return { skipped: false, externalId };
  } catch (error) {
    await upsertChannelSync({
      globalSku,
      channel: "woocommerce",
      status: "failed",
      lastError: error instanceof Error ? error.message : String(error),
    });
    throwProviderAuthOrRethrow("WooCommerce", error);
  }
}

export async function publishToClover(
  graph: HubProductGraph,
): Promise<{ skipped: boolean; externalId: string | null }> {
  const globalSku = graph.rootSku.toUpperCase();
  const existing = await getChannelSyncRow(globalSku, "clover");
  if (existing?.status === "success") {
    return { skipped: true, externalId: existing.external_id };
  }

  const mapped = mapFinishedGoodToClover(graph.commerce);
  if (mapped.skip) {
    await upsertChannelSync({
      globalSku,
      channel: "clover",
      status: "success",
      externalId: "skipped",
      lastError: null,
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
    });
    return { skipped: false, externalId };
  } catch (error) {
    await upsertChannelSync({
      globalSku,
      channel: "clover",
      status: "failed",
      lastError: error instanceof Error ? error.message : String(error),
    });
    throwProviderAuthOrRethrow("Clover", error);
  }
}
