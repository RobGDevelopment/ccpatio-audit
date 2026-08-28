import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { incoming_webhooks } from "@/server/db/schema";

export type WebhookLogInput = {
  source: "woocommerce" | "ghl";
  eventName: string;
  idempotencyKey: string;
  payload: unknown;
  status: "received" | "processed" | "failed" | "duplicate";
  errorMessage?: string;
};

export async function logIncomingWebhook(
  input: WebhookLogInput,
): Promise<"inserted" | "duplicate"> {
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

export async function updateIncomingWebhookStatus(
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
