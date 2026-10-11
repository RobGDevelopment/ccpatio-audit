"use server";

import { desc, eq } from "drizzle-orm";
import { requireMissionControlAuth, retryJobAction } from "@/app/mission-control/actions";
import { getDb } from "@/server/db/client";
import { channel_sync } from "@/server/db/schema";
import {
  plainEnglishError,
  selectFailedRunIssues,
  selectFailedSyncIssues,
  type FailedRunCandidate,
  type InboxIssue,
} from "@/server/mission-control/issue-copy";
import { fetchFailedPublishJobs } from "@/services/inngest-api";

const LOAD_ERROR = "The issues inbox could not be loaded.";

function safeActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/bearer|authorization\s*:/i.test(message)) return LOAD_ERROR;
  const translated = plainEnglishError(message);
  if (translated !== "Sync failed. Open the run before retrying.") return translated;
  return LOAD_ERROR;
}

function unwrapRuns(payload: unknown): FailedRunCandidate[] {
  const list = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];

  return list.filter(
    (item): item is FailedRunCandidate => item != null && typeof item === "object",
  );
}

async function readFailedSyncRows() {
  const db = getDb();
  return db
    .select({
      id: channel_sync.id,
      channel: channel_sync.channel,
      status: channel_sync.status,
      globalSku: channel_sync.global_sku,
      updatedAt: channel_sync.updated_at,
      lastError: channel_sync.last_error,
    })
    .from(channel_sync)
    .where(eq(channel_sync.status, "failed"))
    .orderBy(desc(channel_sync.updated_at));
}

/**
 * Failed publish runs plus failed `channel_sync` rows.
 * The client receives translated fields only.
 */
export async function getIssuesInboxAction(): Promise<
  { ok: true; data: InboxIssue[] } | { ok: false; error: string }
> {
  await requireMissionControlAuth();

  try {
    const [runsPayload, syncRows] = await Promise.all([
      fetchFailedPublishJobs(),
      readFailedSyncRows(),
    ]);
    const data = [
      ...selectFailedRunIssues(unwrapRuns(runsPayload)),
      ...selectFailedSyncIssues(syncRows),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { ok: true, data };
  } catch (error: unknown) {
    return { ok: false, error: safeActionError(error) };
  }
}

/** Replay stays on `retryJobAction`. The Inngest response body is not returned. */
export async function retryInboxRunAction(
  runId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireMissionControlAuth();
  const id = runId.trim();
  if (!id || id.length > 200) {
    return { ok: false, error: "Sync failed. Open the run before retrying." };
  }

  const result = await retryJobAction(id);
  if (!result.ok) {
    return { ok: false, error: plainEnglishError(result.error) };
  }
  return { ok: true };
}
