import { z } from "zod";
import { eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import {
  createKatanaSalesOrder,
  createMakeToOrderManufacturingOrders,
  KatanaApiError,
  mapGhlOpportunityToKatanaSalesOrder,
  mapWooOrderToKatanaSalesOrder,
} from "@/lib/katana";
import { sendOhCrapAlert } from "@/server/alerts/oh-crap";
import { getDb } from "@/server/db/client";
import { incoming_webhooks } from "@/server/db/schema";
import {
  canMutateKatanaOrders,
  getOrderPipelineMode,
  pipelineModeLabel,
  type OrderPipelineMode,
} from "@/server/pipeline/mode";
import {
  parseWooOrderWebhook,
  type SkuIngressIssue,
} from "@/server/woocommerce/ingress.schema";

const ghlContactSchema = z.looseObject({
  email: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  address_1: z.string().optional(),
  address_2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

const ghlLineItemSchema = z.looseObject({
  sku: z.string().trim().min(1),
  quantity: z.number().positive(),
  price_per_unit: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
});

export const ghlOpportunitySyncSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().optional(),
  pipeline_id: z.string().optional(),
  pipeline_stage_id: z.string().optional(),
  status: z.string().optional(),
  contact_id: z.string().optional(),
  monetary_value: z.union([z.string(), z.number()]).optional(),
  source: z.string().optional(),
  contact: ghlContactSchema.optional(),
  line_items: z.array(ghlLineItemSchema).optional(),
});

export type GhlOpportunitySync = z.infer<typeof ghlOpportunitySyncSchema>;

type WebhookLogInput = {
  source: "woocommerce" | "ghl";
  eventName: string;
  idempotencyKey: string;
  payload: unknown;
  status: "received" | "processed" | "failed" | "duplicate";
  errorMessage?: string;
};

async function logIncomingWebhook(input: WebhookLogInput): Promise<"inserted" | "duplicate"> {
  const db = getDb();

  const [existing] = await db
    .select({ id: incoming_webhooks.id })
    .from(incoming_webhooks)
    .where(eq(incoming_webhooks.idempotency_key, input.idempotencyKey))
    .limit(1);

  if (existing) {
    await db
      .update(incoming_webhooks)
      .set({
        status: "duplicate",
        error_message: "Duplicate idempotency key",
        updated_at: new Date(),
      })
      .where(eq(incoming_webhooks.id, existing.id));
    return "duplicate";
  }

  await db.insert(incoming_webhooks).values({
    source: input.source,
    event_name: input.eventName,
    idempotency_key: input.idempotencyKey,
    payload: input.payload as object,
    status: input.status,
    error_message: input.errorMessage ?? null,
    updated_at: new Date(),
  });

  return "inserted";
}

async function updateIncomingWebhookStatus(
  idempotencyKey: string,
  status: "processed" | "failed",
  errorMessage?: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(incoming_webhooks)
    .set({
      status,
      error_message: errorMessage ?? null,
      updated_at: new Date(),
    })
    .where(eq(incoming_webhooks.idempotency_key, idempotencyKey));
}

function formatIssues(issues: SkuIngressIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function formatKatanaFailure(error: unknown): string {
  if (error instanceof KatanaApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Katana sales order creation failed";
}

function firstSkuFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const lineItems = (payload as { line_items?: unknown }).line_items;
  if (!Array.isArray(lineItems) || lineItems.length === 0) return undefined;
  const sku = (lineItems[0] as { sku?: unknown })?.sku;
  return typeof sku === "string" && sku.trim() ? sku.trim() : undefined;
}

async function alertPipelineFailure(input: {
  source: "ghl" | "woocommerce";
  externalId: string;
  sku?: string;
  message: string;
  reason:
    | "sku_not_in_dictionary"
    | "sku_not_in_katana"
    | "validation_failed"
    | "katana_rejected"
    | "missing_line_items"
    | "unknown";
  rawPayload?: unknown;
}): Promise<void> {
  await sendOhCrapAlert({
    ...input,
    resolutionPath: input.sku
      ? `/admin/dictionary?sku=${encodeURIComponent(input.sku)}`
      : `/admin/dictionary?source=${input.source}&externalId=${encodeURIComponent(input.externalId)}`,
  });
}

export const processWooCommerceOrder = inngest.createFunction(
  {
    id: "process-woocommerce-order",
    name: "Process WooCommerce Order",
    triggers: [{ event: "woo.order.validated" }],
    onFailure: async ({ error, event }) => {
      const data = event.data.event?.data as { id?: unknown } | undefined;
      await alertPipelineFailure({
        reason: "unknown",
        source: "woocommerce",
        externalId: String(data?.id ?? "unknown"),
        sku: firstSkuFromPayload(data),
        message: error.message,
        rawPayload: event.data,
      });
    },
  },
  async ({ event, step }) => {
    const mode = getOrderPipelineMode();
    const idempotencyKey = `woo-order-${String(event.data.id ?? "unknown")}`;

    const parsed = parseWooOrderWebhook(event.data);
    if (!parsed.ok) {
      await step.run("log-invalid-woo-order", async () => {
        await logIncomingWebhook({
          source: "woocommerce",
          eventName: event.name,
          idempotencyKey,
          payload: event.data,
          status: "failed",
          errorMessage: formatIssues(parsed.issues),
        });
        await alertPipelineFailure({
          reason: "validation_failed",
          source: "woocommerce",
          externalId: String((event.data as { id?: unknown })?.id ?? "unknown"),
          message: formatIssues(parsed.issues),
          rawPayload: event.data,
        });
      });
      return {
        ok: false,
        reason: "validation_failed",
        issues: parsed.issues,
        pipelineMode: mode,
      };
    }

    const logResult = await step.run("log-woo-order", async () =>
      logIncomingWebhook({
        source: "woocommerce",
        eventName: event.name,
        idempotencyKey,
        payload: parsed.data,
        status: "received",
      }),
    );

    if (logResult === "duplicate") {
      return { ok: true, duplicate: true, orderId: parsed.data.id, pipelineMode: mode };
    }

    if (!canMutateKatanaOrders(mode)) {
      await step.run("mark-woo-order-log-only", async () => {
        await updateIncomingWebhookStatus(
          idempotencyKey,
          "processed",
          `ORDER_PIPELINE_MODE=${mode} — Katana SO/MTO skipped (${pipelineModeLabel(mode)}).`,
        );
      });
      return {
        ok: true,
        duplicate: false,
        orderId: parsed.data.id,
        lineItemCount: parsed.data.line_items.length,
        katanaSalesOrderCreated: false,
        pipelineMode: mode,
        dryRun: true,
      };
    }

    try {
      const salesOrder = await step.run("create-katana-sales-order", async () => {
        const orderPayload = mapWooOrderToKatanaSalesOrder(parsed.data);
        return createKatanaSalesOrder(orderPayload);
      });

      const mtoOrders = await step.run("create-katana-mto-orders", async () =>
        createMakeToOrderManufacturingOrders(salesOrder.salesOrderRowIds),
      );

      await step.run("mark-woo-order-processed", async () => {
        await updateIncomingWebhookStatus(idempotencyKey, "processed");
      });

      return {
        ok: true,
        duplicate: false,
        orderId: parsed.data.id,
        lineItemCount: parsed.data.line_items.length,
        katanaSalesOrderId: salesOrder.salesOrderId,
        katanaOrderNo: salesOrder.orderNo,
        manufacturingOrderIds: mtoOrders.map((mo) => mo.manufacturingOrderId),
        pipelineMode: mode,
      };
    } catch (error: unknown) {
      const message = formatKatanaFailure(error);
      await step.run("mark-woo-order-failed", async () => {
        await updateIncomingWebhookStatus(idempotencyKey, "failed", message);
        await alertPipelineFailure({
          reason: "katana_rejected",
          source: "woocommerce",
          externalId: String(parsed.data.id),
          sku: firstSkuFromPayload(parsed.data),
          message,
          rawPayload: parsed.data,
        });
      });
      throw error instanceof Error ? error : new Error(message);
    }
  },
);

export const syncGhlOpportunity = inngest.createFunction(
  {
    id: "sync-ghl-opportunity",
    name: "Sync GHL Opportunity",
    triggers: [{ event: "ghl/opportunity.sync" }],
    onFailure: async ({ error, event }) => {
      const data = event.data.event?.data as {
        id?: unknown;
        line_items?: unknown;
      } | undefined;
      await alertPipelineFailure({
        reason: "unknown",
        source: "ghl",
        externalId: String(data?.id ?? "unknown"),
        sku: firstSkuFromPayload(data),
        message: error.message,
        rawPayload: event.data,
      });
    },
  },
  async ({ event, step }) => {
    const mode: OrderPipelineMode = getOrderPipelineMode();
    const parsed = ghlOpportunitySyncSchema.safeParse(event.data);
    const opportunityId = parsed.success
      ? parsed.data.id
      : String((event.data as { id?: unknown })?.id ?? "unknown");
    const idempotencyKey = `ghl-opportunity-${opportunityId}`;

    if (!parsed.success) {
      await step.run("log-invalid-ghl-opportunity", async () => {
        await logIncomingWebhook({
          source: "ghl",
          eventName: event.name,
          idempotencyKey,
          payload: event.data,
          status: "failed",
          errorMessage: parsed.error.message,
        });
        await alertPipelineFailure({
          reason: "validation_failed",
          source: "ghl",
          externalId: opportunityId,
          message: parsed.error.message,
          rawPayload: event.data,
        });
      });
      return { ok: false, reason: "validation_failed", pipelineMode: mode };
    }

    const logResult = await step.run("log-ghl-opportunity", async () =>
      logIncomingWebhook({
        source: "ghl",
        eventName: event.name,
        idempotencyKey,
        payload: parsed.data,
        status: "received",
      }),
    );

    if (logResult === "duplicate") {
      return {
        ok: true,
        duplicate: true,
        opportunityId: parsed.data.id,
        pipelineMode: mode,
      };
    }

    const salesOrderPayload = mapGhlOpportunityToKatanaSalesOrder(parsed.data);
    if (!salesOrderPayload) {
      await step.run("mark-ghl-opportunity-processed-no-order", async () => {
        await updateIncomingWebhookStatus(
          idempotencyKey,
          "processed",
          "Skipped Katana sales order — opportunity not Won or missing line items.",
        );
      });

      return {
        ok: true,
        duplicate: false,
        opportunityId: parsed.data.id,
        pipelineStageId: parsed.data.pipeline_stage_id ?? null,
        katanaSalesOrderCreated: false,
        reason: "not_won_or_no_line_items",
        pipelineMode: mode,
      };
    }

    if (!canMutateKatanaOrders(mode)) {
      await step.run("mark-ghl-opportunity-log-only", async () => {
        await updateIncomingWebhookStatus(
          idempotencyKey,
          "processed",
          `ORDER_PIPELINE_MODE=${mode} — Katana SO/MTO skipped (${pipelineModeLabel(mode)}). Would create SO for ${salesOrderPayload.salesOrderRows.length} line(s).`,
        );
      });

      return {
        ok: true,
        duplicate: false,
        opportunityId: parsed.data.id,
        pipelineStageId: parsed.data.pipeline_stage_id ?? null,
        katanaSalesOrderCreated: false,
        dryRun: true,
        pipelineMode: mode,
        intendedLineCount: salesOrderPayload.salesOrderRows.length,
      };
    }

    try {
      const salesOrder = await step.run("create-katana-sales-order", async () =>
        createKatanaSalesOrder(salesOrderPayload),
      );

      const mtoOrders = await step.run("create-katana-mto-orders", async () => {
        if (salesOrder.salesOrderRowIds.length === 0) {
          throw new KatanaApiError(
            "Sales order created but no sales_order_row ids returned for MTO.",
            { status: 422 },
          );
        }
        return createMakeToOrderManufacturingOrders(salesOrder.salesOrderRowIds);
      });

      await step.run("mark-ghl-opportunity-processed", async () => {
        await updateIncomingWebhookStatus(idempotencyKey, "processed");
      });

      return {
        ok: true,
        duplicate: false,
        opportunityId: parsed.data.id,
        pipelineStageId: parsed.data.pipeline_stage_id ?? null,
        katanaSalesOrderCreated: true,
        katanaSalesOrderId: salesOrder.salesOrderId,
        katanaOrderNo: salesOrder.orderNo,
        manufacturingOrderIds: mtoOrders.map((mo) => mo.manufacturingOrderId),
        pipelineMode: mode,
      };
    } catch (error: unknown) {
      const message = formatKatanaFailure(error);
      const sku = salesOrderPayload.salesOrderRows[0]?.sku;
      await step.run("mark-ghl-opportunity-failed", async () => {
        await updateIncomingWebhookStatus(idempotencyKey, "failed", message);
        await alertPipelineFailure({
          reason: "katana_rejected",
          source: "ghl",
          externalId: parsed.data.id,
          sku,
          message,
          rawPayload: parsed.data,
        });
      });
      throw error instanceof Error ? error : new Error(message);
    }
  },
);

export const inngestFunctions = [processWooCommerceOrder, syncGhlOpportunity];
