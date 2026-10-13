import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { incoming_webhooks } from "@/server/db/schema";

export type WebhookLogInput = {
  source: "woocommerce" | "ghl" | "cad_convert";
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

/**
 * Atomic insert-once for the audit row. `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`:
 * a concurrent redelivery cannot raise an unhandled 23505, and an already `processed` row is
 * NEVER touched (unlike {@link logIncomingWebhook}, which flips it to `duplicate`).
 */
export async function insertIncomingWebhookOnce(
  input: WebhookLogInput,
  db: Pick<ReturnType<typeof getDb>, "insert"> = getDb(),
): Promise<"inserted" | "duplicate"> {
  const rows = await db
    .insert(incoming_webhooks)
    .values({
      source: input.source,
      event_name: input.eventName,
      idempotency_key: input.idempotencyKey,
      payload: input.payload as object,
      status: input.status,
      error_message: input.errorMessage ?? null,
      updated_at: new Date(),
    })
    .onConflictDoNothing({ target: incoming_webhooks.idempotency_key })
    .returning({ id: incoming_webhooks.id });
  return rows.length > 0 ? "inserted" : "duplicate";
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
