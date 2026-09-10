/**
 * channel_sync idempotency helpers for catalog fan-out.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 4.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  channel_sync,
  type ChannelSyncChannel,
  type ChannelSyncStatus,
} from "@/server/db/schema";

export async function getChannelSyncRow(
  globalSku: string,
  channel: ChannelSyncChannel,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(channel_sync)
    .where(
      and(
        eq(channel_sync.global_sku, globalSku),
        eq(channel_sync.channel, channel),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function upsertChannelSync(input: {
  globalSku: string;
  channel: ChannelSyncChannel;
  status: ChannelSyncStatus;
  externalId?: string | null;
  lastError?: string | null;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(channel_sync)
    .values({
      global_sku: input.globalSku,
      channel: input.channel,
      status: input.status,
      external_id: input.externalId ?? null,
      last_error: input.lastError ?? null,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [channel_sync.global_sku, channel_sync.channel],
      set: {
        status: input.status,
        external_id: input.externalId ?? null,
        last_error: input.lastError ?? null,
        updated_at: now,
      },
    });
}
