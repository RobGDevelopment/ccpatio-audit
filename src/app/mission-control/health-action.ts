"use server";

import { requireMissionControlAuth } from "@/app/mission-control/actions";
import { runSpokeTokenHealthCheck } from "@/server/mdm/token-health";
import {
  deriveTrafficMatrix,
  readChannelSyncCounts,
} from "@/server/mission-control/sync-matrix";

/**
 * Read-only system health. `silent` is fixed so the token ping cannot raise an alert.
 * The matrix is a select plus a pure lamp derivation.
 */
export async function getSystemHealthAction() {
  await requireMissionControlAuth();

  try {
    const health = await runSpokeTokenHealthCheck(true);
    const counts = await readChannelSyncCounts();
    return { ok: true as const, data: deriveTrafficMatrix(health.results, counts) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    const safe =
      message && !/bearer|authorization\s*:/i.test(message)
        ? message
        : "Failed to load system health.";
    return { ok: false as const, error: safe };
  }
}
